// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "AirMCPWidget",
    defaultLocalization: "en",
    platforms: [.macOS(.v14)],
    targets: [
        // Display-only snapshot contract shared by the main app (writer) and the
        // widget (reader). A library target so its pure serialization/redaction
        // logic is unit-testable without WidgetKit or an App Group entitlement.
        .target(
            name: "WidgetSnapshotKit",
            path: "SnapshotKit"
        ),
        .executableTarget(
            name: "AirMCPWidget",
            dependencies: ["WidgetSnapshotKit"],
            path: "Sources",
            resources: [
                .process("Resources/en.lproj"),
                .process("Resources/ko.lproj"),
            ],
            linkerSettings: [
                .linkedFramework("WidgetKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("EventKit"),
            ]
        ),
        .testTarget(
            name: "WidgetSnapshotKitTests",
            dependencies: ["WidgetSnapshotKit"],
            path: "Tests/WidgetSnapshotKitTests"
        ),
    ]
)
