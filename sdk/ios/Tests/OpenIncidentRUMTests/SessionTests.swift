import XCTest
@testable import OpenIncidentRUM

/// The session, which is the only part of this SDK with a decision in it.
///
/// A phone suspends and resumes rather than closing, so "the same session" is
/// defined in time — and the two things that must hold are that a short
/// absence resumes and a long one does not, and that the sampling draw
/// survives both.
final class SessionTests: XCTestCase {
    private var store: UserDefaults!

    override func setUp() {
        super.setUp()
        store = UserDefaults(suiteName: "oi.rum.tests.\(UUID().uuidString)")
    }

    func testStartsFresh() {
        let s = Session.resume(sampleRate: 1, store: store)
        XCTAssertFalse(s.id.isEmpty)
        XCTAssertTrue(s.sampled)
    }

    func testResumesAfterAShortAbsence() {
        let now = Date()
        let first = Session.resume(sampleRate: 1, now: now, store: store)
        let later = Session.resume(sampleRate: 1, now: now.addingTimeInterval(14 * 60), store: store)
        XCTAssertEqual(first.id, later.id)
    }

    func testStartsAgainAfterTheTimeout() {
        let now = Date()
        let first = Session.resume(sampleRate: 1, now: now, store: store)
        let after = Session.resume(sampleRate: 1, now: now.addingTimeInterval(16 * 60), store: store)
        XCTAssertNotEqual(first.id, after.id)
    }

    /// The window moves with use. A user tapping every ten minutes for an hour
    /// is in one session, not four — the timeout is fifteen minutes of
    /// *silence*, not a fifteen-minute cap on a visit.
    func testUseExtendsTheWindow() {
        let now = Date()
        let first = Session.resume(sampleRate: 1, now: now, store: store)
        Session.touch(now: now.addingTimeInterval(10 * 60), store: store)
        let later = Session.resume(sampleRate: 1, now: now.addingTimeInterval(20 * 60), store: store)
        XCTAssertEqual(first.id, later.id)
    }

    /// The draw is taken once. Taking it per launch would report the first half
    /// of a visit and not the second, which reads as a user who left.
    func testTheDrawSurvivesAResume() {
        let now = Date()
        var draws = 0
        let first = Session.resume(sampleRate: 0.5, now: now, store: store, draw: {
            draws += 1
            return 0.9 // above the rate: not sampled
        })
        XCTAssertFalse(first.sampled)
        let later = Session.resume(sampleRate: 0.5, now: now.addingTimeInterval(60), store: store, draw: {
            draws += 1
            return 0.1 // would be sampled, and must not be asked
        })
        XCTAssertFalse(later.sampled)
        XCTAssertEqual(first.id, later.id)
        XCTAssertEqual(draws, 1, "the draw must be taken once per session, not per launch")
    }

    func testSampleRateZeroReportsNothing() {
        XCTAssertFalse(Session.resume(sampleRate: 0, store: store, draw: { 0 }).sampled)
    }

    func testIdsLookLikeTheBrowserSdks() {
        let id = Session.newId()
        XCTAssertEqual(id.count, 24)
        XCTAssertTrue(id.allSatisfy { $0.isHexDigit }, "\(id) is not 24 hex characters")
    }
}

final class RatingTests: XCTestCase {
    func testAppStart() {
        XCTAssertEqual(Rating.of("app_start", 1200), "good")
        XCTAssertEqual(Rating.of("app_start", 2000), "good")
        XCTAssertEqual(Rating.of("app_start", 3000), "needs-improvement")
        XCTAssertEqual(Rating.of("app_start", 9000), "poor")
    }

    func testScreenLoad() {
        XCTAssertEqual(Rating.of("screen_load", 400), "good")
        XCTAssertEqual(Rating.of("screen_load", 1800), "needs-improvement")
        XCTAssertEqual(Rating.of("screen_load", 4000), "poor")
    }

    func testAnUnknownTimingIsNotRated() {
        XCTAssertEqual(Rating.of("LCP", 100), "")
    }
}

final class EventTests: XCTestCase {
    /// The wire shape is a protocol, so it is asserted rather than assumed.
    func testTheScreenGoesInRouteAndNotInUrl() {
        let e = Event(kind: .screenView, at: Date(timeIntervalSince1970: 1_789_920_000), screen: "Checkout")
        let p = e.payload(session: "s1", view: "v1", user: nil)
        XCTAssertEqual(p["type"] as? String, "page_view")
        XCTAssertEqual(p["route"] as? String, "Checkout")
        XCTAssertEqual(p["url"] as? String, "")
        XCTAssertEqual(p["ts"] as? Int, 1_789_920_000_000)
        XCTAssertNil(p["user"])
    }

    /// The duration is the only interesting thing about a network call, and it
    /// used to travel only alongside a vital name — so resources arrived saying
    /// a request happened and not how long it took.
    func testAResourceCarriesItsDuration() {
        let e = Event(kind: .resource, at: Date(), value: 143, message: "https://api/cart")
        let p = e.payload(session: "s1", view: "v1", user: nil)
        XCTAssertEqual(p["type"] as? String, "resource")
        XCTAssertEqual(p["value"] as? Double, 143)
        XCTAssertNil(p["vital"])
    }

    func testAVitalCarriesItsRating() {
        let e = Event(kind: .vital, at: Date(), vital: "app_start", value: 3000,
                      rating: Rating.of("app_start", 3000))
        let p = e.payload(session: "s1", view: "v1", user: "u-1")
        XCTAssertEqual(p["type"] as? String, "mobile_vital")
        XCTAssertEqual(p["vital"] as? String, "app_start")
        XCTAssertEqual(p["rating"] as? String, "needs-improvement")
        XCTAssertEqual(p["user"] as? String, "u-1")
    }
}
