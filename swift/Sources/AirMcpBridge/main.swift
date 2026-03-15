import Foundation
import EventKit
import Photos
import NaturalLanguage
import Accelerate
import CoreLocation
import CoreBluetooth
import Vision
import CoreSpotlight

#if canImport(ImagePlayground)
import ImagePlayground
#endif

// AirMcpBridge CLI — thin wrapper around Apple frameworks.
// Reads JSON from stdin, dispatches to subcommand, writes JSON to stdout.
//
// Usage:
//   echo '{"text":"Hello world"}' | AirMcpBridge summarize
//   echo '{"text":"Hello","tone":"friendly"}' | AirMcpBridge rewrite
//   echo '{"text":"Helo wrold"}' | AirMcpBridge proofread
//   echo '{"title":"Standup","startDate":"...","endDate":"...","recurrence":{...}}' | AirMcpBridge create-recurring-event
//   echo '{"title":"Take meds","recurrence":{...}}' | AirMcpBridge create-recurring-reminder
//   echo '{"filePath":"/tmp/photo.jpg"}' | AirMcpBridge import-photo
//   echo '{"identifiers":["ABC123"]}' | AirMcpBridge delete-photos

#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - Shared I/O

struct Input: Decodable {
    let text: String
    let tone: String?
}

struct Output: Encodable {
    let output: String
}

// MARK: - Foundation Models input/output types

struct GenerateTextInput: Decodable {
    let prompt: String
    let systemInstruction: String?
    let temperature: Double?
}

struct GenerateStructuredInput: Decodable {
    let prompt: String
    let systemInstruction: String?
    let schema: [String: SchemaProperty]?
}

struct SchemaProperty: Decodable {
    let type: String
    let description: String?
}

struct TagContentInput: Decodable {
    let text: String
    let tags: [String]
}

struct AiChatInput: Decodable {
    let sessionName: String
    let message: String
    let systemInstruction: String?
}

struct AiStatusOutput: Encodable {
    let available: Bool
    let message: String
    let macOSVersion: String
    let hasAppleSilicon: Bool
    let foundationModelsSupported: Bool
}

let MAX_STDIN_SIZE = 50 * 1024 * 1024 // 50 MB

func readStdin() -> Data {
    var data = Data()
    while let line = readLine(strippingNewline: false) {
        data.append(Data(line.utf8))
        if data.count > MAX_STDIN_SIZE {
            writeError("stdin too large (>\(MAX_STDIN_SIZE / 1024 / 1024)MB)")
            exit(1)
        }
    }
    return data
}

func writeJSON<T: Encodable>(_ value: T) throws {
    let data = try JSONEncoder().encode(value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func writeOutput(_ output: Output) throws {
    try writeJSON(output)
}

func writeError(_ message: String) {
    let error = ["error": message]
    if let data = try? JSONSerialization.data(withJSONObject: error) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
    exit(1)
}

// MARK: - EventKit input/output types

struct RecurrenceInput: Decodable {
    let frequency: String // daily, weekly, monthly, yearly
    let interval: Int     // every N frequency units
    let endDate: String?  // ISO 8601 end date
    let count: Int?       // number of occurrences
    let daysOfWeek: [Int]? // 1=Sun, 2=Mon, ..., 7=Sat (for weekly)
}

struct RecurringEventInput: Decodable {
    let title: String
    let startDate: String
    let endDate: String
    let calendar: String?
    let location: String?
    let notes: String?
    let recurrence: RecurrenceInput
}

struct RecurringReminderInput: Decodable {
    let title: String
    let list: String?
    let notes: String?
    let dueDate: String?
    let priority: Int?
    let recurrence: RecurrenceInput
}

struct EventOutput: Encodable {
    let id: String
    let title: String
    let recurring: Bool
}

struct ReminderOutput: Encodable {
    let id: String
    let title: String
    let recurring: Bool
}

// MARK: - PhotoKit input/output types

struct PhotoQueryInput: Decodable {
    let mediaType: String?     // image, video, audio
    let startDate: String?     // ISO 8601
    let endDate: String?       // ISO 8601
    let favorites: Bool?
    let limit: Int?
}

struct PhotoQueryOutput: Encodable {
    let photos: [PhotoInfo]
    let total: Int
}

struct PhotoInfo: Encodable {
    let identifier: String
    let filename: String?
    let creationDate: String?
    let mediaType: String
    let isFavorite: Bool
    let width: Int
    let height: Int
}

struct ClassifyImageInput: Decodable {
    let imagePath: String
    let maxResults: Int?
}

struct ClassifyImageOutput: Encodable {
    let labels: [ImageLabel]
    let total: Int
}

struct ImageLabel: Encodable {
    let identifier: String
    let confidence: Double
}

struct ImportPhotoInput: Decodable {
    let filePath: String
    let albumName: String?
}

struct DeletePhotosInput: Decodable {
    let identifiers: [String]
}

struct PhotoImportOutput: Encodable {
    let imported: Bool
    let identifier: String?
}

struct PhotoDeleteOutput: Encodable {
    let deleted: Int
    let identifiers: [String]
}

// MARK: - Helpers

func parseISO8601(_ string: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: string) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: string)
}

