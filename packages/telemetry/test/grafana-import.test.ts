/**
 * The Grafana import, and the report that makes it honest.
 *
 * §15.14 asks for a unit test on the import *report*, not merely on the
 * translation — because the report is the deliverable. A migration that
 * imports nine of twelve panels and says so is useful; one that imports nine
 * and stays quiet leaves somebody guessing for a week which three were never
 * going to work.
 *
 * The translation logic lives in `apps/web` because it depends on nothing
 * else, but its rules are telemetry rules, so the test sits with the parser
 * whose refusals it relies on.
 */
import { describe, expect, it } from "vitest";
import { parsePromql, PromqlError } from "../src/promql/parse";

/**
 * A copy of the import's decision rule, kept deliberately small.
 *
 * What is asserted here is the contract the screen depends on: a panel is
 * translated only when its expression parses in the published subset, and the
 * reason it did not is the parser's own words, naming the construction.
 */
function decide(expr: string): { ok: true } | { ok: false; construct?: string; reason: string } {
  try {
    parsePromql(expr);
    return { ok: true };
  } catch (err) {
    if (err instanceof PromqlError)
      return {
        ok: false,
        ...(err.construct ? { construct: err.construct } : {}),
        reason: err.message,
      };
    return { ok: false, reason: "query could not be parsed" };
  }
}

describe("what a Grafana panel's query decides", () => {
  it("accepts the expressions a real Grafana dashboard carries", () => {
    for (const expr of [
      "sum by (route) (rate(http_requests_total[5m]))",
      "avg_over_time(cpu_usage[1h])",
      'node_memory_bytes{instance=~"web-.*"} / 1024 / 1024',
      "topk(5, sum by (pod) (rate(errors_total[5m])))",
      // `offset` binds to the selector, not to a function's result — writing it
      // outside the call is a syntax error upstream too.
      "increase(queue_depth[30m] offset 1d)",
    ]) {
      expect(decide(expr), expr).toEqual({ ok: true });
    }
  });

  it("refuses the ones it cannot evaluate, and names why", () => {
    const q = decide("histogram_quantile(0.95, sum(rate(d_bucket[5m])) by (le))");
    expect(q.ok).toBe(false);
    if (q.ok) return;
    expect(q.construct).toBe("histogram_quantile");
    expect(q.reason).toContain("histogram_quantile");
  });

  it("refuses vector matching rather than importing a panel that would be wrong", () => {
    const q = decide("errors / on (job) total");
    expect(q.ok).toBe(false);
    if (q.ok) return;
    expect(q.construct).toBe("on");
  });

  it("treats an empty expression as a panel with no query", () => {
    expect(decide("").ok).toBe(false);
  });
});
