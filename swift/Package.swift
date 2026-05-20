// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "AirMcpBridge",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "AirMCPKit", targets: ["AirMCPKit"]),
    ],
    targets: [
        .target(
            name: "AirMCPKit",
            path: "Sources/AirMCPKit"
        ),
        .executableTarget(
            name: "AirMcpBridge",
            dependencies: ["AirMCPKit"],
            path: "Sources/AirMcpBridge"
        ),
        .testTarget(
            name: "AirMCPKitTests",
            dependencies: ["AirMCPKit"],
            path: "Tests/AirMCPKitTests"
        ),
    ]
)