func buildRecurrenceRule(_ input: RecurrenceInput) -> EKRecurrenceRule {
    let freq: EKRecurrenceFrequency
    switch input.frequency {
    case "daily": freq = .daily
    case "weekly": freq = .weekly
    case "monthly": freq = .monthly
    case "yearly": freq = .yearly
    default: freq = .daily
    }

    var end: EKRecurrenceEnd? = nil
    if let endDateStr = input.endDate, let endDate = parseISO8601(endDateStr) {
        end = EKRecurrenceEnd(end: endDate)
    } else if let count = input.count {
        end = EKRecurrenceEnd(occurrenceCount: count)
    }

    var daysOfWeek: [EKRecurrenceDayOfWeek]? = nil
    if let days = input.daysOfWeek {
        daysOfWeek = days.compactMap { day in
            guard (1...7).contains(day) else { return nil }
            return EKRecurrenceDayOfWeek(EKWeekday(rawValue: day)!)
        }
    }

    return EKRecurrenceRule(
        recurrenceWith: freq,
        interval: input.interval,
        daysOfTheWeek: daysOfWeek,
        daysOfTheMonth: nil,
        monthsOfTheYear: nil,
        weeksOfTheYear: nil,
        daysOfTheYear: nil,
        setPositions: nil,
        end: end
    )
}

// MARK: - NLContextualEmbedding types

struct EmbedTextInput: Decodable {
    let text: String
    let language: String? // ISO 639-1 code (e.g. "ko", "en")
}

struct EmbedBatchInput: Decodable {
    let texts: [String]
    let language: String?
}

struct EmbedTextOutput: Encodable {
    let vector: [Double]
    let dimension: Int
}

struct EmbedBatchOutput: Encodable {
    let vectors: [[Double]]
    let dimension: Int
    let count: Int
}

func detectLanguage(_ text: String) -> NLLanguage {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    return recognizer.dominantLanguage ?? .english
}

func nlLanguageFromCode(_ code: String?) -> NLLanguage? {
    guard let code = code else { return nil }
    switch code {
    case "ko": return .korean
    case "en": return .english
    case "ja": return .japanese
    case "zh": return .simplifiedChinese
    case "fr": return .french
    case "de": return .german
    case "es": return .spanish
    case "it": return .italian
    case "pt": return .portuguese
    default: return NLLanguage(rawValue: code)
    }
}

func embedText(_ text: String, language: NLLanguage) throws -> [Double] {
    guard let embedding = NLContextualEmbedding(language: language) else {
        throw NSError(domain: "AirMcpBridge", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "NLContextualEmbedding unavailable for language: \(language.rawValue)"])
    }
    try embedding.load()

    guard let result = try? embedding.embeddingResult(for: text, language: language) else {
        throw NSError(domain: "AirMcpBridge", code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Failed to generate embedding for text"])
    }

    var tokenVectors: [[Double]] = []
    result.enumerateTokenVectors(in: text.startIndex..<text.endIndex) { vector, _ in
        tokenVectors.append(vector)
        return true
    }

    guard !tokenVectors.isEmpty else {
        throw NSError(domain: "AirMcpBridge", code: 3,
            userInfo: [NSLocalizedDescriptionKey: "No token vectors generated"])
    }

    // Mean pooling with Accelerate
    let dim = tokenVectors[0].count
    var sumVector = [Double](repeating: 0.0, count: dim)
    for tv in tokenVectors {
        vDSP_vaddD(sumVector, 1, tv, 1, &sumVector, 1, vDSP_Length(dim))
    }
    var count = Double(tokenVectors.count)
    vDSP_vsdivD(sumVector, 1, &count, &sumVector, 1, vDSP_Length(dim))

    return sumVector
}

// MARK: - ImageCreator / Vision types

struct GenerateImageInput: Decodable {
    let prompt: String
    let outputPath: String?
}

struct GenerateImageOutput: Encodable {
    let generated: Bool
    let path: String
}

struct SpotlightItem: Decodable {
    let id: String
    let title: String
    let content: String
    let source: String // notes, calendar, reminders, mail
}

struct SpotlightIndexInput: Decodable {
    let items: [SpotlightItem]
}

struct SpotlightIndexOutput: Encodable {
    let indexed: Int
    let success: Bool
}

struct ScanDocumentInput: Decodable {
    let imagePath: String
}

struct DocumentElement: Encodable {
    let type: String  // paragraph, table, list, heading, qrCode
    let text: String
    let confidence: Double
}

struct ScanDocumentOutput: Encodable {
    let elements: [DocumentElement]
    let total: Int
}

// MARK: - CoreLocation types

struct LocationOutput: Encodable {
    let latitude: Double
    let longitude: Double
    let altitude: Double
    let horizontalAccuracy: Double
    let verticalAccuracy: Double
    let timestamp: String
}

