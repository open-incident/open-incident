import Link from "next/link";
import { withTenant } from "@openincident/db";
import { addDays, localDayKey, localParts, zonedTime } from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { isManagerRole } from "@openincident/config";
import {
  activeMembers,
  getSchedule,
  listSchedules,
  nextOwnShift,
  scheduleCoverage,
} from "@/lib/oncall";
import { avatarTone, initials } from "@/lib/avatar";
import { OnCallRail } from "./rail";
import { OverrideDialog } from "./override-dialog";
import {
  acceptCover,
  createOverride,
  deleteOverride,
  publishSchedule,
  requestCover,
  slotBounds,
  updateRotationMembers,
} from "./actions";

/**
 * On-call — a schedule: who is on call now, the week grid (rotations × days,
 * a click reassigns one slot with an override), the month view, "cover me",
 * overrides and the iCal feed. Handovers are computed in the schedule's zone.
 */
export default async function OnCallPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const now = new Date();
  const view = q.view === "month" ? "month" : "week";
  const scheds = await withTenant(tenant.id, (tx) => listSchedules(tx, tenant.id));
  const schedule = scheds.find((s) => s.id === q.schedule) ?? scheds[0] ?? null;
  if (!schedule) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <OnCallRail active={{}} />
        <div style={{ flex: 1, padding: "16px 20px" }}>
          <div
            style={{
              padding: 36,
              border: "1.5px dashed var(--line)",
              borderRadius: 14,
              color: "var(--ink-3)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {t("oncall.noSchedules")}
          </div>
        </div>
      </div>
    );
  }
  const tz = schedule.timezone;
  // Window: the week (Mon → Sun) containing `from`, or two months for the month view.
  const anchor = q.from ? new Date(q.from) : now;
  const p = localParts(anchor, tz);
  const weekStart = addDays(p.year, p.month, p.day, -(p.weekday - 1));
  const from =
    view === "week"
      ? zonedTime(weekStart[0], weekStart[1], weekStart[2], "00:00", tz)
      : zonedTime(p.year, p.month, 1, "00:00", tz);
  const toParts =
    view === "week"
      ? addDays(weekStart[0], weekStart[1], weekStart[2], 7)
      : ([p.month === 12 ? p.year + 1 : p.year, p.month === 12 ? 2 : p.month + 2, 1] as [
          number,
          number,
          number,
        ]);
  const to = zonedTime(toParts[0], toParts[1], toParts[2], "00:00", tz);
  const data = await withTenant(tenant.id, async (tx) => ({
    detail: (await getSchedule(tx, tenant.id, schedule.id, { from, to }, now))!,
    members: await activeMembers(tx, tenant.id),
  }));
  const { detail } = data;
  const coverage = scheduleCoverage(detail, now);
  const upcoming = coverage.gaps.filter((g) => g.endAt.getTime() > now.getTime()).slice(0, 5);
  const nameOf = (id: string | null) =>
    id ? (data.members.find((m) => m.id === id)?.name ?? "—") : t("oncall.nobody");
  const acts = canRespond(member);
  const manages = isManagerRole(member);
  const days = Array.from({ length: 7 }, (_, i) =>
    addDays(weekStart[0], weekStart[1], weekStart[2], i),
  );
  const todayKey = localDayKey(now, tz);
  const keyOf = (d: [number, number, number]) =>
    `${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`;
  const dayLabel = (d: [number, number, number]) =>
    t.fmt.dayMonth(zonedTime(d[0], d[1], d[2], "12:00", tz));
  const prevFrom =
    view === "week"
      ? zonedTime(...addDays(weekStart[0], weekStart[1], weekStart[2], -7), "12:00", tz)
      : zonedTime(
          p.month === 1 ? p.year - 1 : p.year,
          p.month === 1 ? 12 : p.month - 1,
          1,
          "12:00",
          tz,
        );
  const nextFrom =
    view === "week"
      ? zonedTime(...addDays(weekStart[0], weekStart[1], weekStart[2], 7), "12:00", tz)
      : zonedTime(
          p.month === 12 ? p.year + 1 : p.year,
          p.month === 12 ? 1 : p.month + 1,
          1,
          "12:00",
          tz,
        );
  const link = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams({
      schedule: schedule.id,
      view,
      ...(q.from ? { from: q.from } : {}),
    });
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) u.delete(k);
      else u.set(k, v);
    }
    return `/app/on-call?${u.toString()}`;
  };
  const selected = q.cell
    ? { rotationId: q.cell.split(":")[0]!, dayKey: q.cell.split(":")[1]! }
    : null;
  const managed = detail.rotations.find((r) => r.id === q.manage) ?? null;
  const mine = nextOwnShift(detail, member.id, now);
  const is247 = detail.rotations.every((r) => !r.activeStart);
  const hours = detail.rotations.map((r) =>
    r.activeStart ? `${r.activeStart} / ${r.activeEnd}` : "24/7",
  );
  const legendMembers = [...new Set(detail.rotations.flatMap((r) => r.memberIds))];
  const ghost: React.CSSProperties = {
    height: 34,
    padding: "0 13px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    background: "var(--panel)",
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    fontWeight: 500,
    color: "inherit",
    textDecoration: "none",
    cursor: "pointer",
  };

  /** The shift shown in one cell: the shift covering the middle of the rotation's active period that day. */
  const cellShift = (rotation: (typeof detail.rotations)[number], dayKey: string) => {
    const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
    const start = zonedTime(y, m, d, rotation.activeStart ?? "00:00", tz);
    let end = zonedTime(y, m, d, rotation.activeEnd ?? "00:00", tz);
    if (end.getTime() <= start.getTime())
      end = zonedTime(...addDays(y, m, d, 1), rotation.activeEnd ?? "00:00", tz);
    const mid = (start.getTime() + end.getTime()) / 2;
    return (
      detail.shifts[rotation.id]?.find(
        (s) => s.startAt.getTime() <= mid && s.endAt.getTime() > mid,
      ) ?? null
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <OnCallRail active={{ schedule: schedule.id }} />
      <main style={{ flex: 1, minWidth: 0, padding: "16px 20px 24px", overflow: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className="oi-title" style={{ margin: 0 }}>
              {schedule.name}
            </h1>
            <span
              style={{
                padding: "2px 9px",
                borderRadius: 999,
                background: "var(--sunk)",
                color: "var(--ink-2)",
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              {is247 ? "24/7" : hours.join(" · ")}
            </span>
            {schedule.status === "draft" && (
              <span
                style={{
                  padding: "2px 9px",
                  borderRadius: 999,
                  background: "var(--wait-t)",
                  color: "var(--wait)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {t("oncall.draftBadge")}
              </span>
            )}
            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("oncall.summary", {
                count: detail.rotations.length,
                handover: schedule.handoverTime,
                timezone: tz,
              })}
            </span>
            <span style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 8 }}>
              {schedule.status === "draft" && manages && (
                <form action={publishSchedule}>
                  <input type="hidden" name="id" value={schedule.id} />
                  <button
                    type="submit"
                    data-testid="schedule-publish"
                    style={{
                      ...ghost,
                      background: "var(--brand)",
                      color: "#fff",
                      border: 0,
                      fontWeight: 600,
                    }}
                  >
                    {t("oncall.publish")}
                  </button>
                </form>
              )}
              {mine && (
                <Link
                  href={link({ cover: q.cover ? undefined : "1" })}
                  className="oi-hover-edge-fill"
                  style={{ ...ghost, fontWeight: 600, color: "var(--brand)" }}
                >
                  {t("oncall.coverMe")}
                </Link>
              )}
              {acts && (
                <OverrideDialog
                  scheduleId={schedule.id}
                  rotations={detail.rotations.map((r) => ({ id: r.id, name: r.name }))}
                  members={data.members.map((m) => ({ id: m.id, name: m.name }))}
                />
              )}
              <a
                href={`/api/oncall/ical/${schedule.icalToken}.ics`}
                className="oi-hover"
                style={ghost}
              >
                iCal
              </a>
            </div>
          </div>

          <div
            data-testid="coverage-summary"
            className="oi-panel"
            style={{
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              borderColor: coverage.gaps.length ? "var(--wait)" : undefined,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="oi-eyebrow">{t("oncall.coverage.title")}</span>
              <span
                style={{
                  fontFamily: "var(--font-title)",
                  fontSize: 18,
                  fontWeight: 600,
                  color: coverage.gaps.length ? "var(--wait)" : "var(--ok)",
                }}
              >
                {Math.round(coverage.coveredRatio * 1000) / 10} %
              </span>
              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                {coverage.gaps.length === 0
                  ? t("oncall.coverage.full")
                  : t("oncall.coverage.gaps", {
                      count: coverage.gaps.length,
                      hours: Math.round(coverage.uncoveredMinutes / 6) / 10,
                    })}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("oncall.coverage.note")}
              </span>
            </div>
            {upcoming.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {upcoming.map((g) => (
                  <div
                    key={g.startAt.toISOString()}
                    data-testid="coverage-gap"
                    style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "var(--wait)",
                        flex: "none",
                      }}
                    />
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {t.fmt.dateTime(g.startAt, tz)} → {t.fmt.dateTime(g.endAt, tz)}
                    </span>
                    <span style={{ color: "var(--ink-3)" }}>{t.fmt.duration(g.minutes)}</span>
                    {acts && (
                      <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--ink-3)" }}>
                        {t("oncall.coverage.fixHint")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {q.cover === "1" && mine && (
            <form
              action={requestCover}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--brand-t)",
                border: "1px solid var(--brand-b)",
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 13,
                flexWrap: "wrap",
              }}
            >
              <input type="hidden" name="scheduleId" value={schedule.id} />
              <input type="hidden" name="rotationId" value={mine.rotationId} />
              <input type="hidden" name="startAt" value={mine.startAt.toISOString()} />
              <input type="hidden" name="endAt" value={mine.endAt.toISOString()} />
              <span style={{ fontWeight: 600, color: "var(--brand)" }}>
                {t("oncall.coverMeTitle")}
              </span>
              <span style={{ color: "var(--ink-2)" }}>
                {t("oncall.coverMeText", {
                  from: t.fmt.dateTime(mine.startAt),
                  to: t.fmt.dateTime(mine.endAt),
                  count: Math.max(
                    0,
                    (detail.rotations.find((r) => r.id === mine.rotationId)?.memberIds.length ??
                      1) - 1,
                  ),
                })}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="submit"
                data-testid="cover-send"
                style={{
                  height: 30,
                  padding: "0 13px",
                  borderRadius: 8,
                  background: "var(--brand)",
                  color: "#fff",
                  border: 0,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("oncall.sendRequest")}
              </button>
              <Link
                href={link({ cover: undefined })}
                style={{
                  height: 30,
                  padding: "0 12px",
                  border: "1px solid var(--brand-b)",
                  borderRadius: 8,
                  background: "var(--panel)",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 12.5,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                {t("common.cancel")}
              </Link>
            </form>
          )}
          {q.coverSent === "1" && (
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--ok-t)",
                border: "1px solid var(--ok)",
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} />
              {t("oncall.coverSent")}
            </div>
          )}
          {q.created === "1" && (
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--ok-t)",
                border: "1px solid var(--ok)",
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} />
              {t("oncall.createdDraft", { name: schedule.name })}
            </div>
          )}
          {detail.openCovers
            .filter((c) => c.requesterMemberId !== member.id)
            .map((c) => (
              <form
                key={c.id}
                action={acceptCover}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "var(--note)",
                  border: "1px solid var(--note-b)",
                  borderRadius: 12,
                  padding: "10px 14px",
                  fontSize: 13,
                  color: "var(--ink-2)",
                  flexWrap: "wrap",
                }}
              >
                <input type="hidden" name="id" value={c.id} />
                <span>
                  {t("oncall.coverOffer", {
                    name: nameOf(c.requesterMemberId),
                    from: t.fmt.dateTime(c.startAt),
                    to: t.fmt.dateTime(c.endAt),
                  })}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="submit"
                  data-testid="cover-accept"
                  style={{
                    height: 30,
                    padding: "0 13px",
                    borderRadius: 8,
                    background: "var(--brand)",
                    color: "#fff",
                    border: 0,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t("oncall.acceptCover")}
                </button>
              </form>
            ))}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 13,
              padding: "11px 16px",
              flexWrap: "wrap",
            }}
          >
            <span className="oi-eyebrow">{t("oncall.onCallNow")}</span>
            {detail.current.map((c) => {
              const tone = c.memberId
                ? avatarTone(nameOf(c.memberId))
                : { bg: "var(--sunk)", ink: "var(--ink-3)" };
              return (
                <span
                  key={c.rotationId}
                  data-testid="oncall-now"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    background: "var(--sunk)",
                    borderRadius: 999,
                    padding: "4px 12px 4px 5px",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: tone.bg,
                      color: tone.ink,
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 700,
                      fontSize: 9,
                    }}
                  >
                    {c.memberId ? initials(nameOf(c.memberId)) : "—"}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{nameOf(c.memberId)}</span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                    {c.rotationName} · {t("oncall.until", { when: t.fmt.dateTime(c.until) })}
                    {c.override ? ` · ${t("oncall.overrideTag")}` : ""}
                  </span>
                </span>
              );
            })}
            {detail.current.length === 0 && (
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {schedule.status === "draft" ? t("oncall.draftNobody") : t("oncall.nobodyNow")}
              </span>
            )}
          </div>

          <div className="oi-panel">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 18px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {view === "week"
                  ? t("oncall.weekOf", { from: dayLabel(days[0]!), to: dayLabel(days[6]!) })
                  : t("oncall.monthTitle", { month: t.fmt.dayMonth(from).replace(/^\d+\s*/, "") })}
              </span>
              <span style={{ flex: 1 }} />
              <div
                style={{
                  display: "flex",
                  gap: 2,
                  background: "var(--sunk)",
                  borderRadius: 9,
                  padding: 3,
                }}
              >
                {(["week", "month"] as const).map((v) => (
                  <Link
                    key={v}
                    href={link({ view: v, cell: undefined, manage: undefined })}
                    style={{
                      height: 26,
                      padding: "0 12px",
                      borderRadius: 7,
                      background: view === v ? "var(--panel)" : "transparent",
                      color: view === v ? "var(--ink)" : "var(--ink-3)",
                      display: "flex",
                      alignItems: "center",
                      fontSize: 12.5,
                      fontWeight: 600,
                      boxShadow: view === v ? "var(--shadow-card)" : undefined,
                      textDecoration: "none",
                    }}
                  >
                    {v === "week" ? t("oncall.week") : t("oncall.month")}
                  </Link>
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  overflow: "hidden",
                }}
              >
                <Link
                  href={link({ from: prevFrom.toISOString(), cell: undefined })}
                  aria-label={t("common.previous")}
                  className="oi-hover"
                  style={{
                    height: 32,
                    width: 30,
                    display: "grid",
                    placeItems: "center",
                    color: "var(--ink-2)",
                    textDecoration: "none",
                  }}
                >
                  ‹
                </Link>
                <Link
                  href={link({ from: nextFrom.toISOString(), cell: undefined })}
                  aria-label={t("common.next")}
                  className="oi-hover"
                  style={{
                    height: 32,
                    width: 30,
                    display: "grid",
                    placeItems: "center",
                    color: "var(--ink-2)",
                    borderLeft: "1px solid var(--line-2)",
                    textDecoration: "none",
                  }}
                >
                  ›
                </Link>
              </div>
            </div>

            {view === "week" && (
              <div
                style={{
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  overflowX: "auto",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px repeat(7, 1fr)",
                    gap: 6,
                    minWidth: 720,
                  }}
                >
                  <span />
                  {days.map((d) => {
                    const k = keyOf(d);
                    const today = k === todayKey;
                    return (
                      <div
                        key={k}
                        style={{
                          fontSize: 12,
                          fontWeight: today ? 700 : 500,
                          color: today ? "var(--brand)" : "var(--ink-3)",
                          background: today ? "var(--brand-t)" : "transparent",
                          borderRadius: 8,
                          padding: "4px 0",
                          textAlign: "center",
                        }}
                      >
                        {dayLabel(d)}
                        {today ? ` · ${t("oncall.today")}` : ""}
                      </div>
                    );
                  })}
                </div>
                {detail.rotations.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "140px repeat(7, 1fr)",
                      gap: 6,
                      minWidth: 720,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                        {r.activeStart ? `${r.activeStart} – ${r.activeEnd}` : "24/7"} ·{" "}
                        {t(`oncall.interval.${r.interval}`)}
                      </span>
                      <Link
                        href={link({
                          manage: q.manage === r.id ? undefined : r.id,
                          cell: undefined,
                        })}
                        data-testid="rotation-manage"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--brand)",
                          width: "fit-content",
                          textDecoration: "none",
                        }}
                      >
                        {q.manage === r.id ? "▾" : "☰"}{" "}
                        {t("oncall.people", { count: r.memberIds.length })}
                      </Link>
                    </div>
                    {days.map((d) => {
                      const k = keyOf(d);
                      const s = cellShift(r, k);
                      const name = s ? nameOf(s.memberId) : null;
                      const tone = s?.memberId
                        ? avatarTone(name!)
                        : { bg: "var(--sunk)", ink: "var(--ink-3)" };
                      const sel = selected?.rotationId === r.id && selected.dayKey === k;
                      const inactive = !s;
                      return (
                        <Link
                          key={k}
                          href={
                            acts
                              ? link({ cell: sel ? undefined : `${r.id}:${k}`, manage: undefined })
                              : link({})
                          }
                          data-testid="shift-cell"
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 2,
                            minHeight: 52,
                            borderRadius: 10,
                            background: inactive ? "transparent" : tone.bg,
                            border: s?.override
                              ? "1.5px dashed var(--wait)"
                              : inactive
                                ? "1px dashed var(--line-2)"
                                : "1px solid transparent",
                            boxShadow: sel ? "0 0 0 2px var(--brand)" : undefined,
                            padding: "6px 4px",
                            textDecoration: "none",
                            color: "inherit",
                          }}
                        >
                          {s && (
                            <>
                              <span
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: "50%",
                                  background: "var(--panel)",
                                  color: tone.ink,
                                  display: "grid",
                                  placeItems: "center",
                                  fontWeight: 700,
                                  fontSize: 8.5,
                                }}
                              >
                                {s.memberId ? initials(name!) : "—"}
                              </span>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: tone.ink,
                                  textAlign: "center",
                                }}
                              >
                                {s.memberId ? name!.split(" ")[0] : t("oncall.nobody")}
                              </span>
                              {s.override && (
                                <span style={{ fontSize: 9, fontWeight: 700, color: tone.ink }}>
                                  {t("oncall.overrideTag").toUpperCase()}
                                </span>
                              )}
                            </>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                ))}

                {selected &&
                  acts &&
                  (() => {
                    const r = detail.rotations.find((x) => x.id === selected.rotationId);
                    if (!r) return null;
                    const s = cellShift(r, selected.dayKey);
                    return (
                      <ReassignBanner
                        scheduleId={schedule.id}
                        rotation={r}
                        dayKey={selected.dayKey}
                        timezone={tz}
                        current={s}
                        members={data.members}
                        label={`${dayLabel(selected.dayKey.split("-").map(Number) as [number, number, number])} · ${r.name}`}
                        closeHref={link({ cell: undefined })}
                      />
                    );
                  })()}

                {managed && manages && (
                  <div
                    data-testid="rotation-members"
                    style={{
                      border: "1px solid var(--line)",
                      background: "var(--sunk)",
                      borderRadius: 12,
                      padding: "12px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 9,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {t("oncall.peopleOf", { name: managed.name })}
                      </span>
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                        {t("oncall.orderNote", { handover: schedule.handoverTime })}
                      </span>
                      <span style={{ flex: 1 }} />
                      <Link
                        href={link({ manage: undefined })}
                        aria-label={t("common.close")}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          display: "grid",
                          placeItems: "center",
                          color: "var(--ink-3)",
                          fontSize: 12,
                          textDecoration: "none",
                        }}
                      >
                        ✕
                      </Link>
                    </div>
                    {managed.memberIds.map((id, i, arr) => {
                      const tone = avatarTone(nameOf(id));
                      const btn = (
                        op: string,
                        disabled: boolean,
                        glyph: string,
                        danger?: boolean,
                      ) => (
                        <form action={updateRotationMembers} style={{ display: "contents" }}>
                          <input type="hidden" name="rotationId" value={managed.id} />
                          <input type="hidden" name="memberId" value={id} />
                          <input type="hidden" name="op" value={op} />
                          <button
                            type="submit"
                            disabled={disabled}
                            aria-label={op}
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 7,
                              border: "1px solid var(--line)",
                              background: "var(--panel)",
                              display: "grid",
                              placeItems: "center",
                              fontSize: 11,
                              color: disabled
                                ? "var(--line-2)"
                                : danger
                                  ? "var(--dang)"
                                  : "var(--ink-2)",
                              cursor: disabled ? "default" : "pointer",
                            }}
                          >
                            {glyph}
                          </button>
                        </form>
                      );
                      return (
                        <div
                          key={id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            background: "var(--panel)",
                            border: "1px solid var(--line)",
                            borderRadius: 10,
                            padding: "7px 11px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--ink-3)",
                              fontVariantNumeric: "tabular-nums",
                              width: 14,
                            }}
                          >
                            {i + 1}
                          </span>
                          <span
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                              background: tone.bg,
                              color: tone.ink,
                              display: "grid",
                              placeItems: "center",
                              fontWeight: 700,
                              fontSize: 9,
                            }}
                          >
                            {initials(nameOf(id))}
                          </span>
                          <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>
                            {nameOf(id)}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                            {i === 0 ? t("oncall.turnNow") : t("oncall.turnIn", { count: i })}
                          </span>
                          {btn("up", i === 0, "↑")}
                          {btn("down", i === arr.length - 1, "↓")}
                          {btn("remove", false, "✕", true)}
                        </div>
                      );
                    })}
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                    >
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                        {t("oncall.add")}
                      </span>
                      {data.members
                        .filter((m) => !managed.memberIds.includes(m.id))
                        .map((m) => {
                          const tone = avatarTone(m.name);
                          return (
                            <form key={m.id} action={updateRotationMembers}>
                              <input type="hidden" name="rotationId" value={managed.id} />
                              <input type="hidden" name="memberId" value={m.id} />
                              <input type="hidden" name="op" value="add" />
                              <button
                                type="submit"
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  border: "1.5px dashed var(--line)",
                                  borderRadius: 999,
                                  padding: "3px 11px 3px 5px",
                                  background: "var(--panel)",
                                  cursor: "pointer",
                                }}
                              >
                                <span
                                  style={{
                                    width: 18,
                                    height: 18,
                                    borderRadius: "50%",
                                    background: tone.bg,
                                    color: tone.ink,
                                    display: "grid",
                                    placeItems: "center",
                                    fontWeight: 700,
                                    fontSize: 8,
                                  }}
                                >
                                  {initials(m.name)}
                                </span>
                                <span
                                  style={{ fontSize: 11.5, fontWeight: 600, color: "var(--brand)" }}
                                >
                                  + {m.name.split(" ")[0]}
                                </span>
                              </button>
                            </form>
                          );
                        })}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      {t("oncall.membersNote")}
                    </div>
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                    paddingTop: 2,
                    flexWrap: "wrap",
                  }}
                >
                  {legendMembers.map((id) => {
                    const tone = avatarTone(nameOf(id));
                    return (
                      <span key={id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 4,
                            background: tone.bg,
                            border: `1px solid ${tone.ink}`,
                          }}
                        />
                        {nameOf(id)}
                      </span>
                    );
                  })}
                  {detail.overrides
                    .filter((o) => o.endAt > from && o.startAt < to)
                    .map((o) => (
                      <span key={o.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 4,
                            background: "var(--wait-t)",
                            border: "1.5px dashed var(--wait)",
                          }}
                        />
                        {t("oncall.overrideLegend", { name: nameOf(o.memberId) })}
                        {acts && (
                          <form action={deleteOverride} style={{ display: "inline" }}>
                            <input type="hidden" name="id" value={o.id} />
                            <button
                              type="submit"
                              style={{
                                border: 0,
                                background: "transparent",
                                color: "var(--dang)",
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: "pointer",
                                padding: 0,
                              }}
                            >
                              {t("oncall.removeOverride")}
                            </button>
                          </form>
                        )}
                      </span>
                    ))}
                </div>
              </div>
            )}

            {view === "month" && (
              <div style={{ padding: "16px 18px", display: "flex", flexWrap: "wrap", gap: 20 }}>
                {[0, 1].map((mi) => {
                  const my = p.month + mi > 12 ? p.year + 1 : p.year;
                  const mm = ((p.month + mi - 1) % 12) + 1;
                  const dim = new Date(Date.UTC(my, mm, 0)).getUTCDate();
                  const offset =
                    (localParts(zonedTime(my, mm, 1, "12:00", tz), tz).weekday + 6) % 7;
                  const cells: Array<{ d: number; key: string } | null> = [
                    ...Array.from({ length: offset }, () => null),
                    ...Array.from({ length: dim }, (_, i) => ({
                      d: i + 1,
                      key: keyOf([my, mm, i + 1]),
                    })),
                  ];
                  return (
                    <div
                      key={mi}
                      style={{
                        flex: "1 1 320px",
                        minWidth: 300,
                        maxWidth: 480,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                        {t.fmt.dayMonth(zonedTime(my, mm, 1, "12:00", tz)).replace(/^\d+\s*/, "")}{" "}
                        {my}
                      </div>
                      <div
                        style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}
                      >
                        {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map(
                          (d, i) => (
                            <span
                              key={d}
                              style={{
                                fontSize: 10.5,
                                fontWeight: i >= 5 ? 700 : 600,
                                color: i >= 5 ? "var(--ink-2)" : "var(--ink-3)",
                                textAlign: "center",
                              }}
                            >
                              {t(`oncall.day.${d}`)}
                            </span>
                          ),
                        )}
                        {cells.map((c, i) => {
                          if (!c) return <span key={`e${i}`} />;
                          const noon = zonedTime(my, mm, c.d, "12:00", tz);
                          const s = detail.rotations
                            .map(
                              (r) =>
                                detail.shifts[r.id]?.find(
                                  (x) => x.startAt <= noon && x.endAt > noon,
                                ) ?? null,
                            )
                            .find((x) => x && x.memberId);
                          const name = s?.memberId ? nameOf(s.memberId) : null;
                          const tone = name ? avatarTone(name) : null;
                          const today = c.key === todayKey;
                          const we = i % 7 >= 5;
                          return (
                            <div
                              key={c.key}
                              style={{
                                minHeight: 42,
                                borderRadius: 8,
                                background: tone?.bg ?? "transparent",
                                border: today
                                  ? "1.5px solid var(--brand)"
                                  : `1px solid ${tone ? "transparent" : "var(--line-2)"}`,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 1,
                                padding: "4px 2px",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  color: tone?.ink ?? "var(--ink-2)",
                                  fontWeight: today || we ? 700 : 500,
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {c.d}
                              </span>
                              {name && (
                                <span style={{ fontSize: 9, fontWeight: 700, color: tone!.ink }}>
                                  {initials(name)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div style={{ flex: "1 1 100%", fontSize: 11.5, color: "var(--ink-3)" }}>
                  {t("oncall.monthNote")}
                </div>
              </div>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("oncall.footnote")}</div>
        </div>
      </main>
    </div>
  );
}

/** The inline "who takes this slot?" banner: one click creates an override on the slot only. */
async function ReassignBanner({
  scheduleId,
  rotation,
  dayKey,
  timezone,
  current,
  members,
  label,
  closeHref,
}: {
  scheduleId: string;
  rotation: {
    id: string;
    activeStart: string | null;
    activeEnd: string | null;
    memberIds: string[];
  };
  dayKey: string;
  timezone: string;
  current: { memberId: string | null; override: boolean; overrideId?: string } | null;
  members: Array<{ id: string; name: string }>;
  label: string;
  closeHref: string;
}) {
  const t = await getT();
  const bounds = await slotBounds(timezone, dayKey, rotation.activeStart, rotation.activeEnd);
  return (
    <div
      data-testid="reassign"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: "1px solid var(--brand-b)",
        background: "var(--brand-t)",
        borderRadius: 12,
        padding: "10px 14px",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label} —</span>
      <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{t("oncall.whoTakes")}</span>
      {members
        .filter((m) => m.id !== current?.memberId)
        .map((m) => {
          const tone = avatarTone(m.name);
          return (
            <form key={m.id} action={createOverride}>
              <input type="hidden" name="scheduleId" value={scheduleId} />
              <input type="hidden" name="rotationId" value={rotation.id} />
              <input type="hidden" name="memberId" value={m.id} />
              <input type="hidden" name="startAt" value={bounds.start.toISOString()} />
              <input type="hidden" name="endAt" value={bounds.end.toISOString()} />
              <input type="hidden" name="reason" value="override" />
              <button
                type="submit"
                data-testid="reassign-to"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  padding: "4px 11px 4px 5px",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: tone.bg,
                    color: tone.ink,
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 700,
                    fontSize: 8.5,
                  }}
                >
                  {initials(m.name)}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{m.name.split(" ")[0]}</span>
              </button>
            </form>
          );
        })}
      <span style={{ flex: 1 }} />
      {current?.override && current.overrideId && (
        <form action={deleteOverride}>
          <input type="hidden" name="id" value={current.overrideId} />
          <button
            type="submit"
            style={{
              border: 0,
              background: "transparent",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--dang)",
              cursor: "pointer",
            }}
          >
            {t("oncall.removeOverride")}
          </button>
        </form>
      )}
      <Link
        href={closeHref}
        aria-label={t("common.close")}
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontSize: 12,
          textDecoration: "none",
        }}
      >
        ✕
      </Link>
      <div style={{ flex: "1 1 100%", fontSize: 11, color: "var(--ink-3)", padding: "0 2px" }}>
        {t("oncall.reassignNote")}
      </div>
    </div>
  );
}
