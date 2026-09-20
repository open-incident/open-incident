/**
 * The parts of a telemetry monitor that decide, tested without a column store.
 *
 * Two things are worth pinning down here. The filter compiler, because it puts
 * a person's text next to SQL and the only thing keeping that safe is that
 * column names come from a list and values are bound — so the tests check both
 * the refusals and the binding. And the verdict, because the anomaly rule is
 * the one piece of arithmetic in the product that decides whether somebody's
 * phone rings.
 */
import { describe, expect, it } from "vitest";
import {
  ANOMALY_Z,
  LEARNING_DAYS,
  TelemetryMonitorError,
  baselineOf,
  compileFilter,
  robustZ,
  seriesKeyOf,
  verdictFor,
  type Baseline,
} from "../src/monitor";

describe("a filter becomes a bound WHERE clause", () => {
  it("binds the value rather than writing it into the SQL", () => {
    const { sql, params } = compileFilter("logs", "service_name = 'checkout'");
    expect(sql).toBe("service_name = {f0:String}");
    expect(params).toEqual({ f0: "checkout" });
  });

  it("reads a number as a number", () => {
    const { sql, params } = compileFilter("logs", "severity_number >= 17");
    expect(sql).toBe("severity_number >= {f0:Float64}");
    expect(params.f0).toBe(17);
  });

  it("joins terms with AND and numbers each parameter apart", () => {
    const { sql, params } = compileFilter(
      "traces",
      "service_name = 'api' AND duration_ms > 250 AND status_code = 'error'",
    );
    expect(sql).toBe(
      "service_name = {f0:String} AND (duration_ns / 1000000) > {f1:Float64} AND status_code = {f2:String}",
    );
    expect(params).toEqual({ f0: "api", f1: 250, f2: "error" });
  });

  it("reaches an attribute with its key bound too", () => {
    const { sql, params } = compileFilter("logs", "attr:tenant.plan = 'free'");
    expect(sql).toBe("attributes[{attr_0:String}] = {f1:String}");
    expect(params).toEqual({ attr_0: "tenant.plan", f1: "free" });
  });

  it("matches and contains are their own operators", () => {
    expect(compileFilter("logs", "body contains 'timeout'").sql).toBe(
      "positionCaseInsensitive(body, {f0:String}) > 0",
    );
    expect(compileFilter("exceptions", "type =~ '.*Timeout'").sql).toBe(
      "match(type, {f0:String})",
    );
  });

  it("an empty filter is every row, not a syntax error", () => {
    expect(compileFilter("logs", "   ").sql).toBe("1 = 1");
  });

  it("refuses a field that is not one", () => {
    expect(() => compileFilter("logs", "tenant_id = 'x'")).toThrow(TelemetryMonitorError);
  });

  it("refuses an injection instead of quoting it", () => {
    // The apostrophe and everything after it is a value, not SQL: it is bound.
    const { sql, params } = compileFilter("logs", "service_name = \"a' OR 1=1 --\"");
    expect(sql).toBe("service_name = {f0:String}");
    expect(params.f0).toBe("a' OR 1=1 --");
    expect(() => compileFilter("logs", "1=1 OR service_name = 'x'")).toThrow(
      TelemetryMonitorError,
    );
  });

  it("refuses an ordering on text and a word where a number goes", () => {
    expect(() => compileFilter("logs", "service_name > 'a'")).toThrow(/does not apply/);
    expect(() => compileFilter("logs", "severity_number = 'high'")).toThrow(/not one/);
  });
});

describe("a series key", () => {
  it("is the same whatever order the labels came in", () => {
    expect(seriesKeyOf({ route: "/pay", env: "prod" })).toBe(
      seriesKeyOf({ env: "prod", route: "/pay" }),
    );
  });

  it("has a spelling for the monitor that groups by nothing", () => {
    expect(seriesKeyOf({})).toBe("*");
  });
});

describe("the verdict", () => {
  const threshold = { kind: "threshold", op: ">", value: 5 } as const;

  it("fires above the threshold and not on it", () => {
    expect(verdictFor(6, threshold).verdict).toBe("breaching");
    expect(verdictFor(5, threshold).verdict).toBe("ok");
  });

  const settled: Baseline = { median: 100, mad: 5, samples: 48, days: 30 };

  it("calls a value far from the usual one an anomaly", () => {
    expect(verdictFor(200, { kind: "anomaly", direction: "high" }, settled).verdict).toBe(
      "breaching",
    );
    expect(verdictFor(102, { kind: "anomaly", direction: "high" }, settled).verdict).toBe("ok");
  });

  it("knows which way it was asked to look", () => {
    expect(verdictFor(10, { kind: "anomaly", direction: "high" }, settled).verdict).toBe("ok");
    expect(verdictFor(10, { kind: "anomaly", direction: "low" }, settled).verdict).toBe(
      "breaching",
    );
    expect(verdictFor(10, { kind: "anomaly", direction: "any" }, settled).verdict).toBe(
      "breaching",
    );
  });

  it("says learning rather than firing while the history is short", () => {
    const young: Baseline = { median: 100, mad: 5, samples: 20, days: LEARNING_DAYS - 1 };
    const v = verdictFor(9_000, { kind: "anomaly", direction: "any" }, young);
    expect(v.verdict).toBe("learning");
    expect(v.why).toContain(`of ${LEARNING_DAYS} days`);
  });

  it("says learning rather than firing when there is no history at all", () => {
    expect(verdictFor(9_000, { kind: "anomaly", direction: "any" }).verdict).toBe("learning");
  });

  it("does not call every move an anomaly on a series that never moves", () => {
    const flat: Baseline = { median: 0, mad: 0, samples: 48, days: 30 };
    expect(verdictFor(0, { kind: "anomaly", direction: "any" }, flat).verdict).toBe("ok");
    expect(verdictFor(1, { kind: "anomaly", direction: "high" }, flat).verdict).toBe("breaching");
  });

  it("is not dragged off by an outage inside the history", () => {
    // Forty-eight samples of ordinary traffic and four from an outage. A mean
    // would land near 470 and a standard deviation near 1200, which would put
    // the next 5000 well inside three sigma — invisible. The median holds at
    // the ordinary value, so it stays an anomaly.
    const noisy = Array.from({ length: 48 }, (_, i) => 100 + (i % 7));
    const withOutage = baselineOf([...noisy, 5_000, 5_000, 5_000, 5_000], 30);
    expect(withOutage.median).toBeLessThan(110);
    expect(robustZ(5_000, withOutage)).toBeGreaterThan(ANOMALY_Z);
    expect(verdictFor(103, { kind: "anomaly", direction: "any" }, withOutage).verdict).toBe("ok");
  });
});
