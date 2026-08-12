import Foundation

/// The SwiftPM-generated `Bundle.module` accessor only searches two places:
/// `Bundle.main.bundleURL` (the .app root when packaged) and the absolute
/// build-directory path baked in at compile time. Neither exists in a shipped
/// bundle — macOS convention puts resource bundles under `Contents/Resources`,
/// and a stray bundle at the .app root would break the code-signature seal.
/// The result was an app that passed signing and notarization but crashed in
/// `Bundle.module` before drawing the menu bar icon.
///
/// This accessor searches `resourceURL` first, which is `Contents/Resources`
/// in a packaged app and the build directory during `swift run` (where SwiftPM
/// drops the bundle next to the executable) — so both layouts resolve through
/// the same path and the packaged case is no longer a special case that only
/// fails after notarization.
extension Bundle {
    static let moduleResources: Bundle = {
        let name = "AirMCPApp_AirMCPApp.bundle"
        let candidates: [URL?] = [Bundle.main.resourceURL, Bundle.main.bundleURL]
        for base in candidates {
            if let base, let bundle = Bundle(url: base.appendingPathComponent(name)) {
                return bundle
            }
        }
        // Under `swift test` Bundle.main is the xctest runner, so neither URL
        // above resolves. The generated accessor's baked-in build path covers
        // that case — keep it as the final fallback rather than reimplementing.
        return Bundle.module
    }()
}
