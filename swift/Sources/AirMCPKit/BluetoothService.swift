// AirMCPKit — CoreBluetooth service shared between macOS and iOS.

import Foundation
import CoreBluetooth

// MARK: - Types

public struct BluetoothScanInput: Decodable, Sendable {
    public let duration: Double?
}

public struct BluetoothConnectInput: Decodable, Sendable {
    public let identifier: String
}

public struct BluetoothStateOutput: Encodable, Sendable {
    public let state: String
    public let powered: Bool
    public init(state: String, powered: Bool) {
        self.state = state; self.powered = powered
    }
}

public struct BluetoothDeviceInfo: Encodable, Sendable {
    public let name: String?
    public let identifier: String
    public let rssi: Int
    public init(name: String?, identifier: String, rssi: Int) {
        self.name = name; self.identifier = identifier; self.rssi = rssi
    }
}

public struct BluetoothScanOutput: Encodable, Sendable {
    public let total: Int
    public let devices: [BluetoothDeviceInfo]
    public init(total: Int, devices: [BluetoothDeviceInfo]) {
        self.total = total; self.devices = devices
    }
}

public struct BluetoothConnectOutput: Encodable, Sendable {
    public let success: Bool
    public let identifier: String
    public let name: String?
    public init(success: Bool, identifier: String, name: String?) {
        self.success = success; self.identifier = identifier; self.name = name
    }
}

// MARK: - Manager

public class BluetoothManager: NSObject, CBCentralManagerDelegate, @unchecked Sendable {
    private var stateContinuation: CheckedContinuation<CBManagerState, Never>?
    private var connectContinuation: CheckedContinuation<Bool, Error>?
    private var manager: CBCentralManager?
    private var discovered: [String: BluetoothDeviceInfo] = [:]
    private let btQueue = DispatchQueue(label: "com.airmcp.bluetooth")

    public override init() { super.init() }

    // MARK: - Safe continuation helpers (prevent double-resume crashes)

    private func resumeConnectOnce(with result: Result<Bool, Error>) {
        // btQueue context assumed — all callers dispatch on btQueue
        guard let cont = connectContinuation else { return }
        connectContinuation = nil
        switch result {
        case .success(let v): cont.resume(returning: v)
        case .failure(let e): cont.resume(throwing: e)
        }
    }

    public func initialize() async -> CBManagerState {
        await withCheckedContinuation { cont in
            self.stateContinuation = cont
            self.manager = CBCentralManager(delegate: self, queue: self.btQueue)
        }
    }

    public func scan(duration: Double) async -> [BluetoothDeviceInfo] {
        let state = await initialize()
        guard state == .poweredOn, let mgr = manager else { return [] }

        mgr.scanForPeripherals(withServices: nil, options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: false,
        ])

        try? await Task.sleep(for: .seconds(duration))

        mgr.stopScan()
        let result: [BluetoothDeviceInfo] = btQueue.sync {
            Array(self.discovered.values).sorted { $0.rssi > $1.rssi }
        }
        return result
    }

    private func resolvePeripheral(_ identifier: String) async throws -> (CBCentralManager, CBPeripheral) {
        let state = await initialize()
        guard state == .poweredOn, let mgr = manager else {
            throw AirMCPKitError.unsupported("Bluetooth is not powered on")
        }
        guard let uuid = UUID(uuidString: identifier) else {
            throw AirMCPKitError.invalidInput("Invalid UUID: \(identifier)")
        }
        let peripherals = mgr.retrievePeripherals(withIdentifiers: [uuid])
        guard let peripheral = peripherals.first else {
            throw AirMCPKitError.notFound("Peripheral not found: \(identifier). Run scan-bluetooth first.")
        }
        return (mgr, peripheral)
    }

    public func connect(identifier: String) async throws -> String? {
        let (mgr, peripheral) = try await resolvePeripheral(identifier)

        let timeoutItem = DispatchWorkItem { [weak self] in
            self?.resumeConnectOnce(with: .failure(
                AirMCPKitError.unsupported("Connection timed out after 10 seconds")
            ))
            mgr.cancelPeripheralConnection(peripheral)
        }
        btQueue.asyncAfter(deadline: .now() + 10, execute: timeoutItem)

        let _ = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Bool, Error>) in
            self.connectContinuation = cont
            mgr.connect(peripheral, options: nil)
        }
        timeoutItem.cancel()
        return peripheral.name
    }

    public func disconnect(identifier: String) async throws -> String? {
        let (mgr, peripheral) = try await resolvePeripheral(identifier)
        mgr.cancelPeripheralConnection(peripheral)
        return peripheral.name
    }

    // MARK: CBCentralManagerDelegate

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        stateContinuation?.resume(returning: central.state)
        stateContinuation = nil
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                                 advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let id = peripheral.identifier.uuidString
        discovered[id] = BluetoothDeviceInfo(name: peripheral.name, identifier: id, rssi: RSSI.intValue)
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        resumeConnectOnce(with: .success(true))
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        let err = error ?? AirMCPKitError.unsupported("Failed to connect to \(peripheral.identifier)")
        resumeConnectOnce(with: .failure(err))
    }
}

public func bluetoothStateString(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "powered_on"
    case .poweredOff: return "powered_off"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    case .resetting: return "resetting"
    case .unknown: return "unknown"
    @unknown default: return "unknown"
    }
}
