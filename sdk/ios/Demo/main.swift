import UIKit

// `UIApplicationMain` by hand rather than `@main`, so this harness builds with
// a plain `swiftc` and needs no Xcode project. The point of it is to be run —
// an SDK verified only by unit tests is an SDK nobody has watched send
// anything.
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
