/**
 * Evaluating service level objectives, and paging on a budget that is burning.
 *
 * The alert says how fast, not how much. "99.87 % against an objective of
 * 99.9" is a number somebody has to think about at three in the morning;
 * "spending the month's budget in two days" is an instruction.
 *
 * Both burn rates are confirmed on a shorter window before they fire. A long
 * window alone keeps alerting for hours after the problem stopped, because the
 * failures are still inside it — the short window is what lets the alert
 * resolve when the outage does rather than when the window rolls past it.
 */
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { getTenantById, services, slos, withTenant, type SloBurnState } from "@openincident/db";
import {
  FAST_BURN,
  FAST_WINDOWS,
  SLOW_BURN,
  SLOW_WINDOWS,
  SloError,
  burnVerdict,
  confirmBurn,
  hoursLeft,
  readSlo,
  telemetryInstalled,
  type SloDefinition,
  type SloReading,
} from "@openincident/telemetry";
import { ensureMonitorSource, postAlert } from "./monitors";
import { tenantOrigin } from "./notify";

/** How often an SLO is re-read. A minute would re-scan a month of points for nothing. */
export const EVALUATE_EVERY_SECONDS = 300;

export type SloSweepResult = { evaluated: number; published: number; failed: number };

export async function sweepSlos(tenantIds: string[], now = new Date()): Promise<SloSweepResult> {
  const out: SloSweepResult = { evaluated: 0, published: 0, failed: 0 };
  if (!telemetryInstalled()) return out;

  for (const tenantId of tenantIds) {
    const due = await withTenant(tenantId, (tx) =>
      tx
        .select({
          id: slos.id,
          name: slos.name,
          goodQuery: slos.goodQuery,
          totalQuery: slos.totalQuery,
          objective: slos.objective,
          windowKind: slos.windowKind,
          windowDays: slos.windowDays,
          burnAlerts: slos.burnAlerts,
          burnState: slos.burnState,
          serviceKey: services.key,
        })
        .from(slos)
        .leftJoin(services, eq(services.id, slos.serviceId))
        .where(
          and(
            eq(slos.tenantId, tenantId),
            eq(slos.paused, false),
            or(
              isNull(slos.lastEvaluatedAt),
              lte(
                slos.lastEvaluatedAt,
                sql`${now.toISOString()}::timestamptz - make_interval(secs => ${EVALUATE_EVERY_SECONDS})`,
              ),
            ),
          ),
        ),
    );

    for (const slo of due) {
      out.evaluated++;
      try {
        out.published += await evaluateOne(tenantId, slo, now);
      } catch (err) {
        out.failed++;
        const why = err instanceof Error ? err.message : String(err);
        console.error(`[slos] ${slo.name}: ${why}`);
        await withTenant(tenantId, (tx) =>
          tx
            .update(slos)
            .set({
              lastEvaluatedAt: now,
              // Written down rather than only logged: an SLO that has silently
              // stopped evaluating is worse than no SLO, because somebody is
              // counting on it.
              lastDetail: `${err instanceof SloError ? "" : "query failed: "}${why}`.slice(0, 500),
              updatedAt: now,
            })
            .where(eq(slos.id, slo.id)),
        );
      }
    }
  }
  return out;
}

type Row = {
  id: string;
  name: string;
  goodQuery: string;
  totalQuery: string;
  objective: number;
  windowKind: "rolling" | "calendar";
  windowDays: number;
  burnAlerts: boolean;
  burnState: SloBurnState;
  serviceKey: string | null;
};