struct LocationPermissionOutput: Encodable {
    let status: String
    let authorized: Bool
}

class LocationFetcher: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    private var continuation: CheckedContinuation<CLLocation, Error>?
    private var manager: CLLocationManager?

    func fetch() async throws -> CLLocation {
        try await withCheckedThrowingContinuation { cont in
            self.continuation = cont
            let mgr = CLLocationManager()
            mgr.delegate = self
            mgr.desiredAccuracy = kCLLocationAccuracyBest
            self.manager = mgr
            mgr.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        continuation?.resume(returning: locations[0])
        continuation = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

func locationStatusString(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "not_determined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorizedAlways: return "authorized_always"
    @unknown default: return "unknown"
    }
}

// MARK: - CoreBluetooth types

struct BluetoothScanInput: Decodable {
    let duration: Double?
}

struct BluetoothConnectInput: Decodable {
    let identifier: String
}

struct BluetoothStateOutput: Encodable {
    let state: String
    let powered: Bool
}

struct BluetoothDeviceInfo: Encodable {
    let name: String?
    let identifier: String
    let rssi: Int
}

struct BluetoothScanOutput: Encodable {
    let total: Int
    let devices: [BluetoothDeviceInfo]
}

struct BluetoothConnectOutput: Encodable {
    let success: Bool
    let identifier: String
    let name: String?
}

class BluetoothManager: NSObject, CBCentralManagerDelegate, @unchecked Sendable {
    private var stateContinuation: CheckedContinuation<CBManagerState, Never>?
    private var connectContinuation: CheckedContinuation<Bool, Error>?
    private var manager: CBCentralManager?
    private var discovered: [String: BluetoothDeviceInfo] = [:]
    private let btQueue = DispatchQueue(label: "com.airmcp.bluetooth")

    func initialize() async -> CBManagerState {
        await withCheckedContinuation { cont in
            self.stateContinuation = cont
            self.manager = CBCentralManager(delegate: self, queue: self.btQueue)
        }
    }

    func scan(duration: Double) async -> [BluetoothDeviceInfo] {
        let state = await initialize()
        guard state == .poweredOn, let mgr = manager else { return [] }

        mgr.scanForPeripherals(withServices: nil, options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: false,
        ])

        try? await Task.sleep(for: .seconds(duration))

        mgr.stopScan()
        // read on btQueue to synchronize with didDiscover callbacks
        let result: [BluetoothDeviceInfo] = btQueue.sync {
            Array(self.discovered.values).sorted { $0.rssi > $1.rssi }
        }
        return result
    }

    private func resolvePeripheral(_ identifier: String) async throws -> (CBCentralManager, CBPeripheral) {
        let state = await initialize()
        guard state == .poweredOn, let mgr = manager else {
            throw NSError(domain: "AirMcpBridge", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Bluetooth is not powered on"])
        }
        guard let uuid = UUID(uuidString: identifier) else {
            throw NSError(domain: "AirMcpBridge", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Invalid UUID: \(identifier)"])
        }
        let peripherals = mgr.retrievePeripherals(withIdentifiers: [uuid])
        guard let peripheral = peripherals.first else {
            throw NSError(domain: "AirMcpBridge", code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Peripheral not found: \(identifier). Run scan-bluetooth first."])
        }
        return (mgr, peripheral)
    }

    func connect(identifier: String) async throws -> String? {
        let (mgr, peripheral) = try await resolvePeripheral(identifier)

        let timeoutItem = DispatchWorkItem { [weak self] in
            self?.connectContinuation?.resume(throwing: NSError(domain: "AirMcpBridge", code: 5,
                userInfo: [NSLocalizedDescriptionKey: "Connection timed out after 10 seconds"]))
            self?.connectContinuation = nil
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

    func disconnect(identifier: String) async throws -> String? {
        let (mgr, peripheral) = try await resolvePeripheral(identifier)
        mgr.cancelPeripheralConnection(peripheral)
        return peripheral.name
    }

    // MARK: CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        stateContinuation?.resume(returning: central.state)
        stateContinuation = nil
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                         advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let id = peripheral.identifier.uuidString
        discovered[id] = BluetoothDeviceInfo(name: peripheral.name, identifier: id, rssi: RSSI.intValue)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        connectContinuation?.resume(returning: true)
        connectContinuation = nil
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        let err = error ?? NSError(domain: "AirMcpBridge", code: 4,
            userInfo: [NSLocalizedDescriptionKey: "Failed to connect to \(peripheral.identifier)"])
        connectContinuation?.resume(throwing: err)
        connectContinuation = nil
    }
}

func bluetoothStateString(_ state: CBManagerState) -> String {
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

// MARK: - Main

let args = CommandLine.arguments
guard args.count >= 2 else {
    writeError("Usage: AirMcpBridge <command>")
    exit(1)
}

let command = args[1]
let stdinData = readStdin()

switch command {

// --- EventKit: Recurring Events ---
case "create-recurring-event":
    let eventStore = EKEventStore()
    guard let eventInput = try? JSONDecoder().decode(RecurringEventInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected RecurringEventInput.")
        exit(1)
    }

    let granted: Bool
    if #available(macOS 14.0, *) {
        granted = try await eventStore.requestFullAccessToEvents()
    } else {
        granted = try await eventStore.requestAccess(to: .event)
    }
    guard granted else { writeError("Calendar access denied"); exit(1) }

    let event = EKEvent(eventStore: eventStore)
    event.title = eventInput.title
    guard let start = parseISO8601(eventInput.startDate) else { writeError("Invalid startDate"); exit(1) }
    guard let end = parseISO8601(eventInput.endDate) else { writeError("Invalid endDate"); exit(1) }
    event.startDate = start
    event.endDate = end
    event.location = eventInput.location
    event.notes = eventInput.notes

    if let calName = eventInput.calendar {
        if let cal = eventStore.calendars(for: .event).first(where: { $0.title == calName }) {
            event.calendar = cal
        } else {
            writeError("Calendar not found: \(calName)"); exit(1)
        }
    } else {
        event.calendar = eventStore.defaultCalendarForNewEvents
    }

    event.addRecurrenceRule(buildRecurrenceRule(eventInput.recurrence))
    try eventStore.save(event, span: .futureEvents)

    let output = EventOutput(id: event.eventIdentifier, title: event.title, recurring: true)
    try writeJSON(output)

// --- EventKit: Recurring Reminders ---
case "create-recurring-reminder":
    let eventStore = EKEventStore()
    guard let remInput = try? JSONDecoder().decode(RecurringReminderInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected RecurringReminderInput.")
        exit(1)
    }

    let granted: Bool
    if #available(macOS 14.0, *) {
        granted = try await eventStore.requestFullAccessToReminders()
    } else {
        granted = try await eventStore.requestAccess(to: .reminder)
    }
    guard granted else { writeError("Reminders access denied"); exit(1) }

    let reminder = EKReminder(eventStore: eventStore)
    reminder.title = remInput.title
    reminder.notes = remInput.notes
    if let p = remInput.priority { reminder.priority = p }

    if let dueDateStr = remInput.dueDate, let dueDate = parseISO8601(dueDateStr) {
        reminder.dueDateComponents = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute], from: dueDate
        )
    }

    if let listName = remInput.list {
        if let list = eventStore.calendars(for: .reminder).first(where: { $0.title == listName }) {
            reminder.calendar = list
        } else {
            writeError("Reminder list not found: \(listName)"); exit(1)
        }
    } else {
        reminder.calendar = eventStore.defaultCalendarForNewReminders()
    }

    reminder.addRecurrenceRule(buildRecurrenceRule(remInput.recurrence))
    try eventStore.save(reminder, commit: true)

    let output = ReminderOutput(id: reminder.calendarItemIdentifier, title: reminder.title ?? "", recurring: true)
    try writeJSON(output)

// --- PhotoKit: Advanced Query ---
case "query-photos":
    guard let queryInput = try? JSONDecoder().decode(PhotoQueryInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected PhotoQueryInput.")
        exit(1)
    }

    let fetchOptions = PHFetchOptions()
    var predicates: [NSPredicate] = []

    if let mediaType = queryInput.mediaType {
        let type: PHAssetMediaType = mediaType == "video" ? .video : mediaType == "audio" ? .audio : .image
        predicates.append(NSPredicate(format: "mediaType = %d", type.rawValue))
    }
    if let startStr = queryInput.startDate, let start = parseISO8601(startStr) {
        predicates.append(NSPredicate(format: "creationDate >= %@", start as NSDate))
    }
    if let endStr = queryInput.endDate, let end = parseISO8601(endStr) {
        predicates.append(NSPredicate(format: "creationDate <= %@", end as NSDate))
    }
    if let fav = queryInput.favorites, fav {
        predicates.append(NSPredicate(format: "isFavorite = YES"))
    }

    if !predicates.isEmpty {
        fetchOptions.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
    }
    fetchOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    let limit = queryInput.limit ?? 50
    fetchOptions.fetchLimit = limit

    let assets = PHAsset.fetchAssets(with: fetchOptions)
    var photos: [PhotoInfo] = []
    let formatter = ISO8601DateFormatter()
    assets.enumerateObjects { asset, _, _ in
        let typeStr = asset.mediaType == .video ? "video" : asset.mediaType == .audio ? "audio" : "image"
        photos.append(PhotoInfo(
            identifier: asset.localIdentifier,
            filename: PHAssetResource.assetResources(for: asset).first?.originalFilename,
            creationDate: asset.creationDate.map { formatter.string(from: $0) },
            mediaType: typeStr,
            isFavorite: asset.isFavorite,
            width: asset.pixelWidth,
            height: asset.pixelHeight
        ))
    }
    let queryOutput = PhotoQueryOutput(photos: photos, total: photos.count)
    try writeJSON(queryOutput)

// --- Vision: Classify Image ---
case "classify-image":
    guard let classInput = try? JSONDecoder().decode(ClassifyImageInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ClassifyImageInput.")
        exit(1)
    }

    let imageURL = URL(fileURLWithPath: classInput.imagePath)
    guard FileManager.default.fileExists(atPath: classInput.imagePath) else {
        writeError("Image file not found: \(classInput.imagePath)")
        exit(1)
    }

    do {
        let request = VNClassifyImageRequest()
        let handler = VNImageRequestHandler(url: imageURL, options: [:])
        try handler.perform([request])

        let maxResults = classInput.maxResults ?? 10
        let observations = (request.results ?? [])
            .filter { $0.confidence > 0.1 }
            .sorted { $0.confidence > $1.confidence }
            .prefix(maxResults)

        let labels = observations.map { ImageLabel(identifier: $0.identifier, confidence: Double($0.confidence)) }
        let output = ClassifyImageOutput(labels: Array(labels), total: labels.count)
        try writeJSON(output)
    } catch {
        writeError("Vision classify error: \(error.localizedDescription)")
    }

// --- PhotoKit: Import ---
case "import-photo":
    guard let photoInput = try? JSONDecoder().decode(ImportPhotoInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ImportPhotoInput.")
        exit(1)
    }

    let fileURL = URL(fileURLWithPath: photoInput.filePath)
    guard FileManager.default.fileExists(atPath: photoInput.filePath) else {
        writeError("File not found: \(photoInput.filePath)"); exit(1)
    }

    var localId: String? = nil
    try await PHPhotoLibrary.shared().performChanges {
        let request = PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: fileURL)
        localId = request?.placeholderForCreatedAsset?.localIdentifier

        if let albumName = photoInput.albumName {
            let fetchOptions = PHFetchOptions()
            fetchOptions.predicate = NSPredicate(format: "title = %@", albumName)
            let albums = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: fetchOptions)
            if let album = albums.firstObject, let placeholder = request?.placeholderForCreatedAsset {
                let albumRequest = PHAssetCollectionChangeRequest(for: album)
                albumRequest?.addAssets([placeholder] as NSArray)
            }
        }
    }

    let output = PhotoImportOutput(imported: true, identifier: localId)
    try writeJSON(output)

