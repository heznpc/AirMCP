// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "AirMcpBridge",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "AirMcpBridge",
            path: "Sources/AirMcpBridge"
        ),
    ]
)
