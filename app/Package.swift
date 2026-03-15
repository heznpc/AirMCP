// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "AirMCPApp",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "AirMCPApp",
            path: "Sources/AirMCPApp",
            resources: [
                .copy("Resources")
            ]
        ),
    ]
)