// --- PhotoKit: Delete ---
case "delete-photos":
    guard let deleteInput = try? JSONDecoder().decode(DeletePhotosInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected DeletePhotosInput.")
        exit(1)
    }

    let assets = PHAsset.fetchAssets(withLocalIdentifiers: deleteInput.identifiers, options: nil)
    var toDelete: [PHAsset] = []
    assets.enumerateObjects { asset, _, _ in
        toDelete.append(asset)
    }

    guard !toDelete.isEmpty else {
        writeError("No matching photos found"); exit(1)
    }

    try await PHPhotoLibrary.shared().performChanges {
        PHAssetChangeRequest.deleteAssets(toDelete as NSArray)
    }

    let deletedIds = toDelete.map { $0.localIdentifier }
    let output = PhotoDeleteOutput(deleted: deletedIds.count, identifiers: deletedIds)
    try writeJSON(output)

// --- NLContextualEmbedding: embed text ---
case "embed-text":
    guard let input = try? JSONDecoder().decode(EmbedTextInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected EmbedTextInput.")
        exit(1)
    }
    let lang = nlLanguageFromCode(input.language) ?? detectLanguage(input.text)
    do {
        let vector = try embedText(input.text, language: lang)
        let output = EmbedTextOutput(vector: vector, dimension: vector.count)
        try writeJSON(output)
    } catch {
        writeError("Embedding failed: \(error.localizedDescription)")
    }

