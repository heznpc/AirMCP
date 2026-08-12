import Foundation

/// Locate SwiftPM resources in both execution layouts used by AirMCP.
///
/// SwiftPM's generated `Bundle.module` accessor assumes the resource bundle
/// is next to the executable. A macOS .app correctly places resources under
/// `Contents/Resources`, so the generated accessor can otherwise fall through
/// to the build-machine path and abort before the menu-bar app launches.
enum AirMCPResourceBundle {
    static let bundle: Bundle = {
        let resourceBundleName = "AirMCPApp_AirMCPApp.bundle"
        let candidates = [
            Bundle.main.resourceURL?.appendingPathComponent(resourceBundleName),
            Bundle.main.bundleURL.appendingPathComponent(resourceBundleName),
        ].compactMap { $0 }

        for candidate in candidates {
            if let bundle = Bundle(url: candidate) {
                return bundle
            }
        }

        let searched = candidates.map(\.path).joined(separator: ", ")
        fatalError("Could not load AirMCP resource bundle; searched: \(searched)")
    }()
}
