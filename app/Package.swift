// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "AirMCPApp",
    defaultLocalization: "en",
    platforms: [.macOS(.v14)],
    dependencies: [
        // RFC 0007 A.2a: App needs AirMCPKit so it can install
        // MCPIntentRouter's host handler at launch.
        .package(path: "../swift"),
    ],
    targets: [
        .executableTarget(
            name: "AirMCPApp",
            dependencies: [
                .product(name: "AirMCPKit", package: "swift"),
            ],
            path: "Sources/AirMCPApp",
            resources: [
                .copy("Resources/AppIcon.png"),
                .copy("Resources/AppIcon@2x.png"),
                .copy("Resources/MenuBarIcon.png"),
                .process("Resources/en.lproj"),
                .process("Resources/ko.lproj"),
            ]
        ),
    ]
)
