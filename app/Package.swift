// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "AirMCPApp",
    defaultLocalization: "en",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "AirMCPApp",
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
