import Link from "next/link";
import { withTenant } from "@openincident/db";
import { isManagerRole } from "@openincident/config";
import { getT, type Translate } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { getWorkspace } from "@/lib/tenant";
import {
  activeMembers,
  getSchedule,
  listSchedules,
  scheduleCoverage,
  TIMEZONES,
  type ScheduleDetail,
} from "@/lib/oncall";
import { NewScheduleDialog } from "./new-schedule";
import { publishSchedule } from "./actions";
import { RotationPeople } from "./people";
import { followsTheSun } from "./grid";

const GHOST: React.CSSProperties = {
  height: 30,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ink)",
  textDecoration: "none",
  cursor: "pointer",
};

/**
 * What a schedule is made of, in the design's words: "2 rotations ·
 * follow-the-sun · handover 09:00 / 21:00 · 5 members", or "1 rotation ·
 * weekly · 09:00 – 18:00 · 3 members". Read from the rotations themselves.
 */
function summaryOf(t: Translate, detail: ScheduleDetail): string {
  const rots = detail.rotations;
  const people = new Set(rots.flatMap((r) => r.memberIds));
  const parts = [t("oc2.sched.rotationsN", { count: rots.length })];
  if (followsTheSun(rots)) {
    parts.push(t("ocv2.sched.followSun"));
    const starts = [...new Set(rots.map((r) => r.activeStart!))].sort();
    parts.push(t("oc2.sched.handover", { time: starts.join(" / ") }));
  } else {
    for (const i of [...new Set(rots.map((r) => r.interval))])
      parts.push(t(`oc2.sched.interval.${i}`));
    const hours = [
      ...new Set(
        rots
          .filter((r) => r.activeStart && r.activeEnd)
          .map((r) => t("oc2.now.hoursRange", { from: r.activeStart!, to: r.activeEnd! })),
      ),
    ];
    if (rots.length > 0 && hours.length > 0 && rots.every((r) => r.activeStart && r.activeEnd))
      parts.push(hours.join(" / "));
    else parts.push(t("oc2.sched.handover", { time: detail.schedule.handoverTime }));
  }
  parts.push(t("oc2.sched.membersN", { count: people.size }));
  return parts.join(t("oc2.sep"));
}

/**
 * On-call · Schedules — one row per schedule: what it is made of, its
 * people, the calendar feed, and the way into the grid that draws it.
 *
 * The line also warns when the next sixty days hold hours with nobody: a
 * schedule that looks fine and has a hole on the 3rd of next month is the one
 * that wakes nobody that night. A covered schedule says nothing more.
 */
export async function SchedulesTab({ q }: { q: Record<string, string | undefined> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const workspace = await getWorkspace();
  const manages = isManagerRole(member);
  const now = new Date();
  const data = await withTenant(tenant.id, async (tx) => {
    const all = await listSchedules(tx, tenant.id);
    const details: ScheduleDetail[] = [];
    for (const s of all) {
      const one = await getSchedule(tx, tenant.id, s.id, { from: now, to: now }, now);
      if (one) details.push(one);
    }
    return { details, people: await activeMembers(tx, tenant.id) };
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        animation: "oi-rise .16s ease backwards",
      }}
      data-screen-label="Schedules"
    >
      {q.error && (
        <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
          {t("oc2.sched.errorInvalid")}
        </div>
      )}
      {data.details.length === 0 && !manages && (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("oc2.sched.none")}</div>
      )}
      {data.details.map((detail) => {
        const s = detail.schedule;
        const coverage = scheduleCoverage(detail, now);
        const gapHours = Math.round(coverage.uncoveredMinutes / 60);
        const open = q.members === s.id;
        return (
          <div
            key={s.id}
            data-testid="schedule-row"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-card)",
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: open ? 12 : 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700 }}>{s.name}</span>
                  {s.status !== "published" && (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        background: "var(--wait-t)",
                        color: "var(--wait)",
                        borderRadius: 999,
                        padding: "2px 8px",
                      }}
                    >
                      {t("oc2.sched.draft")}
                    </span>
                  )}
                </div>
                <div data-testid="coverage-summary" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {summaryOf(t, detail)}
                  {coverage.gaps.length > 0 && (
                    <>
                      {t("oc2.sep")}
                      <span style={{ color: "var(--wait)", fontWeight: 600 }}>
                        {t("oc2.sched.gaps", { count: gapHours })}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <span style={{ flex: 1 }} />
              {manages && s.status !== "published" && (
                <form action={publishSchedule}>
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="oi-hover" style={GHOST}>
                    {t("oc2.sched.publish")}
                  </button>
                </form>
              )}
              <Link
                href={
                  open ? "/app/on-call?tab=schedules" : `/app/on-call?tab=schedules&members=${s.id}`
                }
                className="oi-hover"
                data-testid="schedule-members"
                aria-expanded={open}
                scroll={false}
                style={GHOST}
              >
                {t("oc2.sched.members")}
              </Link>
              <a
                href={`/api/oncall/ical/${s.icalToken}`}
                title={t("oc2.sched.icalHint")}
                className="oi-hover"
                style={GHOST}
              >
                {t("oc2.sched.ical")}
              </a>
              <Link
                href={`/app/on-call?tab=now&schedule=${s.id}`}
                className="oi-hover-brand-2"
                data-testid="schedule-open-grid"
                style={{
                  ...GHOST,
                  border: 0,
                  background: "var(--brand)",
                  color: "var(--on-brand)",
                }}
              >
                {t("oc2.sched.open")}
              </Link>
            </div>

            {open && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {detail.rotations.length === 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    {t("oc2.now.noRotation")}
                  </div>
                )}
                {detail.rotations.map((rot) => (
                  <RotationPeople
                    key={rot.id}
                    schedule={s}
                    rotation={rot}
                    people={data.people}
                    now={now}
                    manages={manages}
                    returnTo={`/app/on-call?tab=schedules&members=${s.id}`}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {manages && (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-card)",
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("oc2.sched.newTitle")}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{t("oc2.sched.newNote")}</div>
          </div>
          <NewScheduleDialog
            members={data.people}
            timezones={TIMEZONES}
            defaultTimezone={workspace?.timezone ?? "Europe/Paris"}
          />
        </div>
      )}
    </div>
  );
}