case "embed-batch":
    guard let input = try? JSONDecoder().decode(EmbedBatchInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected EmbedBatchInput.")
        exit(1)
    }
    do {
        var vectors: [[Double]] = []
        for text in input.texts {
            let lang = nlLanguageFromCode(input.language) ?? detectLanguage(text)
            let vector = try embedText(text, language: lang)
            vectors.append(vector)
        }
        let dim = vectors.first?.count ?? 0
        let output = EmbedBatchOutput(vectors: vectors, dimension: dim, count: vectors.count)
        try writeJSON(output)
    } catch {
        writeError("Batch embedding failed: \(error.localizedDescription)")
    }

// --- Apple Intelligence: summarize, rewrite, proofread ---
case "summarize", "rewrite", "proofread":
    guard let input = try? JSONDecoder().decode(Input.self, from: stdinData) else {
        writeError("Invalid JSON input. Expected: {\"text\": \"...\", \"tone\": \"...\"}")
        exit(1)
    }

    #if canImport(FoundationModels)
    if #available(macOS 26, *) {
        do {
            let session = LanguageModelSession()

            switch command {
            case "summarize":
                let result = try await session.respond(
                    to: "Summarize the following text concisely:\n\n\(input.text)"
                )
                try writeOutput(Output(output: result.content))

            case "rewrite":
                let tone = input.tone ?? "professional"
                let result = try await session.respond(
                    to: "Rewrite the following text in a \(tone) tone:\n\n\(input.text)"
                )
                try writeOutput(Output(output: result.content))

            case "proofread":
                let result = try await session.respond(
                    to: "Proofread and correct any grammar or spelling errors in the following text. Return only the corrected text:\n\n\(input.text)"
                )
                try writeOutput(Output(output: result.content))

            default:
                break
            }
        } catch {
            writeError("Foundation Models error: \(error.localizedDescription)")
        }
    } else {
        writeError("Apple Intelligence (Foundation Models) requires macOS 26+.")
    }
    #else
    writeError("Apple Intelligence (Foundation Models) requires macOS 26+ with Apple Silicon. This binary was compiled without FoundationModels support.")
    #endif

