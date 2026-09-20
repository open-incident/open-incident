/**
 * The alias-shadowing guard, and the false positive it had.
 *
 * ClickHouse resolves an output alias before the source column, so
 * `toString(minute) AS minute` silently changes what every later mention of
 * `minute` means. The guard exists because that trap cost this codebase seven
 * queries.
 *
 * It then cost one more, in the other direction: it refused a query that
 * qualifies every later use as `m.minute` — which is correct, and is exactly
 * how the queries that legitimately reuse a name are written. That broke the
 * metric chart, and nothing noticed because nothing else opens that screen.
 */
import { describe, expect, it } from "vitest";
import { read } from "../src/query";

/** The guard runs before any connection, so a rejection throws synchronously. */
async function refusal(sql: string): Promise<string | null> {
  try {
    await read("00000000-0000-0000-0000-000000000000", sql);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes("shadows the column") ? message : null;
  }
}

describe("an alias that shadows its own column", () => {
  it("is refused when the column is used bare afterwards", async () => {
    expect(
      await refusal(
        `SELECT toString(minute) AS minute FROM otel_logs_t(tenant = {tenant:UUID}) WHERE minute > now()`,
      ),
    ).toContain("shadows the column");
  });

  /** The false positive. Qualified, the column still resolves to the column. */
  it("is allowed when every later use is qualified", async () => {
    expect(
      await refusal(
        `SELECT toString(m.minute) AS minute FROM metric_1m_t(tenant = {tenant:UUID}) AS m
          WHERE m.minute >= now() - INTERVAL 1 HOUR ORDER BY m.minute`,
      ),
    ).toBeNull();
  });

  it("is allowed when the alias differs from the column", async () => {
    expect(
      await refusal(
        `SELECT toString(minute) AS slot FROM metric_1m_t(tenant = {tenant:UUID}) WHERE minute > now()`,
      ),
    ).toBeNull();
  });

  it("does not confuse a name with a longer one that contains it", async () => {
    expect(
      await refusal(
        `SELECT count(minute) AS minute FROM metric_1m_t(tenant = {tenant:UUID}) WHERE last_minute > now()`,
      ),
    ).toBeNull();
  });
});
