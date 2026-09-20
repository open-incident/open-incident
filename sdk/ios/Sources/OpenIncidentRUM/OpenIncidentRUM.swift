import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Open Incident — real user monitoring, in an iOS application.
///
/// The same two rules as the browser SDK, because they are the rules of any
/// library that ships inside somebody else's product:
///
///  1. **It never throws into the host application.** There is no `try` in the
///     public surface and no force-unwrap anywhere below. A failure here costs
///     its own measurement and nothing else.
///  2. **It never blocks.** Every public call hands work to a serial queue and
///     returns; nothing is encoded, and no request is made, on the thread that
///     is drawing the screen.
///
/// What it does **not** do, said here rather than discovered later: it does not
/// capture crashes. Doing that properly means signal handlers and a Mach
/// exception port, a written-to-disk report replayed on the next launch, and
/// symbolication — a subsystem, not a feature. An SDK that claims crash
/// reporting and delivers a `try/catch` is worse than one that says it has
/// none, because somebody stops looking for a real one. Report what you catch
/// with `error(_:)`.
public enum OpenIncidentRUM {

    // MARK: - Starting

    /// Starts reporting. Safe to call twice; the second call is ignored.
    ///
    /// - Parameters:
    ///   - applicationId: The RUM application id, from **Telemetry → Connect**.
    ///     It is a public write-only token — it ships inside your binary and
    ///     anybody can read it out. The workspace has to allow mobile
    ///     applications before it is accepted at all.
    ///   - endpoint: The ingestion address, without a path.
    ///   - sampleRate: Share of sessions reported, drawn once per session.
    public static func start(
        applicationId: String,
        endpoint: URL,
        sampleRate: Double = 1,
        service: String = ""
    ) {
        queue.async {
            guard client == nil, !applicationId.isEmpty else { return }
            let session = Session.resume(sampleRate: sampleRate)
            guard session.sampled else { return }
            client = Client(applicationId: applicationId, endpoint: endpoint, session: session, service: service)
            observeLifecycle()
            reportLaunch()
        }
    }

    // MARK: - What the application reports

    /// A screen the user is now looking at.
    ///
    /// Also closes the previous one: the time between two calls is what
    /// `screen_load` measures, which is the number a user feels after a tap.
    public static func screen(_ name: String) {
        let at = Date()
        queue.async {
            guard let c = client else { return }
            Session.touch()
            if let opened = screenOpenedAt, !currentScreen.isEmpty {
                let ms = at.timeIntervalSince(opened) * 1000
                // Only the first paint of a screen is a load. A screen the user
                // sat on for four minutes is not a four-minute load, and the
                // previous version of this reported exactly that.
                if !measured.contains(currentScreen) {
                    measured.insert(currentScreen)
                    c.add(vital("screen_load", ms, screen: currentScreen, at: at))
                }
            }
            currentScreen = name
            screenOpenedAt = at
            c.newView()
            c.add(Event(kind: .screenView, at: at, screen: name))
        }
    }

    /// Anything the application wants on the timeline: a tap, a step, a purchase.
    public static func action(_ name: String, attributes: [String: String] = [:]) {
        let at = Date()
        queue.async {
            guard let c = client else { return }
            Session.touch()
            c.add(Event(kind: .action, at: at, screen: currentScreen, message: name, attributes: attributes))
        }
    }

    /// Something that went wrong and was caught.
    public static func error(_ error: Error, type: String = "", stack: String = "") {
        report(type: type.isEmpty ? String(describing: Swift.type(of: error)) : type,
               message: error.localizedDescription,
               stack: stack)
    }

    /// The same, when there is no `Error` to hand.
    public static func error(type: String, message: String, stack: String = "") {
        report(type: type, message: message, stack: stack)
    }

    /// One network call, with what came back.
    ///
    /// Reported by the application rather than intercepted. Interception means
    /// a `URLProtocol` that re-issues every request through a session of ours,
    /// which changes the behaviour of uploads, streaming and background
    /// transfers in an application nobody here can test. The trade is honest:
    /// a line of code per call site, and no chance of breaking the network of
    /// the app we were added to measure.
    public static func resource(
        url: String,
        method: String = "GET",
        status: Int = 0,
        durationMs: Double = 0,
        error: String = ""
    ) {
        let at = Date()
        queue.async {
            guard let c = client else { return }
            Session.touch()
            var attributes = ["http.method": method, "http.url": url]
            if status > 0 { attributes["http.status_code"] = String(status) }
            if !error.isEmpty { attributes["error"] = error }
            c.add(Event(
                kind: .resource, at: at, screen: currentScreen,
                value: durationMs, message: url, attributes: attributes
            ))
        }
    }

    /// Name the person, however the application knows them. Hashed on arrival,
    /// with the workspace's own salt, and the value is thrown away.
    public static func identify(_ value: String?) {
        queue.async { user = value }
    }

    /// Sends whatever is buffered. Called for you when the app goes to the
    /// background; exposed because a test wants to be sure.
    public static func flush() {
        queue.async { client?.flush() }
    }

    // MARK: - Inside

    private static let queue = DispatchQueue(label: "com.openincident.rum", qos: .utility)
    private static var client: Client?
    private static var user: String?
    private static var currentScreen = ""
    private static var screenOpenedAt: Date?
    private static var measured = Set<String>()
    private static var launched = false

    static func userValue() -> String? { user }

    private static func report(type: String, message: String, stack: String) {
        let at = Date()
        queue.async {
            guard let c = client else { return }
            Session.touch()
            c.add(Event(kind: .error, at: at, screen: currentScreen,
                        errorType: type, message: message, stack: stack))
        }
    }

    private static func vital(_ name: String, _ ms: Double, screen: String, at: Date) -> Event {
        Event(kind: .vital, at: at, screen: screen, vital: name,
              value: ms.rounded(), rating: Rating.of(name, ms))
    }

    /// Cold start: from the moment the process began to the moment the first
    /// frame is on the glass.
    ///
    /// `kinfo_proc` rather than a timestamp taken in `start()`, because by then
    /// the expensive part — dyld, the runtime, the app delegate — has already
    /// happened, and a launch metric that starts after the launch measures
    /// nothing. The first frame is taken from the next main-queue turn after
    /// the window is up, which is the closest a library can get without
    /// swizzling the view controller.
    private static func reportLaunch() {
        guard !launched else { return }
        launched = true
        guard let began = processStart() else { return }
        DispatchQueue.main.async {
            let ms = Date().timeIntervalSince(began) * 1000
            // A process resumed from a saved state can report hours. Anything
            // beyond a minute is not a launch, it is a clock.
            guard ms > 0, ms < 60_000 else { return }
            queue.async {
                client?.add(vital("app_start", ms, screen: currentScreen, at: Date()))
            }
        }
    }

    private static func processStart() -> Date? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        let ok = sysctl(&name, u_int(name.count), &info, &size, nil, 0) == 0
        guard ok else { return nil }
        let started = info.kp_proc.p_starttime
        return Date(timeIntervalSince1970: Double(started.tv_sec) + Double(started.tv_usec) / 1_000_000)
    }

    private static func observeLifecycle() {
        #if canImport(UIKit)
        let centre = NotificationCenter.default
        // Flushed when the app leaves the foreground, which on a phone is the
        // equivalent of the browser's `pagehide`: it is the last moment the
        // process is reliably allowed to make a request.
        centre.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { _ in
            flush()
        }
        centre.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: nil) { _ in
            flush()
        }
        centre.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { _ in
            queue.async { Session.touch() }
        }
        #endif
    }
}
