import Foundation

/// One thing that happened in the application, in the shape the ingest reads.
///
/// A struct with explicit JSON rather than `Codable` against the wire format:
/// the endpoint takes a small, stable, hand-written object, and generating it
/// from Swift property names means a rename in this file silently changes the
/// protocol.
struct Event {
    enum Kind: String {
        case screenView = "page_view"
        case vital = "mobile_vital"
        case error
        case resource
        case action
        case longTask = "long_task"
    }

    let kind: Kind
    let at: Date
    var screen: String = ""
    var vital: String = ""
    var value: Double = 0
    var rating: String = ""
    var errorType: String = ""
    var message: String = ""
    var stack: String = ""
    var attributes: [String: String] = [:]

    func payload(session: String, view: String, user: String?) -> [String: Any] {
        var out: [String: Any] = [
            "type": kind.rawValue,
            "ts": Int(at.timeIntervalSince1970 * 1000),
            "session": session,
            "view": view,
            // A screen has no URL. `route` is the field the product groups by —
            // one row per screen rather than one per visitor — and a screen
            // name is exactly that, so it goes there and `url` stays empty.
            "route": screen,
            "url": "",
        ]
        if !vital.isEmpty {
            out["vital"] = vital
            out["rating"] = rating
        }
        // Outside the vital, `value` is how long a resource took — the one
        // thing worth knowing about a network call. Sending it only alongside a
        // vital name dropped it silently, which is how the first run produced
        // rows saying a request happened and not that it took 143 ms.
        if value != 0 { out["value"] = value }
        if !errorType.isEmpty { out["errorType"] = errorType }
        if !message.isEmpty { out["message"] = message }
        if !stack.isEmpty { out["stack"] = stack }
        if !attributes.isEmpty { out["attributes"] = attributes }
        if let user, !user.isEmpty { out["user"] = user }
        return out
    }
}

/// The thresholds the two mobile timings are rated against, in milliseconds.
///
/// Carried in the event rather than applied when the chart is drawn, for the
/// same reason the browser SDK carries Google's: a rating that moved under a
/// stored row is a chart nobody can compare to last month.
enum Rating {
    static func of(_ vital: String, _ ms: Double) -> String {
        let bounds: (Double, Double)
        switch vital {
        case "app_start": bounds = (2000, 5000)
        case "screen_load": bounds = (1000, 2500)
        default: return ""
        }
        if ms <= bounds.0 { return "good" }
        if ms <= bounds.1 { return "needs-improvement" }
        return "poor"
    }
}