async function evaluateOne(tenantId: string, slo: Row, now: Date): Promise<number> {
  const definition: SloDefinition = {
    goodQuery: slo.goodQuery,
    totalQuery: slo.totalQuery,
    objective: slo.objective,
    windowKind: slo.windowKind,
    windowDays: slo.windowDays,
  };
  const reading = await readSlo(tenantId, definition, now);
  let verdict = burnVerdict(reading);

  /*
   * The long window said yes; the short one has to agree.
   *
   * Without it the alert outlives the outage by as long as the window: an hour
   * of failures keeps a one-hour burn rate high for a full hour after the last
   * failure, and somebody stays paged for a service that came back.
   */
  if (verdict === "fast") {
    const short = await confirmBurn(tenantId, definition, FAST_WINDOWS.short, now);
    if (short < FAST_BURN) verdict = burnVerdict({ ...reading, fastBurn: 0 });
  }
  if (verdict === "slow") {
    const short = await confirmBurn(tenantId, definition, SLOW_WINDOWS.short, now);
    if (short < SLOW_BURN) verdict = "ok";
  }

  const changed = verdict !== slo.burnState;
  const detail = sentence(reading, slo, verdict);
  let published = 0;

  if (changed && slo.burnAlerts) {
    // Posted before the state moves, for the reason the telemetry monitors
    // post first: a state written down and an alert that never left is a page
    // that never happens and never retries.
    published = (await announce(tenantId, slo, reading, verdict, detail)) ? 1 : 0;
  }

  await withTenant(tenantId, (tx) =>
    tx
      .update(slos)
      .set({
        lastEvaluatedAt: now,
        lastSli: reading.empty ? null : reading.sli,
        lastBudgetLeft: reading.empty ? null : reading.budgetLeft,
        lastFastBurn: reading.fastBurn,
        lastSlowBurn: reading.slowBurn,
        lastDetail: detail.slice(0, 500),
        // The state only moves when the alert went out, or when no alert was
        // wanted in the first place.
        ...(changed && (published > 0 || !slo.burnAlerts)
          ? { burnState: verdict, burnSince: now }
          : {}),
        updatedAt: now,
      })
      .where(eq(slos.id, slo.id)),
  );
  return published;
}

/** What the screen and the alert both say about a reading. */
export function sentence(reading: SloReading, slo: Row, verdict: SloBurnState): string {
  if (reading.empty) {
    return "no events in the window — the indicator has nothing to measure, which is not the same as perfect";
  }
  const burn = verdict === "fast" ? reading.fastBurn : reading.slowBurn;
  const hours = hoursLeft(reading.budgetLeft, burn, slo.windowDays);
  /*
   * "−1465 % of the budget left" is not a sentence. Past zero the budget is
   * not a remainder any more, it is an overrun, and saying it that way is the
   * difference between a figure somebody reads and a figure somebody parses.
   */
  const budget =
    reading.budgetLeft >= 0
      ? `${Math.round(reading.budgetLeft * 1000) / 10} % of the budget left`
      : `the budget is spent ${Math.round(-reading.budgetLeft * 10) / 10 + 1}× over`;
  const pace =
    verdict === "ok" || hours === null
      ? ""
      : ` — at this pace the rest is gone in ${formatHours(hours)}`;
  return `${round(reading.sli)} % against an objective of ${slo.objective} %, ${budget}${pace}`;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

async function announce(
  tenantId: string,
  slo: Row,
  reading: SloReading,
  verdict: SloBurnState,
  detail: string,
): Promise<boolean> {
  const tenant = await getTenantById(tenantId);
  const origin = tenant ? tenantOrigin(tenant.slug, tenant.customDomain) : null;
  if (!origin) return false;
  const source = await withTenant(tenantId, (tx) => ensureMonitorSource(tx, tenantId));

  const firing = verdict !== "ok";
  return postAlert(origin, source, {
    title: firing
      ? `${slo.name} is burning its error budget ${verdict === "fast" ? "fast" : "steadily"}`
      : `${slo.name} has stopped burning its error budget`,
    status: firing ? "firing" : "resolved",
    // One key whatever the speed: a burn that goes from slow to fast is the
    // same problem getting worse, not a second one.
    dedup_key: `slo:${slo.id}`,
    // A fast burn is an outage in progress; a slow one is worth today, not
    // tonight. Same alert road, different urgency.
    severity: verdict === "fast" ? "P1" : "P3",
    description: detail,
    attributes: {
      ...(slo.serviceKey ? { service: slo.serviceKey } : {}),
      slo: slo.name,
      slo_id: slo.id,
      objective: String(slo.objective),
      burn_rate: String(
        Math.round((verdict === "fast" ? reading.fastBurn : reading.slowBurn) * 10) / 10,
      ),
      budget_left: String(Math.round(reading.budgetLeft * 1000) / 10),
    },
    url: `${origin}/app/slos/${slo.id}`,
  });
}

function round(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
