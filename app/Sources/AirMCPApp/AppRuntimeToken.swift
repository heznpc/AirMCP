import Darwin
import CryptoKit
import Foundation
import Security

enum AppRuntimeToken {
    private static let directoryName = "AirMCP"
    private static let fileName = "http-token"
    private static let ownerSecretFileName = "runtime-owner-secret"

    static var tokenURL: URL {
        if let override = ProcessInfo.processInfo.environment["AIRMCP_APP_RUNTIME_TOKEN_PATH"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent(directoryName, isDirectory: true).appendingPathComponent(fileName)
    }

    /// A second, app-only credential distinguishes a runtime launched by the
    /// native app from a manual process that happens to reuse its HTTP token.
    /// The runtime never returns this secret; it returns only the domain-
    /// separated SHA-256 fingerprint from its authenticated state endpoint.
    static var ownerSecretURL: URL {
        if let override = ProcessInfo.processInfo.environment["AIRMCP_APP_RUNTIME_OWNER_PATH"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        return tokenURL.deletingLastPathComponent().appendingPathComponent(ownerSecretFileName)
    }

    static func ensure() throws -> String {
        let url = tokenURL
        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        chmod(dir.path, S_IRWXU)

        if let existing = try loadExisting() {
            chmod(url.path, S_IRUSR | S_IWUSR)
            return existing
        }

        let token = try randomToken()
        if try writeTokenExclusively(token, to: url) {
            return token
        }

        let raced = try readToken(at: url)
        guard !raced.isEmpty else {
            throw NSError(
                domain: "AirMCPAppRuntimeToken",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "AirMCP app runtime token exists but is empty."]
            )
        }
        chmod(url.path, S_IRUSR | S_IWUSR)
        return raced
    }

    /// Observational callers (readiness probes and Trust Center) must not
    /// create credentials. Explicit runtime start / client connection paths
    /// use `ensure()` instead.
    static func loadExisting() throws -> String? {
        let url = tokenURL
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let token = try readToken(at: url)
        guard !token.isEmpty else {
            throw NSError(
                domain: "AirMCPAppRuntimeToken",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "AirMCP app runtime token exists but is empty."]
            )
        }
        return token
    }

    /// Create a fresh process-generation credential immediately before an
    /// explicit app-owned launch. Atomic replacement preserves the previous
    /// credential until the complete new owner-only inode is ready.
    static func rotateOwnerSecret() throws -> String {
        let url = ownerSecretURL
        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        chmod(dir.path, S_IRWXU)
        let secret = try randomToken()
        try replaceSecretAtomically(secret, at: url)
        return secret
    }

    /// Read-only ownership checks must not create a credential. This keeps a
    /// status probe from silently granting the app lifecycle control over an
    /// already-running process.
    static func loadExistingOwnerSecret() throws -> String? {
        let url = ownerSecretURL
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let secret = try readToken(at: url)
        guard secret.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil else {
            throw NSError(
                domain: "AirMCPAppRuntimeOwner",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "AirMCP runtime owner secret is invalid."]
            )
        }
        return secret
    }

    static func ownerFingerprint(for secret: String) -> String {
        let digest = SHA256.hash(data: Data("airmcp-app-owner-v1\n\(secret)".utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func expectedOwnerFingerprint() throws -> String? {
        guard let secret = try loadExistingOwnerSecret() else { return nil }
        return ownerFingerprint(for: secret)
    }

    static func fingerprint(for token: String) -> String {
        let digest = SHA256.hash(data: Data("airmcp-runtime-token-v1\n\(token)".utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// Verify value continuity without creating or repairing a token file.
    /// Client-patch transactions call this immediately before and after their
    /// mutation so replacement/deletion fails closed and can be rolled back.
    static func matchesExisting(_ expectedToken: String) -> Bool {
        guard let current = try? loadExisting() else { return false }
        return current == expectedToken
    }

    private static func readToken(at url: URL) throws -> String {
        try String(contentsOf: url, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func randomToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw NSError(
                domain: NSOSStatusErrorDomain,
                code: Int(status),
                userInfo: [NSLocalizedDescriptionKey: "Failed to generate AirMCP app runtime token."]
            )
        }

        return Data(bytes)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func writeTokenExclusively(_ token: String, to url: URL) throws -> Bool {
        let temporaryURL = url.deletingLastPathComponent().appendingPathComponent(
            ".\(url.lastPathComponent).\(UUID().uuidString).tmp"
        )
        let fd = open(temporaryURL.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        if fd == -1 {
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "Failed to create AirMCP app runtime token."]
            )
        }
        defer { unlink(temporaryURL.path) }

        let data = Data("\(token)\n".utf8)
        var writeError: Int32?
        data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let written = Darwin.write(
                    fd,
                    buffer.baseAddress?.advanced(by: offset),
                    buffer.count - offset
                )
                if written > 0 {
                    offset += written
                } else if written == -1 && errno == EINTR {
                    continue
                } else {
                    writeError = written == 0 ? EIO : errno
                    break
                }
            }
        }
        if writeError == nil && fsync(fd) == -1 {
            writeError = errno
        }
        let closeResult = close(fd)
        if writeError == nil && closeResult == -1 {
            writeError = errno
        }
        if let writeError {
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(writeError),
                userInfo: [NSLocalizedDescriptionKey: "Failed to write AirMCP app runtime token."]
            )
        }

        // Publish only a fully written owner-only inode. A competing explicit
        // start either installs its complete token or reads the winner; it can
        // never observe an empty/partial destination.
        if Darwin.link(temporaryURL.path, url.path) == -1 {
            if errno == EEXIST { return false }
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "Failed to publish AirMCP app runtime token."]
            )
        }
        chmod(url.path, S_IRUSR | S_IWUSR)
        return true
    }

    private static func replaceSecretAtomically(_ secret: String, at url: URL) throws {
        let temporaryURL = url.deletingLastPathComponent().appendingPathComponent(
            ".\(url.lastPathComponent).\(UUID().uuidString).tmp"
        )
        let fd = open(temporaryURL.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        if fd == -1 {
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "Failed to create AirMCP runtime owner secret."]
            )
        }
        var fdIsOpen = true
        defer {
            if fdIsOpen { close(fd) }
            unlink(temporaryURL.path)
        }

        let data = Data("\(secret)\n".utf8)
        var writeError: Int32?
        data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let written = Darwin.write(
                    fd,
                    buffer.baseAddress?.advanced(by: offset),
                    buffer.count - offset
                )
                if written > 0 {
                    offset += written
                } else if written == -1 && errno == EINTR {
                    continue
                } else {
                    writeError = written == 0 ? EIO : errno
                    break
                }
            }
        }
        if writeError == nil && fsync(fd) == -1 { writeError = errno }
        if close(fd) == -1, writeError == nil { writeError = errno }
        fdIsOpen = false
        if let writeError {
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(writeError),
                userInfo: [NSLocalizedDescriptionKey: "Failed to write AirMCP runtime owner secret."]
            )
        }
        guard rename(temporaryURL.path, url.path) == 0 else {
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "Failed to publish AirMCP runtime owner secret."]
            )
        }
        chmod(url.path, S_IRUSR | S_IWUSR)
    }
}
