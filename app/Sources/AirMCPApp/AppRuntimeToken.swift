import Darwin
import Foundation
import Security

enum AppRuntimeToken {
    private static let directoryName = "AirMCP"
    private static let fileName = "http-token"

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

    static func ensure() throws -> String {
        let url = tokenURL
        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        chmod(dir.path, S_IRWXU)

        if let existing = try? readToken(at: url), !existing.isEmpty {
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
        let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        if fd == -1 {
            if errno == EEXIST {
                return false
            }
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "Failed to create AirMCP app runtime token."]
            )
        }

        let data = Data("\(token)\n".utf8)
        let written = data.withUnsafeBytes { buffer in
            write(fd, buffer.baseAddress, buffer.count)
        }
        close(fd)
        guard written == data.count else {
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "Failed to write AirMCP app runtime token."]
            )
        }
        chmod(url.path, S_IRUSR | S_IWUSR)
        return true
    }
}
