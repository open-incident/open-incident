/**
 * A bug that appears, comes back, or suddenly gets much louder.
 *
 * This is the one thing everybody says they want from an exception tracker —
 * "tell me when something new breaks" — and it is deliberately not a monitor
 * somebody has to write. A monitor watches a query you thought of; this
 * watches the groups themselves, including the one nobody could have thought
 * of because it did not exist yesterday.
 *
 * Three things count as a regression (§15.8), and they are three different
 * sentences to the person woken up:
 *
 *  - **new** — a fingerprint this workspace has never seen;
 *  - **reopened** — one somebody resolved, firing again;
 *  - **surge** — one that has been around, now firing far more than usual.
 *
 * A group that is ignored, or snoozed and still within its snooze, raises
 * nothing at all. That is the whole point of those two states: a workspace with
 * a noisy dependency must be able to make it quiet without turning the feature
 * off for everything else.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  exceptionGroups,
  getTenantById,
  telemetrySettings,
  withTenant,
  type ExceptionRegression,
} from "@openincident/db";
import {
  groupRates,
  telemetryInstalled,
  tenantsWithData,
  type GroupRate,
} from "@openincident/telemetry";
import { ensureMonitorSource, postAlert } from "./monitors";
import { tenantOrigin } from "./notify";

/**
 * How many times its usual hour a group must fire to count as a surge.
 *
 * Five, from the specification. The multiple alone is not enough though: a
 * group that fires once an hour reaching five is not news, it is Tuesday. So
 * a floor applies as well.
 */
export const SURGE_MULTIPLE = 5;

/**
 * Below this many occurrences in the hour, a multiple means nothing.
 *
 * Ten rather than two, because the multiple is computed against a median that
 * is frequently zero or one for a rare bug, and every such group would
 * otherwise surge the first time it fired twice.
 */
export const SURGE_FLOOR = 10;

/**
 * How long the same group waits before it can page again.
 *
 * A surge that lasts four hours is one problem, not four pages. The group's
 * own alert stays open in the pipeline throughout; this is only about not
 * raising a second one behind it.
 */
export const REPEAT_AFTER_HOURS = 6;

/**
 * How far back the gate looks, and it has to be the **widest** window the
 * sweep reads rather than the one it acts on.
 *
 * `groupRates` compares the last hour against a seven-day baseline. Gating on
 * the last hour alone would skip a workspace whose baseline is the only thing
 * that changed — and a baseline that silently stops being computed is how a
 * regression detector starts calling everything normal.
 */
const GATE_WINDOW_MINUTES = 7 * 24 * 60 + 60;

export type RegressionSweepResult = {
  checked: number;
  raised: number;
  failed: number;
  /** Workspaces with no exceptions in the window, which cost nothing. */
  skipped: number;
};

