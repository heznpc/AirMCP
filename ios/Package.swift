// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "AirMCPiOS",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AirMCPServer", targets: ["AirMCPServer"]),
    ],
    dependencies: [
        .package(path: "../swift"),
        .package(url: "https://github.com/hummingbird-project/hummingbird.git", from: "2.0.0"),
    ],
    targets: [
        .target(
            name: "AirMCPServer",
            dependencies: [
                .product(name: "AirMCPKit", package: "swift"),
                .product(name: "Hummingbird", package: "hummingbird"),
            ],
            path: "Sources/AirMCPServer"
        ),
        .executableTarget(
            name: "AirMCPiOS",
            dependencies: [
                .product(name: "AirMCPKit", package: "swift"),
                "AirMCPServer",
            ],
            path: "Sources/AirMCPiOS"
        ),
    ]
)
