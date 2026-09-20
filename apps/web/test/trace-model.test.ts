/**
 * The arithmetic behind the waterfall.
 *
 * The drawing is easy to eyeball and the numbers are not: whether a span is on
 * the critical path, and how much time a service really spent, are both things
 * a reader will believe without checking. So they are checked here.
 */
import { describe, expect, it } from "vitest";
import {
  axisTicks,
  formatMs,
  timeByService,
  traceTree,
} from "../src/app/app/telemetry/trace-model";
import type { SpanRow } from "@/lib/telemetry";

const T0 = "2026-09-20 21:00:00.000";
const at = (offsetMs: number) =>
  new Date(Date.parse(T0) + offsetMs).toISOString().replace("T", " ").replace("Z", "");

const span = (over: Partial<SpanRow> & { span_id: string; durationMs: number }): SpanRow => ({
  parent_span_id: "",
  service_name: "svc",
  name: "op",
  kind: "internal",
  status_code: "ok",
  status_message: "",
  start_ts: at(0),
  http_status_code: 0,
  attributes: {},
  events: [],
  ...over,
  duration_ns: String(over.durationMs * 1e6),
});

/**
 *  root      0 → 4000   storefront
 *    a       100 → 3900 checkout        (the slow branch)
 *      c     200 → 3800 payments
 *    b       100 → 300  auth            (fast, off the path)
 */
const TRACE: SpanRow[] = [
  span({ span_id: "root", durationMs: 4000, service_name: "storefront", start_ts: at(0) }),
  span({
    span_id: "a",
    parent_span_id: "root",
    durationMs: 3800,
    service_name: "checkout",
    start_ts: at(100),
  }),
  span({
    span_id: "c",
    parent_span_id: "a",
    durationMs: 3600,
    service_name: "payments",
    start_ts: at(200),
  }),
  span({
    span_id: "b",
    parent_span_id: "root",
    durationMs: 200,
    service_name: "auth",
    start_ts: at(100),
  }),
];

describe("the tree", () => {
  it("puts a parent immediately before its children, not everything by start time", () => {
    // Sorted by start alone this would be root, a, b, c — and the reader could
    // not tell that c hangs off a.
    expect(traceTree(TRACE).map((n) => n.span.span_id)).toEqual(["root", "a", "c", "b"]);
  });

  it("indents by the tree, not by arrival", () => {
    const depth = Object.fromEntries(traceTree(TRACE).map((n) => [n.span.span_id, n.depth]));
    expect(depth).toEqual({ root: 0, a: 1, c: 2, b: 1 });
  });

  /** "We did not receive that one" is information, not a reason to hide a span. */
  it("draws an orphan at the root rather than dropping it", () => {
    const orphan = span({ span_id: "x", parent_span_id: "gone", durationMs: 5 });
    const ids = traceTree([...TRACE, orphan]).map((n) => n.span.span_id);
    expect(ids).toContain("x");
    expect(traceTree([...TRACE, orphan]).find((n) => n.span.span_id === "x")?.depth).toBe(0);
  });

  it("survives a span that claims to be its own parent", () => {
    const loop = span({ span_id: "l", parent_span_id: "l", durationMs: 5 });
    expect(() => traceTree([loop])).not.toThrow();
    expect(traceTree([loop])).toHaveLength(1);
  });
});

