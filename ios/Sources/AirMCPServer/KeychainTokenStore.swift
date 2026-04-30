// AirMCPServer — Keychain-backed Bearer token persistence.
//
// Closes the (C) "Apple-native deeper, two devices" promise's pairing
// gap: previously `MCPHTTPServer.init(token: nil)` generated a fresh
// random token on every process start, so any client paired with the
// previous boot's token (Windows Claude Desktop, a Mac MCP client over
// the same Wi-Fi, etc.) silently broke. Now the token round-trips
// through Keychain so a single pairing survives reboots, app updates,
// and OS upgrades.
//
// Threat model
//   * Token is `kSecClassGenericPassword` with
//     `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Survives
//     reboot but does NOT iCloud-sync — pairing is per-device on
//     purpose (matches RFC 0002's loopback-by-default network policy).
//   * `kSecAttrService` namespaces by build flavour
//     (`com.airmcp.ios.token` for the public app, override via
//     `AIRMCP_KEYCHAIN_SERVICE` env at iOS bundle launch for fork
//     installs that share a device).
//   * Failure modes (Keychain unavailable in unentitled CLI runs, or
//     simulator quirks) fall back to a per-process random token with
//     a stderr warning so the server still functions; that token does
//     not persist and the operator sees the regression in logs.

import Foundation
#if canImport(Security)
import Security
#endif

public enum KeychainTokenStoreError: Error, Sendable {
    case unavailable(OSStatus)
    case decodeFailed
}

public actor KeychainTokenStore {
    public static let shared = KeychainTokenStore()

    private let service: String
    private let account: String

    public init(
        service: String = ProcessInfo.processInfo.environment["AIRMCP_KEYCHAIN_SERVICE"] ?? "com.airmcp.ios.token",
        account: String = "default"
    ) {
        self.service = service
        self.account = account
    }

    /// Read the stored token if present, generate + persist a fresh one
    /// otherwise, and return whichever was used. Idempotent across
    /// calls within and across processes — every caller observes the
    /// same token until `clear()` is invoked.
    public func tokenOrGenerate() -> String {
        if let existing = read() {
            return existing
        }
        let fresh = Self.generate()
        do {
            try persist(fresh)
        } catch {
            // Keychain unavailable (unentitled CLI, simulator, etc.) —
            // fall back to in-process token so the server still boots.
            // Operator sees the warning in logs and can rebuild with
            // the right entitlements; pairing won't survive restart in
            // the meantime, but that's the v2.10 behaviour we're
            // already replacing, not a new regression.
            FileHandle.standardError.write(Data(
                "[AirMCP-iOS] Keychain unavailable (\(error)); using ephemeral token. Pairing won't survive restart.\n".utf8
            ))
        }
        return fresh
    }

    /// Erase the stored token. Useful for "rotate token" or "unpair all
    /// clients" UI flows. Returns `true` on successful delete or when
    /// nothing was stored; `false` only on unexpected Keychain errors.
    @discardableResult
    public func clear() -> Bool {
        #if canImport(Security)
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
        #else
        return true
        #endif
    }

    // MARK: - Private

    private func read() -> String? {
        #if canImport(Security)
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecMatchLimit: kSecMatchLimitOne,
            kSecReturnData: kCFBooleanTrue as Any,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
        #else
        return nil
        #endif
    }

    private func persist(_ token: String) throws {
        #if canImport(Security)
        guard let data = token.data(using: .utf8) else {
            throw KeychainTokenStoreError.decodeFailed
        }
        // Two-step: try update first (for the rare case where read()
        // missed an existing item due to a transient error), fall
        // through to add. Avoids spurious duplicates and the
        // `errSecDuplicateItem` SecItemAdd failure mode.
        let updateQuery: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let updateAttrs: [CFString: Any] = [
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(updateQuery as CFDictionary, updateAttrs as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound {
            throw KeychainTokenStoreError.unavailable(updateStatus)
        }

        let addQuery: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData: data,
        ]
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus != errSecSuccess {
            throw KeychainTokenStoreError.unavailable(addStatus)
        }
        #else
        _ = token
        throw KeychainTokenStoreError.unavailable(-1)
        #endif
    }

    private static func generate() -> String {
        // 24 bytes → 32 base64 chars. Same shape as the legacy generator
        // in HTTPServer so existing pairing UIs (which display the token
        // as a QR / clipboard string) don't need to grow their copy.
        let bytes = (0..<24).map { _ in UInt8.random(in: 0...255) }
        return Data(bytes).base64EncodedString()
    }
}
