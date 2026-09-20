// swift-tools-version: 5.9
import PackageDescription

/// Open Incident — real user monitoring for an iOS application.
///
/// No dependencies, and that is a requirement rather than an accident: this is
/// a library that goes into somebody else's shipping app, and every transitive
/// dependency it brings is a version conflict waiting to happen in a project
/// nobody here can see.
let package = Package(
    name: "OpenIncidentRUM",
    platforms: [.iOS(.v13)],
    products: [
        .library(name: "OpenIncidentRUM", targets: ["OpenIncidentRUM"])
    ],
    targets: [
        .target(name: "OpenIncidentRUM"),
        .testTarget(name: "OpenIncidentRUMTests", dependencies: ["OpenIncidentRUM"]),
    ]
)
