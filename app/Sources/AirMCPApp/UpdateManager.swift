import Foundation
import AppKit

@MainActor
@Observable
final class UpdateManager {

    var availableVersion: String?
    var isUpdating = false
    var updateError: String?
    private var releasePageURL: URL?

    private var timer: Timer?
    private static let checkInterval: TimeInterval = 3600 // 1 hour
    private let currentVersion = "2.16.0"

    var currentVersionString: String { currentVersion }

    // MARK: - Periodic Check

    func startPeriodicChecks() {
        checkForUpdate()
        timer = Timer.scheduledTimer(withTimeInterval: Self.checkInterval, repeats: true) {
            [weak self] _ in
            Task { @MainActor in
                self?.checkForUpdate()
            }
        }
    }

    func stopPeriodicChecks() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Check

    func checkForUpdate() {
        Task {
            let release = await Self.fetchLatestSignedAppRelease()
            guard let release else { return }
            if Self.isNewer(release.version, than: currentVersion) {
                availableVersion = release.version
                releasePageURL = release.pageURL
            } else {
                availableVersion = nil
                releasePageURL = nil
            }
        }
    }

    // MARK: - Update

    func performUpdate() {
        // Updating a self-contained, signed app is an app-bundle operation.
        // A global package mutation cannot change the compiled runtime pin or the
        // signed bundle, so the app opens the exact signed GitHub release and
        // never reports a global npm update as an app update.
        guard let releasePageURL else {
            updateError = L("update.signedReleaseUnavailable")
            return
        }
        updateError = nil
        NSWorkspace.shared.open(releasePageURL)
    }

    // MARK: - Static Helpers (nonisolated)

    private struct AppRelease: Sendable {
        let version: String
        let pageURL: URL
    }

    private struct GitHubRelease: Decodable {
        struct Asset: Decodable { let name: String }
        let tagName: String
        let htmlURL: URL
        let assets: [Asset]

        enum CodingKeys: String, CodingKey {
            case tagName = "tag_name"
            case htmlURL = "html_url"
            case assets
        }
    }

    private nonisolated static func fetchLatestSignedAppRelease() async -> AppRelease? {
        guard let url = URL(string: "https://api.github.com/repos/heznpc/AirMCP/releases/latest") else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("AirMCP/\(AirMcpConstants.npmPackageVersion)", forHTTPHeaderField: "User-Agent")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
            let version = release.tagName.trimmingCharacters(in: CharacterSet(charactersIn: "v"))
            let expectedAsset = "AirMCP-\(version).zip"
            guard release.assets.contains(where: { $0.name == expectedAsset }) else { return nil }
            return AppRelease(version: version, pageURL: release.htmlURL)
        } catch {
            return nil
        }
    }

    /// Simple semver comparison: returns true if `a` is newer than `b`.
    private static func isNewer(_ a: String, than b: String) -> Bool {
        let aParts = a.split(separator: ".").compactMap { Int($0) }
        let bParts = b.split(separator: ".").compactMap { Int($0) }
        for i in 0..<max(aParts.count, bParts.count) {
            let av = i < aParts.count ? aParts[i] : 0
            let bv = i < bParts.count ? bParts[i] : 0
            if av > bv { return true }
            if av < bv { return false }
        }
        return false
    }
}
