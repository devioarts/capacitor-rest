// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DevioartsCapacitorRest",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "DevioartsCapacitorRest",
            targets: ["CapacitorRESTPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.80.0")
    ],
    targets: [
        .target(
            name: "CapacitorRESTPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "NIO", package: "swift-nio"),
                .product(name: "NIOHTTP1", package: "swift-nio"),
                .product(name: "NIOPosix", package: "swift-nio")
            ],
            path: "ios/Sources/CapacitorRESTPlugin"),
        .testTarget(
            name: "CapacitorRESTPluginTests",
            dependencies: ["CapacitorRESTPlugin"],
            path: "ios/Tests/CapacitorRESTPluginTests")
    ]
)
