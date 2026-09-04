/**
 * On-call pay, the product side: the workspace's rules, a month computed into
 * a draft report, the draft published and frozen. Amounts come from the pure
 * computation in the on-call package; this file only reads rows and writes them.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import {
  members,
  payReports,
  payRules,
  rotations,
  scheduleOverrides,
  schedules,
  withTenant,
  workspaces,
  type PayReportRow,
  type Tx,
} from "@openincident/db";
import { computePay, monthBounds, type PayRulesLike } from "@openincident/oncall";

export const DEFAULT_PAY_RULES: PayRulesLike = {
  currency: "EUR",
  standbyCents: 0,
  nightCents: 0,
  weekendCents: 0,
  holidayCents: 0,
  nightStart: "22:00",
  nightEnd: "07:00",
  holidays: [],
};

export async function getPayRules(
  tx: Tx,
  tenantId: string,
): Promise<PayRulesLike & { configured: boolean }> {
  const [row] = await tx.select().from(payRules).where(eq(payRules.tenantId, tenantId));
  if (!row) return { ...DEFAULT_PAY_RULES, configured: false };
  return {
    currency: row.currency,
    standbyCents: row.standbyCents,
    nightCents: row.nightCents,
    weekendCents: row.weekendCents,
    holidayCents: row.holidayCents,
    nightStart: row.nightStart,
    nightEnd: row.nightEnd,
    holidays: row.holidays,
    configured: true,
  };
}

export async function savePayRules(tx: Tx, tenantId: string, rules: PayRulesLike): Promise<void> {
  const values = { ...rules, updatedAt: new Date() };
  const [existing] = await tx
    .select({ id: payRules.id })
    .from(payRules)
    .where(eq(payRules.tenantId, tenantId));
  if (existing) await tx.update(payRules).set(values).where(eq(payRules.id, existing.id));
  else await tx.insert(payRules).values({ tenantId, ...values });
}

/** "YYYY-MM" of the previous month, in a zone — the report people usually want. */
export function previousPeriod(now = new Date(), timeZone = "Europe/Paris"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const pm = m === 1 ? 12 : m - 1;
  return `${m === 1 ? y - 1 : y}-${String(pm).padStart(2, "0")}`;
}

/**
 * Recomputes the month into the draft — a published report is never touched.
 * Returns the report, or null when the month is already published.
 */
export async function generatePayDraft(
  tenantId: string,
  period: string,
): Promise<typeof payReports.$inferSelect | null> {
  return withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(payReports)
      .where(and(eq(payReports.tenantId, tenantId), eq(payReports.period, period)));
    if (existing?.status === "published") return null;
    const rules = await getPayRules(tx, tenantId);
    const [ws] = await tx
      .select({ timezone: workspaces.timezone })
      .from(workspaces)
      .where(eq(workspaces.tenantId, tenantId));
    const tz = ws?.timezone ?? "Europe/Paris";
    const { from, to } = monthBounds(period, tz);
    const scheds = await tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.tenantId, tenantId), eq(schedules.status, "published")))
      .orderBy(asc(schedules.name));
    const inputs = [];
    for (const s of scheds) {
      const rots = await tx
        .select()
        .from(rotations)
        .where(eq(rotations.scheduleId, s.id))
        .orderBy(asc(rotations.position));
      const ovs = await tx
        .select()
        .from(scheduleOverrides)
        .where(eq(scheduleOverrides.scheduleId, s.id));
      inputs.push({ id: s.id, schedule: s, rotations: rots, overrides: ovs });
    }
    const lines = computePay(rules, inputs, from, to);
    const people = await tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(eq(members.tenantId, tenantId));
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const schedName = new Map(scheds.map((s) => [s.id, s.name]));
    const rows: PayReportRow[] = lines.map((l) => ({
      memberId: l.memberId,
      memberName: nameOf.get(l.memberId) ?? "—",
      scheduleId: l.scheduleId,
      scheduleName: schedName.get(l.scheduleId) ?? "—",
      minutes: l.minutes,
      amountCents: l.amountCents,
    }));
    rows.sort(
      (a, b) =>
        a.memberName.localeCompare(b.memberName) || a.scheduleName.localeCompare(b.scheduleName),
    );
    const totalCents = rows.reduce((n, r) => n + r.amountCents, 0);
    const { configured: _c, ...snapshot } = rules;
    void _c;
    const values = {
      currency: rules.currency,
      rows,
      totalCents,
      rulesSnapshot: snapshot as Record<string, unknown>,
      generatedAt: new Date(),
    };
    if (existing) {
      const [updated] = await tx
        .update(payReports)
        .set(values)
        .where(eq(payReports.id, existing.id))
        .returning();
      return updated ?? null;
    }
    const [created] = await tx
      .insert(payReports)
      .values({ tenantId, period, status: "draft", ...values })
      .returning();
    return created ?? null;
  });
}

export async function publishPayReport(
  tenantId: string,
  period: string,
  memberId: string,
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const updated = await tx
      .update(payReports)
      .set({ status: "published", publishedAt: new Date(), publishedByMemberId: memberId })
      .where(
        and(
          eq(payReports.tenantId, tenantId),
          eq(payReports.period, period),
          eq(payReports.status, "draft"),
        ),
      )
      .returning({ id: payReports.id });
    return updated.length > 0;
  });
}

export async function listPayReports(tx: Tx, tenantId: string) {
  return tx
    .select()
    .from(payReports)
    .where(eq(payReports.tenantId, tenantId))
    .orderBy(desc(payReports.period));
}

export async function getPayReport(tx: Tx, tenantId: string, period: string) {
  const [row] = await tx
    .select()
    .from(payReports)
    .where(and(eq(payReports.tenantId, tenantId), eq(payReports.period, period)));
  return row ?? null;
}
