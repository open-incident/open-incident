import Link from "next/link";
import { withTenant } from "@openincident/db";
import { isManagerRole } from "@openincident/config";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { getWorkspace } from "@/lib/tenant";
import { avatarTone, initials } from "@/lib/avatar";
import {
  activeMembers,
  getSchedule,
  listSchedules,
  scheduleCoverage,
  TIMEZONES,
  type ScheduleDetail,
} from "@/lib/oncall";
import { NewScheduleDialog } from "./new-schedule";
import { publishSchedule, updateRotationMembers } from "./actions";

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
  color: "inherit",
  textDecoration: "none",
  cursor: "pointer",
};

const ICON: React.CSSProperties = {
  width: 22,
  height: 22,
  border: "1px solid var(--line)",
  borderRadius: 7,
  background: "var(--panel)",
  color: "var(--ink-3)",
  display: "grid",
  placeItems: "center",
  fontSize: 11,
  cursor: "pointer",
};

/**
 * On-call · Schedules — one row per schedule: what it is made of, who is in
 * it, the calendar feed, and the way into the week that it drives.
 *
 * The summary counts what the schedule really holds; the hours-with-nobody
 * figure is the sixty-day sweep, because a schedule that looks fine and has a
 * hole on the 3rd of next month is the one that wakes nobody that night.
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
  const nameOf = (id: string) => data.people.find((m) => m.id === id)?.name ?? "—";

  return (
    <div className="oi-rise-fast" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {q.error && (
        <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
          {t("oc2.sched.errorInvalid")}
        </div>
      )}
      {data.details.length === 0 && (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("oc2.sched.none")}</div>
      )}
      {data.details.map((detail) => {
        const s = detail.schedule;
        const people = new Set(detail.rotations.flatMap((r) => r.memberIds));
        const intervals = [...new Set(detail.rotations.map((r) => r.interval))];
        const coverage = scheduleCoverage(detail, now);
        const summary = [
          t("oc2.sched.rotationsN", { count: detail.rotations.length }),
          ...intervals.map((i) => t(`oc2.sched.interval.${i}`)),
          t("oc2.sched.handover", { time: s.handoverTime }),
          t("oc2.sched.membersN", { count: people.size }),
          coverage.gaps.length
            ? t("oc2.sched.gaps", { count: Math.round(coverage.uncoveredMinutes / 60) })
            : t("oc2.sched.covered"),
        ].join(t("oc2.sep"));
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
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{summary}</div>
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
              {manages && (
                <Link
                  href={
                    open
                      ? "/app/on-call?tab=schedules"
                      : `/app/on-call?tab=schedules&members=${s.id}`
                  }
                  className="oi-hover"
                  data-testid="schedule-members"
                  style={GHOST}
                >
                  {t("oc2.sched.members")}
                </Link>
              )}
              <a
                href={`/api/oncall/ical/${s.icalToken}`}
                title={t("oc2.sched.icalHint")}
                className="oi-hover"
                style={GHOST}
              >
                {t("oc2.sched.ical")}
              </a>
              <Link
                href="/app/on-call?tab=now"
                className="oi-hover-brand-2"
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

            {open && manages && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {detail.rotations.length === 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    {t("oc2.now.noRotation")}
                  </div>
                )}
                {detail.rotations.map((rot) => {
                  const free = data.people.filter((m) => !rot.memberIds.includes(m.id));
                  return (
                    <div
                      key={rot.id}
                      data-testid="rotation-members"
                      style={{
                        background: "var(--sunk)",
                        borderRadius: 12,
                        padding: "11px 13px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {t("oc2.sched.rotationPeople", { name: rot.name })}
                      </div>
                      {rot.memberIds.length === 0 && (
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                          {t("oc2.sched.noMembers")}
                        </div>
                      )}
                      {rot.memberIds.map((id, i) => {
                        const label = nameOf(id);
                        const tone = avatarTone(label);
                        return (
                          <div key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                background: tone.bg,
                                color: tone.ink,
                                display: "grid",
                                placeItems: "center",
                                fontSize: 9,
                                fontWeight: 700,
                              }}
                            >
                              {initials(label)}
                            </span>
                            <span style={{ fontSize: 12.5 }}>{label}</span>
                            <span style={{ flex: 1 }} />
                            {(["up", "down", "remove"] as const).map((op) => {
                              if (op === "up" && i === 0) return null;
                              if (op === "down" && i === rot.memberIds.length - 1) return null;
                              return (
                                <form key={op} action={updateRotationMembers}>
                                  <input type="hidden" name="rotationId" value={rot.id} />
                                  <input type="hidden" name="memberId" value={id} />
                                  <input type="hidden" name="op" value={op} />
                                  <button
                                    type="submit"
                                    className="oi-hover"
                                    aria-label={t(
                                      op === "up"
                                        ? "oc2.sched.moveUp"
                                        : op === "down"
                                          ? "oc2.sched.moveDown"
                                          : "oc2.sched.removePerson",
                                    )}
                                    style={ICON}
                                  >
                                    {op === "up" ? "↑" : op === "down" ? "↓" : "✕"}
                                  </button>
                                </form>
                              );
                            })}
                          </div>
                        );
                      })}
                      {free.length === 0 ? (
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                          {t("oc2.sched.everyoneIn")}
                        </div>
                      ) : (
                        <form
                          action={updateRotationMembers}
                          style={{ display: "flex", alignItems: "center", gap: 8 }}
                        >
                          <input type="hidden" name="rotationId" value={rot.id} />
                          <input type="hidden" name="op" value="add" />
                          <select
                            name="memberId"
                            className="oi-field"
                            style={{
                              height: 30,
                              padding: "0 8px",
                              border: "1px solid var(--line)",
                              borderRadius: 8,
                              background: "var(--panel)",
                              fontSize: 12.5,
                            }}
                          >
                            {free.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="oi-hover"
                            style={{ ...GHOST, height: 30 }}
                          >
                            {t("oc2.sched.addPerson")}
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
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
