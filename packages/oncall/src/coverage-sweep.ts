/**
 * Coverage reminders — once a day at most, the managers of a workspace are
 * told which published schedules have nobody at some expected hour in the
 * next seven days, with the gaps listed. Nothing is sent when nothing is open.
 */
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  getTenantById,
  members,
  rotations,
  scheduleOverrides,
  schedules,
  withTenant,
} from "@openincident/db";
import { sendTenantEmail } from "@openincident/mail";
import { COVERAGE_HORIZON_DAYS, coverageOf, upcomingGaps, type CoverageGap } from "./coverage";
import { tenantOrigin } from "./notify";

const REMINDER_DAYS = 7;
const MIN_GAP_BETWEEN_REMINDERS_MS = 20 * 3_600_000;

function fmt(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export async function sweepCoverageReminders(
  tenantIds: string[],
  now = new Date(),
): Promise<number> {
  let sent = 0;
  for (const tenantId of tenantIds) {
    const due = await withTenant(tenantId, async (tx) => {
      const scheds = await tx
        .select()
        .from(schedules)
        .where(
          and(
            eq(schedules.tenantId, tenantId),
            eq(schedules.status, "published"),
            or(
              isNull(schedules.coverageRemindedAt),
              lt(
                schedules.coverageRemindedAt,
                new Date(now.getTime() - MIN_GAP_BETWEEN_REMINDERS_MS),
              ),
            ),
          ),
        )
        .orderBy(asc(schedules.name));
      const out: Array<{ schedule: typeof schedules.$inferSelect; gaps: CoverageGap[] }> = [];
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
        const cov = coverageOf(
          s,
          rots,
          ovs,
          now,
          new Date(now.getTime() + COVERAGE_HORIZON_DAYS * 86_400_000),
        );
        const gaps = upcomingGaps(cov, now, REMINDER_DAYS);
        if (gaps.length > 0) out.push({ schedule: s, gaps });
      }
      if (out.length === 0) return null;
      const managers = await tx
        .select({ email: members.email, name: members.name })
        .from(members)
        .where(
          and(
            eq(members.tenantId, tenantId),
            eq(members.status, "active"),
            inArray(members.role, ["owner", "admin"]),
          ),
        );
      return { out, managers };
    });
    if (!due) continue;
    const tenant = await getTenantById(tenantId);
    if (!tenant) continue;
    const origin = tenantOrigin(tenant.slug, tenant.customDomain);
    const lines = due.out.flatMap(({ schedule, gaps }) => [
      `${schedule.name} — ${gaps.length} gap(s) in the next ${REMINDER_DAYS} days:`,
      ...gaps
        .slice(0, 8)
        .map(
          (g) =>
            `  • ${fmt(g.startAt, schedule.timezone)} → ${fmt(g.endAt, schedule.timezone)} (${Math.round(g.minutes / 6) / 10} h)`,
        ),
      `  ${origin}/app/on-call?schedule=${schedule.id}`,
      "",
    ]);
    const text = [
      "Some on-call hours have nobody in the coming week.",
      "",
      ...lines,
      "Cover them with an override, or add people to the rotation.",
    ].join("\n");
    for (const m of due.managers) {
      const r = await sendTenantEmail({
        tenantId,
        to: m.email,
        subject: `On-call coverage — ${due.out.length} schedule(s) with gaps this week`,
        text,
        kind: "other",
        ref: "coverage",
      }).catch(() => null);
      if (r) sent++;
    }
    await withTenant(tenantId, (tx) =>
      tx
        .update(schedules)
        .set({ coverageRemindedAt: now })
        .where(
          inArray(
            schedules.id,
            due.out.map((o) => o.schedule.id),
          ),
        ),
    );
  }
  return sent;
}
