import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// The buffer and the request.
///
/// Everything here runs on the SDK's serial queue, which is why nothing is
/// locked: the queue *is* the lock, and it is the one the public surface hands
/// work to.
final class Client {
    /// The ingest's own ceiling. A batch that reaches it is dropped from the
    /// oldest end, keeping the newest — the half anybody would want.
    static let maxEvents = 1000
    /// Flushed at this many, or on the timer, or when the app backgrounds.
    static let batchAt = 40
    static let interval: TimeInterval = 15

    private let url: URL
    private let session: Session
    private let device: [String: String]
    private var buffer: [Event] = []
    private var view: String = Session.newId()
    private var timer: DispatchSourceTimer?
    private let http: URLSession

    init(applicationId: String, endpoint: URL, session: Session, service: String) {
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.path = "/v1/rum"
        components?.queryItems = [URLQueryItem(name: "app", value: applicationId)]
        self.url = components?.url ?? endpoint
        self.session = session
        self.device = Client.describeDevice(service: service)

        let configuration = URLSessionConfiguration.ephemeral
        // Telemetry is never worth a retry storm or a stalled queue in an app
        // whose network is already unhappy.
        configuration.timeoutIntervalForRequest = 10
        configuration.waitsForConnectivity = false
        configuration.httpShouldSetCookies = false
        self.http = URLSession(configuration: configuration)

        let t = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "com.openincident.rum.timer"))
        t.schedule(deadline: .now() + Client.interval, repeating: Client.interval)
        t.setEventHandler { [weak self] in
            guard let self else { return }
            DispatchQueue(label: "com.openincident.rum.flush").async { self.flush() }
        }
        t.resume()
        self.timer = t
    }

    deinit { timer?.cancel() }

    /// A new view id, so events after a screen change group under it.
    func newView() { view = Session.newId() }

    func add(_ event: Event) {
        buffer.append(event)
        if buffer.count > Client.maxEvents {
            buffer.removeFirst(buffer.count - Client.maxEvents)
        }
        if buffer.count >= Client.batchAt { flush() }
    }

    func flush() {
        guard !buffer.isEmpty else { return }
        let batch = buffer
        buffer = []
        let user = OpenIncidentRUM.userValue()
        let body: [String: Any] = [
            // The device states itself rather than being guessed from a
            // user-agent. A phone has no honest one to send, and a faked one is
            // how "iPhone" ends up filed under "Safari".
            "app": device,
            "events": batch.map { $0.payload(session: session.id, view: view, user: user) },
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        // A dropped batch is dropped. Holding it would grow without bound in an
        // application that is offline, and the events it holds are stale by the
        // time the network returns.
        http.dataTask(with: request).resume()
    }

    private static func describeDevice(service: String) -> [String: String] {
        var out = ["platform": "ios"]
        #if canImport(UIKit)
        out["os"] = "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)"
        out["device"] = hardware()
        #else
        out["os"] = "iOS"
        out["device"] = hardware()
        #endif
        let bundle = Bundle.main
        let name = service.isEmpty
            ? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "iOS app")
            : service
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        out["app"] = version.isEmpty ? name : "\(name) \(version)"
        return out
    }

    /// `iPhone17,1` rather than "iPhone". The marketing name changes with the
    /// season and the identifier is what a crash report will also carry.
    private static func hardware() -> String {
        var info = utsname()
        uname(&info)
        let size = MemoryLayout.size(ofValue: info.machine)
        let machine = withUnsafePointer(to: &info.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: size) {
                String(validatingUTF8: $0) ?? ""
            }
        }
        // A simulator reports the Mac it runs on, which is never what the
        // reader means by "device".
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return "\(simulated) (simulator)"
        }
        return machine
    }
}