// --- Foundation Models: generate-text ---
case "generate-text":
    guard let genInput = try? JSONDecoder().decode(GenerateTextInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected GenerateTextInput.")
        exit(1)
    }

    #if canImport(FoundationModels)
    if #available(macOS 26, *) {
        do {
            let instructions = genInput.systemInstruction ?? "You are a helpful assistant."
            let session = LanguageModelSession(instructions: instructions)
            let result = try await session.respond(to: genInput.prompt)
            try writeOutput(Output(output: result.content))
        } catch {
            writeError("Foundation Models error: \(error.localizedDescription)")
        }
    } else {
        writeError("generate-text requires macOS 26+.")
    }
    #else
    writeError("generate-text requires macOS 26+ with Apple Silicon. This binary was compiled without FoundationModels support.")
    #endif

// --- Foundation Models: generate-structured ---
case "generate-structured":
    guard let structInput = try? JSONDecoder().decode(GenerateStructuredInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected GenerateStructuredInput.")
        exit(1)
    }

    #if canImport(FoundationModels)
    if #available(macOS 26, *) {
        do {
            let instructions = structInput.systemInstruction ?? "You are a helpful assistant. Respond with valid JSON only."
            let session = LanguageModelSession(instructions: instructions)
            let prompt: String
            if let schema = structInput.schema {
                let schemaDesc = schema.map { "\($0.key): \($0.value.type)\($0.value.description.map { " — \($0)" } ?? "")" }.joined(separator: "\n")
                prompt = "\(structInput.prompt)\n\nRespond with a JSON object matching this schema:\n\(schemaDesc)"
            } else {
                prompt = "\(structInput.prompt)\n\nRespond with valid JSON only."
            }
            let result = try await session.respond(to: prompt)
            let content = result.content.trimmingCharacters(in: .whitespacesAndNewlines)
            if let jsonData = content.data(using: .utf8),
               let jsonObj = try? JSONSerialization.jsonObject(with: jsonData) {
                let formatted = try JSONSerialization.data(withJSONObject: jsonObj, options: [.sortedKeys])
                let jsonDict: [String: Any] = ["output": String(data: formatted, encoding: .utf8) ?? content, "valid_json": true]
                let outData = try JSONSerialization.data(withJSONObject: jsonDict)
                FileHandle.standardOutput.write(outData)
                FileHandle.standardOutput.write(Data("\n".utf8))
            } else {
                let jsonDict: [String: Any] = ["output": content, "valid_json": false]
                let outData = try JSONSerialization.data(withJSONObject: jsonDict)
                FileHandle.standardOutput.write(outData)
                FileHandle.standardOutput.write(Data("\n".utf8))
            }
        } catch {
            writeError("Foundation Models error: \(error.localizedDescription)")
        }
    } else {
        writeError("generate-structured requires macOS 26+.")
    }
    #else
    writeError("generate-structured requires macOS 26+ with Apple Silicon. This binary was compiled without FoundationModels support.")
    #endif

// --- Foundation Models: tag-content ---
case "tag-content":
    guard let tagInput = try? JSONDecoder().decode(TagContentInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected TagContentInput.")
        exit(1)
    }

    #if canImport(FoundationModels)
    if #available(macOS 26, *) {
        do {
            let tagList = tagInput.tags.joined(separator: ", ")
            let instructions = "You are a content classification system. Classify text into the provided categories. Respond with ONLY a JSON object mapping each applicable tag to a confidence score between 0.0 and 1.0."
            let session = LanguageModelSession(instructions: instructions)
            let prompt = "Classify this text into these categories: [\(tagList)]\n\nText: \(tagInput.text)\n\nRespond with a JSON object like {\"tag\": confidence_score} for each applicable tag."
            let result = try await session.respond(to: prompt)
            let content = result.content.trimmingCharacters(in: .whitespacesAndNewlines)
            if let jsonData = content.data(using: .utf8),
               let jsonObj = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
                let outDict: [String: Any] = ["tags": jsonObj, "text_preview": String(tagInput.text.prefix(100))]
                let outData = try JSONSerialization.data(withJSONObject: outDict, options: [.sortedKeys])
                FileHandle.standardOutput.write(outData)
                FileHandle.standardOutput.write(Data("\n".utf8))
            } else {
                let outDict: [String: Any] = ["output": content, "text_preview": String(tagInput.text.prefix(100))]
                let outData = try JSONSerialization.data(withJSONObject: outDict)
                FileHandle.standardOutput.write(outData)
                FileHandle.standardOutput.write(Data("\n".utf8))
            }
        } catch {
            writeError("Foundation Models error: \(error.localizedDescription)")
        }
    } else {
        writeError("tag-content requires macOS 26+.")
    }
    #else
    writeError("tag-content requires macOS 26+ with Apple Silicon. This binary was compiled without FoundationModels support.")
    #endif

