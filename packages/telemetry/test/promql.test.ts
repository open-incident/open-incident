/**
 * The PromQL subset — parsed, and refused by name when it is outside.
 *
 * These run without ClickHouse on purpose: the parser is where a query becomes
 * either a plan or an honest error, and that decision must be testable on any
 * machine. The evaluation semantics that need data are exercised by the
 * isolation suite, which has a store.
 *
 * The refusals matter as much as the successes here. Decision D24 says an
 * unsupported construction raises an error naming it — so each of these
 * asserts the name is in the message, not merely that something threw.
 */
import { describe, expect, it } from "vitest";
import { parseDuration, parsePromql, PromqlError } from "../src/promql/parse";

function fails(query: string): PromqlError {
  try {
    parsePromql(query);
  } catch (err) {
    if (err instanceof PromqlError) return err;
    throw err;
  }
  throw new Error(`"${query}" was expected to be refused`);
}

describe("the published subset parses", () => {
  it("reads a selector with every matcher operator", () => {
    const n = parsePromql('http_requests{job="api",env!="dev",path=~"/v1/.*",code!~"2.."}');
    expect(n.kind).toBe("selector");
    if (n.kind !== "selector") return;
    expect(n.metric).toBe("http_requests");
    expect(n.matchers.map((m) => m.op)).toEqual(["=", "!=", "=~", "!~"]);
  });

  it("reads a range vector with an offset", () => {
    const n = parsePromql("rate(http_requests[5m] offset 1h)");
    expect(n.kind).toBe("call");
    if (n.kind !== "call") return;
    const arg = n.args[0]!;
    expect(arg.kind).toBe("selector");
    if (arg.kind !== "selector") return;
    expect(arg.range).toBe(300_000);
    expect(arg.offset).toBe(3_600_000);
  });

  it("reads an aggregation with grouping on either side", () => {
    for (const q of [
      "sum by (route) (rate(http_requests[5m]))",
      "sum(rate(http_requests[5m])) by (route)",
    ]) {
      const n = parsePromql(q);
      expect(n.kind).toBe("aggregation");
      if (n.kind !== "aggregation") return;
      expect(n.op).toBe("sum");
      expect(n.by).toEqual(["route"]);
    }
  });

  it("gives multiplication precedence over addition", () => {
    const n = parsePromql("a + b * 2");
    expect(n.kind).toBe("binary");
    if (n.kind !== "binary") return;
    expect(n.op).toBe("+");
    expect(n.right.kind).toBe("binary");
  });

  it("reads durations in every unit the language allows", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("1d")).toBe(86_400_000);
  });
});

describe("what is outside the subset is refused by name", () => {
  it("names a function that is planned but not written", () => {
    const err = fails("histogram_quantile(0.95, foo)");
    expect(err.construct).toBe("histogram_quantile");
    expect(err.message).toContain("histogram_quantile");
  });

  it("names an unknown function rather than treating it as a metric", () => {
    expect(fails("wobble(foo[5m])").construct).toBe("wobble");
  });

  it("names vector matching", () => {
    expect(fails("a / on (job) b").construct).toBe("on");
    expect(fails("a / ignoring (job) b").construct).toBe("ignoring");
  });

  it("names the @ modifier", () => {
    expect(fails("foo @ 1609746000").construct).toBe("@");
  });

  it("refuses a bare range vector, and says what to wrap it in", () => {
    const err = fails("http_requests[5m]");
    expect(err.message).toMatch(/rate\(\)|avg_over_time/);
  });

  it("refuses an unquoted matcher value", () => {
    expect(() => parsePromql("foo{job=bar}")).toThrow(/quoted/);
  });

  it("refuses an empty query rather than returning everything", () => {
    expect(() => parsePromql("   ")).toThrow(/empty/);
  });
});
