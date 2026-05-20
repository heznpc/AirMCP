// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "AirMCPWidget",
    defaultLocalization: "en",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "AirMCPWidget",
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
    ]
)