// --- Foundation Models: ai-chat ---
case "ai-chat":
    guard let chatInput = try? JSONDecoder().decode(AiChatInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected AiChatInput.")
        exit(1)
    }

    #if canImport(FoundationModels)
    if #available(macOS 26, *) {
        do {
            let instructions = chatInput.systemInstruction ?? "You are a helpful on-device AI assistant."
            let session = LanguageModelSession(instructions: instructions)
            let result = try await session.respond(to: chatInput.message)
            let outDict: [String: Any] = [
                "sessionName": chatInput.sessionName,
                "response": result.content,
            ]
            let outData = try JSONSerialization.data(withJSONObject: outDict, options: [.sortedKeys])
            FileHandle.standardOutput.write(outData)
            FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
            writeError("Foundation Models error: \(error.localizedDescription)")
        }
    } else {
        writeError("ai-chat requires macOS 26+.")
    }
    #else
    writeError("ai-chat requires macOS 26+ with Apple Silicon. This binary was compiled without FoundationModels support.")
    #endif

// --- Foundation Models: ai-status ---
case "ai-status":
    let processInfo = ProcessInfo.processInfo
    let osVersion = processInfo.operatingSystemVersion
    let versionString = "\(osVersion.majorVersion).\(osVersion.minorVersion).\(osVersion.patchVersion)"

    #if arch(arm64)
    let hasAppleSilicon = true
    #else
    let hasAppleSilicon = false
    #endif

    #if canImport(FoundationModels)
    let fmSupported = true
    let available = hasAppleSilicon && osVersion.majorVersion >= 26
    let message: String
    if available {
        message = "Apple Foundation Models are available and ready to use."
    } else if !hasAppleSilicon {
        message = "Apple Foundation Models require Apple Silicon (M1 or later)."
    } else {
        message = "Apple Foundation Models require macOS 26 or later. Current: macOS \(versionString)."
    }
    #else
    let fmSupported = false
    let available = false
    let message = "This binary was compiled without Foundation Models support. Requires macOS 26+ SDK."
    #endif

    let statusOutput = AiStatusOutput(
        available: available,
        message: message,
        macOSVersion: versionString,
        hasAppleSilicon: hasAppleSilicon,
        foundationModelsSupported: fmSupported
    )
    try writeJSON(statusOutput)

// --- CoreLocation: get current location ---
case "get-location":
    let fetcher = LocationFetcher()
    do {
        let location = try await fetcher.fetch()
        let formatter = ISO8601DateFormatter()
        let output = LocationOutput(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            altitude: location.altitude,
            horizontalAccuracy: location.horizontalAccuracy,
            verticalAccuracy: location.verticalAccuracy,
            timestamp: formatter.string(from: location.timestamp)
        )
        try writeJSON(output)
    } catch {
        writeError("Location error: \(error.localizedDescription)")
    }

// --- CoreLocation: check permission ---
case "location-permission":
    let status: CLAuthorizationStatus
    if #available(macOS 14.0, *) {
        status = CLLocationManager().authorizationStatus
    } else {
        status = CLLocationManager.authorizationStatus()
    }
    let authorized = status == .authorizedAlways
    let output = LocationPermissionOutput(status: locationStatusString(status), authorized: authorized)
    try writeJSON(output)

// --- CoreBluetooth: state ---
case "bluetooth-state":
    let bt = BluetoothManager()
    let state = await bt.initialize()
    let output = BluetoothStateOutput(state: bluetoothStateString(state), powered: state == .poweredOn)
    try writeJSON(output)

// --- CoreBluetooth: scan ---
case "scan-bluetooth":
    let scanInput = try? JSONDecoder().decode(BluetoothScanInput.self, from: stdinData)
    let duration = scanInput?.duration ?? 5.0
    let bt = BluetoothManager()
    let devices = await bt.scan(duration: min(max(duration, 1), 30))
    let output = BluetoothScanOutput(total: devices.count, devices: devices)
    try writeJSON(output)

// --- CoreBluetooth: connect ---
case "connect-bluetooth":
    guard let connInput = try? JSONDecoder().decode(BluetoothConnectInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected BluetoothConnectInput.")
        exit(1)
    }
    let bt = BluetoothManager()
    do {
        let name = try await bt.connect(identifier: connInput.identifier)
        let output = BluetoothConnectOutput(success: true, identifier: connInput.identifier, name: name)
        try writeJSON(output)
    } catch {
        writeError("Bluetooth connect error: \(error.localizedDescription)")
    }