export async function sweepExceptionRegressions(
  tenantIds: string[],
  now = new Date(),
): Promise<RegressionSweepResult> {
  const out: RegressionSweepResult = { checked: 0, raised: 0, failed: 0, skipped: 0 };
  if (!telemetryInstalled()) return out;

  /*
   * Who has any exception at all, asked once for everybody.
   *
   * Same gate as the service map, and the same reason: this sweep used to open
   * a Postgres transaction and run a ClickHouse query per workspace per
   * minute, whether or not that workspace had ever recorded an exception.
   */
  const window = new Date(now.getTime() - GATE_WINDOW_MINUTES * 60_000);
  let active: Set<string>;
  try {
    active = await tenantsWithData("exceptions", window);
  } catch (err) {
    // The gate failing must not stop the sweep: fall back to all of them,
    // which is the old behaviour and merely slow.
    console.error(
      "[exception-regressions] gate failed, sweeping all:",
      err instanceof Error ? err.message : err,
    );
    active = new Set(tenantIds);
  }
  const working = tenantIds.filter((id) => active.has(id));
  out.skipped = tenantIds.length - working.length;

  for (const tenantId of working) {
    try {
      out.raised += await sweepOne(tenantId, now, out);
    } catch (err) {
      out.failed++;
      console.error(
        `[exception-regressions] ${tenantId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return out;
}

async function sweepOne(tenantId: string, now: Date, out: RegressionSweepResult): Promise<number> {
  const settings = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        on: telemetrySettings.exceptionRegressions,
        severity: telemetrySettings.exceptionRegressionSeverity,
      })
      .from(telemetrySettings)
      .where(eq(telemetrySettings.tenantId, tenantId));
    // No row means no telemetry settings were ever written, and the column's
    // default is on — so a workspace that has not visited the screen gets the
    // behaviour the screen would have shown it.
    return row ?? { on: true, severity: "P3" as const };
  });
  if (!settings.on) return 0;

  const rates = await groupRates(tenantId, now);
  if (rates.length === 0) return 0;
  out.checked += rates.length;

  const known = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(exceptionGroups)
      .where(
        and(
          eq(exceptionGroups.tenantId, tenantId),
          inArray(
            exceptionGroups.fingerprint,
            rates.map((r) => r.fingerprint),
          ),
        ),
      ),
  );
  const byFingerprint = new Map(known.map((g) => [g.fingerprint, g]));

  let raised = 0;
  for (const rate of rates) {
    const held = byFingerprint.get(rate.fingerprint);
    const kind = regressionOf(rate, held, now);

    if (!held) {
      // Recorded whether or not it pages: the row is what makes the *next*
      // occurrence "already known" rather than new all over again.
      await withTenant(tenantId, (tx) =>
        tx.insert(exceptionGroups).values({
          tenantId,
          fingerprint: rate.fingerprint,
          status: "open",
          firstSeenAt: now,
          ...(kind ? { lastAlertedAt: now, lastAlertKind: kind } : {}),
        }),
      );
    }
    if (!kind) continue;

    const published = await announce(tenantId, rate, kind, settings.severity);
    if (!published) continue;
    raised++;

    if (held) {
      await withTenant(tenantId, (tx) =>
        tx
          .update(exceptionGroups)
          .set({
            // A reopened group is open again: leaving it "resolved" while it
            // fires would make the screen disagree with the alert.
            status: "open",
            resolvedAt: null,
            lastAlertedAt: now,
            lastAlertKind: kind,
            updatedAt: now,
          })
          .where(eq(exceptionGroups.id, held.id)),
      );
    }
  }
  return raised;
}

type Held = {
  status: string;
  snoozedUntil: Date | null;
  resolvedAt: Date | null;
  lastAlertedAt: Date | null;
};

/** Which of the three this is, or null when it is not news. */
export function regressionOf(
  rate: GroupRate,
  held: Held | undefined,
  now: Date,
): ExceptionRegression | null {
  if (held?.status === "ignored") return null;
  if (held?.status === "snoozed" && held.snoozedUntil && held.snoozedUntil > now) return null;
  // The same group does not page twice in a row: a surge lasting four hours is
  // one problem, and the alert it already raised is still open.
  if (
    held?.lastAlertedAt &&
    now.getTime() - held.lastAlertedAt.getTime() < REPEAT_AFTER_HOURS * 3_600_000
  ) {
    return null;
  }
  if (rate.lastHour === 0) return null;

  if (!held) return "new";
  if (held.status === "resolved") return "reopened";
  if (
    rate.lastHour >= SURGE_FLOOR &&
    rate.usualHour > 0 &&
    rate.lastHour >= rate.usualHour * SURGE_MULTIPLE
  ) {
    return "surge";
  }
  return null;
}

const SENTENCE: Record<ExceptionRegression, string> = {
  new: "is new",
  reopened: "is back after being resolved",
  surge: "is firing far more than usual",
};

async function announce(
  tenantId: string,
  rate: GroupRate,
  kind: ExceptionRegression,
  severity: string,
): Promise<boolean> {
  const tenant = await getTenantById(tenantId);
  const origin = tenant ? tenantOrigin(tenant.slug, tenant.customDomain) : null;
  if (!origin) return false;
  const source = await withTenant(tenantId, (tx) => ensureMonitorSource(tx, tenantId));

  const detail =
    kind === "surge"
      ? `${rate.lastHour} occurrences in the last hour, against a usual ${rate.usualHour}.`
      : kind === "reopened"
        ? `${rate.lastHour} occurrences in the last hour; it was marked resolved.`
        : `${rate.lastHour} occurrences in the last hour, first seen ${rate.firstSeen}.`;

  return postAlert(origin, source, {
    title: `${rate.type}: ${rate.message.slice(0, 120)} — ${SENTENCE[kind]}`,
    status: "firing",
    // Keyed on the fingerprint and not on the kind: a group that is new and
    // then surges is one bug, and two alerts about it would be two incidents.
    dedup_key: `exception:${rate.fingerprint}`,
    severity,
    description: detail,
    attributes: {
      exception_type: rate.type,
      fingerprint: rate.fingerprint,
      regression: kind,
      occurrences_last_hour: String(rate.lastHour),
      usual_per_hour: String(rate.usualHour),
    },
    url: `${origin}/app/telemetry?tab=exceptions&fp=${rate.fingerprint}`,
  });
}
