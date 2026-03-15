// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "iConnectApp",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "iConnectApp",
            path: "Sources/iConnectApp",
            resources: [
                .copy("Resources")
            ]
        ),
    ]
)
