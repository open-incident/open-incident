import Foundation

/// The session, and the one decision taken about it.
///
/// A mobile session is not a browser tab: the application is suspended and
/// resumed rather than closed, so "the same session" has to be defined in
/// time. Fifteen minutes of background is the convention every mobile RUM tool
/// settled on, and it is here for the same reason they did — a user who checks
/// a message and comes back is in the same visit; one who returns the next
/// morning is not.
///
/// The sampling draw is stored beside it, so a session that is being reported
/// keeps being reported across suspensions. Drawing per launch would report the
/// first half of a visit and not the second, which reads as a user who left.
struct Session {
    static let timeout: TimeInterval = 15 * 60

    let id: String
    let sampled: Bool

    private static let idKey = "oi.rum.session.id"
    private static let seenKey = "oi.rum.session.seen"
    private static let sampledKey = "oi.rum.session.sampled"

    /// Resumes the stored session, or starts one. `now` and `store` are
    /// injected so the expiry can be tested without waiting a quarter of an
    /// hour.
    static func resume(
        sampleRate: Double,
        now: Date = Date(),
        store: UserDefaults = .standard,
        draw: () -> Double = { Double.random(in: 0..<1) }
    ) -> Session {
        let seen = store.object(forKey: seenKey) as? Double
        let held = store.string(forKey: idKey)
        if let held, let seen, now.timeIntervalSince1970 - seen < timeout {
            store.set(now.timeIntervalSince1970, forKey: seenKey)
            return Session(id: held, sampled: store.bool(forKey: sampledKey))
        }
        let fresh = Session(id: newId(), sampled: draw() < sampleRate)
        store.set(fresh.id, forKey: idKey)
        store.set(fresh.sampled, forKey: sampledKey)
        store.set(now.timeIntervalSince1970, forKey: seenKey)
        return fresh
    }

    static func touch(now: Date = Date(), store: UserDefaults = .standard) {
        store.set(now.timeIntervalSince1970, forKey: seenKey)
    }

    /// Twenty-four hex characters, like the browser SDK's, so one product does
    /// not have two shapes of session id in one table.
    static func newId() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(24).description
    }
}