describe("the critical path", () => {
  it("follows what everything above is waiting on", () => {
    const critical = traceTree(TRACE)
      .filter((n) => n.critical)
      .map((n) => n.span.span_id);
    expect(critical).toEqual(["root", "a", "c"]);
  });

  it("leaves the fast sibling off it", () => {
    expect(traceTree(TRACE).find((n) => n.span.span_id === "b")?.critical).toBe(false);
  });

  /**
   * The child that *finishes* last, not the one that starts last. A span that
   * starts early and runs long is the one holding the request open.
   */
  it("picks the child that finishes last, not the one that starts last", () => {
    const spans: SpanRow[] = [
      span({ span_id: "r", durationMs: 1000 }),
      span({ span_id: "early-long", parent_span_id: "r", durationMs: 900, start_ts: at(10) }),
      span({ span_id: "late-short", parent_span_id: "r", durationMs: 50, start_ts: at(500) }),
    ];
    const critical = traceTree(spans)
      .filter((n) => n.critical)
      .map((n) => n.span.span_id);
    expect(critical).toEqual(["r", "early-long"]);
  });

  /**
   * The case that showed the naive walk was wrong, taken from a real trace.
   *
   * `emit` is a 22 ms span fired after everything else, so it finishes last —
   * and "follow the child that finishes last" marked it and stopped, leaving
   * the three-second database call the request was actually waiting on off the
   * path entirely. Walking backwards marks both: the tail, and then whatever
   * covered the time before it.
   */
  it("does not let a short trailing span hide the slow one", () => {
    const spans: SpanRow[] = [
      span({ span_id: "root", durationMs: 4120, service_name: "storefront" }),
      span({ span_id: "confirm", parent_span_id: "root", durationMs: 3980, start_ts: at(60) }),
      span({ span_id: "capture", parent_span_id: "confirm", durationMs: 3640, start_ts: at(350) }),
      span({ span_id: "pg", parent_span_id: "capture", durationMs: 3000, start_ts: at(350) }),
      span({ span_id: "emit", parent_span_id: "confirm", durationMs: 22, start_ts: at(4020) }),
    ];
    const critical = new Set(
      traceTree(spans)
        .filter((n) => n.critical)
        .map((n) => n.span.span_id),
    );
    expect([...critical].sort()).toEqual(["capture", "confirm", "emit", "pg", "root"].sort());
  });

  /** Time nothing covers is the parent's own, and stops the walk descending. */
  it("stops at a gap the parent filled itself", () => {
    const spans: SpanRow[] = [
      span({ span_id: "p", durationMs: 1000 }),
      // Finishes at 200, then the parent works alone until 1000.
      span({ span_id: "early", parent_span_id: "p", durationMs: 100, start_ts: at(100) }),
    ];
    const critical = traceTree(spans)
      .filter((n) => n.critical)
      .map((n) => n.span.span_id);
    expect(critical).toEqual(["p", "early"]);
  });
});

describe("self time", () => {
  it("excludes time spent waiting on children", () => {
    const byId = Object.fromEntries(traceTree(TRACE).map((n) => [n.span.span_id, n.selfMs]));
    expect(byId["root"]).toBe(4000 - 3800 - 200); // 0
    expect(byId["a"]).toBe(3800 - 3600); // 200
    expect(byId["c"]).toBe(3600);
  });

  /**
   * The number that sends somebody to the right service. On total time
   * storefront looks like the problem; on self time payments is.
   */
  it("attributes the trace to the service that actually spent it", () => {
    const rows = timeByService(traceTree(TRACE));
    expect(rows[0]).toMatchObject({ service: "payments", ms: 3600 });
    expect(rows.find((r) => r.service === "storefront")?.ms).toBe(0);
    expect(rows.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1, 6);
  });

  it("never goes negative when children overlap past their parent", () => {
    const spans: SpanRow[] = [
      span({ span_id: "p", durationMs: 100 }),
      span({ span_id: "k", parent_span_id: "p", durationMs: 250 }),
    ];
    expect(traceTree(spans).find((n) => n.span.span_id === "p")?.selfMs).toBe(0);
  });
});

describe("the axis", () => {
  it("lands on round numbers rather than fractions of the duration", () => {
    expect(axisTicks(4120)).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(axisTicks(85)).toEqual([0, 20, 40, 60, 80]);
  });

  it("copes with a trace of no measurable length", () => {
    expect(axisTicks(0)).toEqual([0]);
  });
});

describe("formatting", () => {
  it.each([
    [4120, "4.12 s"],
    [850, "850 ms"],
    [0.4, "400 µs"],
  ])("%s ms → %s", (value, text) => expect(formatMs(value)).toBe(text));
});