// --- CoreBluetooth: disconnect ---
case "disconnect-bluetooth":
    guard let disconnInput = try? JSONDecoder().decode(BluetoothConnectInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected BluetoothConnectInput.")
        exit(1)
    }
    let bt = BluetoothManager()
    do {
        let name = try await bt.disconnect(identifier: disconnInput.identifier)
        let output = BluetoothConnectOutput(success: true, identifier: disconnInput.identifier, name: name)
        try writeJSON(output)
    } catch {
        writeError("Bluetooth disconnect error: \(error.localizedDescription)")
    }

// --- ImageCreator: generate image from text ---
case "generate-image":
    guard let imgInput = try? JSONDecoder().decode(GenerateImageInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected GenerateImageInput.")
        exit(1)
    }

    #if canImport(ImagePlayground)
    if #available(macOS 26, *) {
        do {
            let creator = ImageCreator()
            let outputPath = imgInput.outputPath ?? NSTemporaryDirectory() + "airmcp-image-\(Int(Date().timeIntervalSince1970)).png"
            let outputURL = URL(fileURLWithPath: outputPath)

            let image = try await creator.generateImage(
                ImageCreationParameters(source: .text(imgInput.prompt))
            )
            guard let pngData = image.pngData() else {
                writeError("Image generation succeeded but PNG conversion failed")
                exit(1)
            }
            try pngData.write(to: outputURL)
            let output = GenerateImageOutput(generated: true, path: outputPath)
            try writeJSON(output)
        } catch {
            writeError("ImageCreator error: \(error.localizedDescription)")
        }
    } else {
        writeError("Image generation requires macOS 26+.")
    }
    #else
    writeError("Image generation requires macOS 26+ with Apple Silicon. This binary was compiled without ImagePlayground support.")
    #endif

// --- Core Spotlight: index items for Siri/Spotlight discovery ---
case "spotlight-index":
    guard let indexInput = try? JSONDecoder().decode(SpotlightIndexInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected SpotlightIndexInput.")
        exit(1)
    }

    let searchableItems = indexInput.items.map { item -> CSSearchableItem in
        let attrs = CSSearchableItemAttributeSet(contentType: .text)
        attrs.title = item.title
        attrs.textContent = item.content
        attrs.contentDescription = "AirMCP \(item.source)"
        attrs.identifier = item.id
        return CSSearchableItem(
            uniqueIdentifier: "airmcp.\(item.source).\(item.id)",
            domainIdentifier: "com.airmcp.\(item.source)",
            attributeSet: attrs
        )
    }

    do {
        try await CSSearchableIndex.default().indexSearchableItems(searchableItems)
        let output = SpotlightIndexOutput(indexed: searchableItems.count, success: true)
        try writeJSON(output)
    } catch {
        writeError("Spotlight indexing error: \(error.localizedDescription)")
    }

// --- Core Spotlight: clear indexed items ---
case "spotlight-clear":
    do {
        let domains = ["com.airmcp.notes", "com.airmcp.calendar", "com.airmcp.reminders", "com.airmcp.mail"]
        try await CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: domains)
        try writeJSON(["cleared": true, "domains": domains])
    } catch {
        writeError("Spotlight clear error: \(error.localizedDescription)")
    }

// --- Vision: scan document from image ---
case "scan-document":
    guard let scanInput = try? JSONDecoder().decode(ScanDocumentInput.self, from: stdinData) else {
        writeError("Invalid JSON. Expected ScanDocumentInput.")
        exit(1)
    }

    let imageURL = URL(fileURLWithPath: scanInput.imagePath)
    guard FileManager.default.fileExists(atPath: scanInput.imagePath) else {
        writeError("Image file not found: \(scanInput.imagePath)")
        exit(1)
    }

    if #available(macOS 26, *) {
        do {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true

            let handler = VNImageRequestHandler(url: imageURL, options: [:])
            try handler.perform([request])

            var elements: [DocumentElement] = []
            if let observations = request.results {
                for obs in observations {
                    let text = obs.topCandidates(1).first?.string ?? ""
                    let confidence = Double(obs.confidence)
                    elements.append(DocumentElement(type: "text", text: text, confidence: confidence))
                }
            }
            let output = ScanDocumentOutput(elements: elements, total: elements.count)
            try writeJSON(output)
        } catch {
            writeError("Vision scan error: \(error.localizedDescription)")
        }
    } else {
        writeError("Document scanning requires macOS 14+.")
    }

default:
    writeError("Unknown command: \(command). Use: embed-text, embed-batch, summarize, rewrite, proofread, generate-text, generate-structured, tag-content, ai-chat, ai-status, create-recurring-event, create-recurring-reminder, import-photo, delete-photos, get-location, location-permission, bluetooth-state, scan-bluetooth, connect-bluetooth, disconnect-bluetooth, generate-image, scan-document")
}
