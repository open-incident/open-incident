import { Fragment } from "react";
import Link from "next/link";
import { withTenant } from "@openincident/db";
import { addDays, localParts, turnMemberAt, zonedTime, type Shift } from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { canRespond, isManager, requireMember } from "@/lib/session";
import { avatarTone, initials } from "@/lib/avatar";
import {
  activeMembers,
  getSchedule,
  listPaths,
  listSchedules,
  type ScheduleDetail,
} from "@/lib/oncall";
import { chainSentence, loadNameSource, namesOf, policyForSchedule } from "./policy";
import { acceptCover, pageOnCall, requestCover } from "./actions";
import { OverrideDialog } from "./override-dialog";
import { ShiftPicker } from "./shift-picker";
import { RotationPeople } from "./people";
import {
  cellOf,
  dayHead,
  dayTime,
  dayKey,
  firstName,
  hoursOf,
  inSentence,
  monthHead,
  nextWhen,
  slotOf,
  weekDays,
  weekendDays,
  type Day,
} from "./grid";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "16px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const BANNER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  borderRadius: 12,
  padding: "10px 14px",
  fontSize: 13,
};

const SEG: React.CSSProperties = {
  display: "flex",
  gap: 2,
  background: "var(--sunk)",
  borderRadius: 9,
  padding: 2,
};

const segItem = (on: boolean): React.CSSProperties => ({
  height: 24,
  padding: "0 10px",
  borderRadius: 7,
  background: on ? "var(--panel)" : "transparent",
  color: on ? "var(--ink)" : "var(--ink-3)",
  boxShadow: on ? "var(--shadow-card)" : "none",
  display: "flex",
  alignItems: "center",
  fontSize: 11.5,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
});

/** How far ahead the tab reads the schedules: the week, the week-ends of two months, the next shift. */
const HORIZON_DAYS = 60;

/**
 * On-call · Now — who carries each pager at this second, what the escalation
 * policy would do with it, and the days ahead as one grid where a click hands
 * a single shift to somebody else.
 *
 * Everything is read from the published schedules: a draft covers nobody and
 * is not drawn. The grid shows one schedule at a time — the one "Open" chose
 * on the Schedules tab, else the first — in two views: the seven days ahead,
 * and the week-ends of the next two months.
 */
export async function NowTab({ q }: { q: Record<string, string | undefined> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const now = new Date();
  const tz = t.timeZone;
  const tag = t.locale.tag;
  const acts = canRespond(member);
  const manages = isManager(member);
  const today = localParts(now, tz);
  // A week back: the shift under way started before today — a weekly turn
  // began up to seven days ago, and its card says since when.
  const back = addDays(today.year, today.month, today.day, -8);
  const windowFrom = zonedTime(back[0], back[1], back[2], "00:00", tz);
  const end = addDays(today.year, today.month, today.day, HORIZON_DAYS);
  const windowTo = zonedTime(end[0], end[1], end[2], "00:00", tz);

  const data = await withTenant(tenant.id, async (tx) => {
    const all = await listSchedules(tx, tenant.id);
    const details: ScheduleDetail[] = [];
    for (const s of all.filter((x) => x.status === "published")) {
      const one = await getSchedule(tx, tenant.id, s.id, { from: windowFrom, to: windowTo }, now);
      if (one) details.push(one);
    }
    // The reader's own schedules first — their pager is the one they came for —,
    // then the oldest; the name settles schedules created in the same instant.
    const mine = (d: ScheduleDetail) =>
      d.rotations.some((r) => r.memberIds.includes(member.id)) ? 0 : 1;
    details.sort(
      (a, b) =>
        mine(a) - mine(b) ||
        a.schedule.createdAt.getTime() - b.schedule.createdAt.getTime() ||
        a.schedule.name.localeCompare(b.schedule.name),
    );
    const paths = await listPaths(tx, tenant.id);
    const people = await activeMembers(tx, tenant.id);
    const byId = new Map(people.map((m) => [m.id, m.name]));
    const onCall = new Map<string, string>();
    for (const d of details) {
      const hit = d.current.find((c) => c.memberId);
      if (hit?.memberId) onCall.set(d.schedule.id, byId.get(hit.memberId) ?? "—");
    }
    const source = await loadNameSource(
      tx,
      tenant.id,
      paths.map((p) => p.graph),
      onCall,
    );
    return { details, paths, people, names: namesOf(source) };
  });

  const names = data.names;
  const nameOf = (id: string | null) => (id ? names.member(id) : t("oc2.now.nobody"));
  const view = q.view === "month" ? "month" : "week";
  const shown = data.details.find((d) => d.schedule.id === q.schedule) ?? data.details[0] ?? null;

  /** A link to this tab that keeps the schedule and the view, and changes the rest. */
  const href = (extra: Record<string, string | undefined> = {}) => {
    const p = new URLSearchParams({ tab: "now" });
    const base: Record<string, string | undefined> = {
      schedule: shown && data.details.length > 1 ? shown.schedule.id : undefined,
      view: view === "month" ? "month" : undefined,
      ...extra,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    return `/app/on-call?${p.toString()}`;
  };

  /* ---------- The cards: one per pager being carried ---------- */

  type Card = {
    detail: ScheduleDetail;
    slot: ScheduleDetail["current"][number] | null;
    /** No rotation is on right now: whose turn it is, and when they are on again. */
    off: { memberId: string | null; backAt: Date | null; rotationName: string } | null;
  };
  const cards: Card[] = [];
  for (const detail of data.details) {
    if (detail.current.length) {
      for (const slot of detail.current) cards.push({ detail, slot, off: null });
      continue;
    }
    const upcoming = Object.values(detail.shifts)
      .flat()
      .filter((s) => s.startAt.getTime() > now.getTime())
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
    const rot =
      detail.rotations.find((r) => r.id === upcoming?.rotationId) ?? detail.rotations[0] ?? null;
    cards.push({
      detail,
      slot: null,
      off: rot
        ? {
            memberId: turnMemberAt(detail.schedule, rot, now),
            backAt: upcoming?.startAt ?? null,
            rotationName: rot.name,
          }
        : null,
    });
  }

  /** Whether an instant is close enough to now for its hour alone to name it. */
  const within = (at: Date) => Math.abs(at.getTime() - now.getTime()) < 20 * 3_600_000;

  /** The first shift after now handed to somebody other than `memberId`. */
  const nextOf = (detail: ScheduleDetail, memberId: string | null): Shift | null =>
    Object.values(detail.shifts)
      .flat()
      .filter((s) => s.memberId && s.memberId !== memberId && s.startAt.getTime() >= now.getTime())
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0] ?? null;

  /* ---------- The grid ---------- */

  const days: Day[] = view === "month" ? weekendDays(now, tz) : weekDays(now, tz);
  const todayKey = dayKey([today.year, today.month, today.day]);
  const selected = q.cell
    ? { rotationId: q.cell.split(":")[0] ?? "", day: q.cell.split(":")[1] ?? "" }
    : null;
  const offers = data.details.flatMap((detail) =>
    detail.openCovers
      .filter((c) => c.requesterMemberId !== member.id)
      .map((c) => ({ detail, cover: c })),
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        animation: "oi-rise .16s ease backwards",
      }}
      data-testid="oncall-now-tab"
      data-screen-label="On-call — now"
    >
      {cards.length === 0 ? (
        <div style={{ ...CARD, gap: 6 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>{t("oc2.now.empty")}</span>
          <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
            {t("oc2.now.emptyNote")}
          </span>
          <Link
            href="/app/on-call?tab=schedules"
            className="oi-hover-brand-2"
            style={{
              marginTop: 4,
              height: 32,
              padding: "0 13px",
              borderRadius: 9,
              background: "var(--brand)",
              color: "var(--on-brand)",
              display: "inline-flex",
              alignItems: "center",
              width: "fit-content",
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {t("oc2.tab.schedules")}
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          {cards.map(({ detail, slot, off }) => {
            const zone = detail.schedule.timezone;
            const shifts = slot ? (detail.shifts[slot.rotationId] ?? []) : [];
            const current =
              shifts.find(
                (s) => s.startAt.getTime() <= now.getTime() && s.endAt.getTime() > now.getTime(),
              ) ?? null;
            const holder = slot ? slot.memberId : (off?.memberId ?? null);
            const who = slot
              ? nameOf(slot.memberId)
              : holder
                ? nameOf(holder)
                : t("oc2.now.uncovered");
            const tone = holder ? avatarTone(who) : { bg: "var(--sunk)", ink: "var(--ink-3)" };
            const next = nextOf(detail, holder);
            const policy = policyForSchedule(data.paths, detail.schedule.id);
            const rotation = slot ? detail.rotations.find((r) => r.id === slot.rotationId) : null;
            const meta =
              detail.rotations.length > 1
                ? t("ocv2.now.rotationMeta", {
                    name: inSentence(slot?.rotationName ?? off?.rotationName ?? ""),
                  })
                : (hoursOf(detail.rotations[0] ?? { activeStart: null, activeEnd: null }) ??
                  t("oc2.now.hours247"));
            const isMine = slot?.memberId === member.id;
            return (
              <div
                key={`${detail.schedule.id}:${slot?.rotationId ?? "off"}`}
                style={CARD}
                data-testid="oncall-now"
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{detail.schedule.name}</span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{meta}</span>
                  <span style={{ flex: 1 }} />
                  {slot && (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--dang)",
                      }}
                    >
                      <span
                        className="oi-pulse"
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--dang)",
                        }}
                      />
                      {t("oc2.now.live")}
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: tone.bg,
                      color: tone.ink,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 14,
                      fontWeight: 700,
                      flex: "none",
                    }}
                  >
                    {holder ? initials(who) : "—"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{who}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                      {slot
                        ? t("oc2.now.window", {
                            // Within the day the hour says it; a turn that began
                            // days ago names its day.
                            from: within(current?.startAt ?? now)
                              ? t.fmt.time(current?.startAt ?? now, zone)
                              : dayTime(current!.startAt, tag, zone),
                            to: within(slot.until)
                              ? t.fmt.time(slot.until, zone)
                              : dayTime(slot.until, tag, zone),
                            zone,
                          })
                        : off?.backAt
                          ? t("ocv2.now.offHours", { when: nextWhen(off.backAt, now, tag, zone) })
                          : t("oc2.now.uncoveredNote")}
                    </div>
                  </div>
                  {holder && acts && (
                    <form action={pageOnCall}>
                      <input type="hidden" name="memberId" value={holder} />
                      <button
                        type="submit"
                        data-testid="page-oncall"
                        className="oi-hover"
                        style={{
                          height: 32,
                          padding: "0 13px",
                          border: "1px solid var(--line)",
                          borderRadius: 9,
                          background: "var(--panel)",
                          color: "var(--ink)",
                          display: "flex",
                          alignItems: "center",
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t("oc2.now.page", { name: firstName(who) })}
                      </button>
                    </form>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    background: "var(--sunk)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    lineHeight: 1.5,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: ".08em",
                      color: "var(--ink-3)",
                      textTransform: "uppercase",
                    }}
                  >
                    {t("oc2.now.whoGetsPaged")}
                  </span>
                  {policy ? chainSentence(t, policy.graph, names) : t("oc2.now.chainNone")}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: "var(--ink-3)",
                  }}
                >
                  {t("oc2.now.next")}{" "}
                  <strong style={{ color: "var(--ink)", fontWeight: 700 }}>
                    {next
                      ? t("oc2.now.nextWho", {
                          name: firstName(nameOf(next.memberId)),
                          when: nextWhen(next.startAt, now, tag, zone),
                        })
                      : t("oc2.now.nextNone")}
                  </strong>
                  <span style={{ flex: 1 }} />
                  {isMine && current && rotation ? (
                    <form action={requestCover}>
                      <input type="hidden" name="scheduleId" value={detail.schedule.id} />
                      <input type="hidden" name="rotationId" value={rotation.id} />
                      <input type="hidden" name="startAt" value={current.startAt.toISOString()} />
                      <input type="hidden" name="endAt" value={current.endAt.toISOString()} />
                      <button
                        type="submit"
                        data-testid="cover-send"
                        style={{
                          border: 0,
                          background: "transparent",
                          padding: 0,
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--brand)",
                          cursor: "pointer",
                        }}
                      >
                        {t("oc2.now.coverMe")}
                      </button>
                    </form>
                  ) : (
                    acts && (
                      <OverrideDialog
                        scheduleId={detail.schedule.id}
                        rotations={detail.rotations.map((r) => ({ id: r.id, name: r.name }))}
                        members={data.people}
                        triggerLabel={t("oc2.now.addOverride")}
                      />
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {q.paged && (
        <div
          role="status"
          style={{ ...BANNER, background: "var(--ok-t)", border: "1px solid rgba(14,122,88,.3)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--ok)",
              flex: "none",
            }}
          />
          {t("oc2.now.paged", { name: q.paged })}
        </div>
      )}
      {q.pageError && (
        <div
          role="alert"
          style={{ ...BANNER, background: "var(--dang-t)", border: "1px solid var(--dang)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--dang)",
              flex: "none",
            }}
          />
          {t("oc2.now.pageUnavailable")}
        </div>
      )}
      {q.coverSent && (
        <div
          role="status"
          data-testid="cover-sent"
          style={{ ...BANNER, background: "var(--ok-t)", border: "1px solid rgba(14,122,88,.3)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--ok)",
              flex: "none",
            }}
          />
          {(() => {
            const from = q.coverFrom ? new Date(q.coverFrom) : null;
            const to = q.coverTo ? new Date(q.coverTo) : null;
            const count = Number(q.coverSent) || 0;
            return from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())
              ? t("ocv2.now.coverSent", {
                  count,
                  from: dayTime(from, tag, tz),
                  to: dayTime(to, tag, tz),
                })
              : t("oc2.now.coverSent", { count });
          })()}
        </div>
      )}
      {q.covered === "1" && (
        <div
          role="status"
          style={{ ...BANNER, background: "var(--ok-t)", border: "1px solid rgba(14,122,88,.3)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--ok)",
              flex: "none",
            }}
          />
          {t("oc2.now.covered")}
        </div>
      )}

      {offers.map(({ detail, cover }) => (
        <form
          key={cover.id}
          action={acceptCover}
          style={{
            ...BANNER,
            background: "var(--note)",
            border: "1px solid var(--note-b)",
            flexWrap: "wrap",
          }}
        >
          <input type="hidden" name="id" value={cover.id} />
          <span style={{ color: "var(--note-ink)" }}>
            {t("oc2.now.coverOffer", {
              name: nameOf(cover.requesterMemberId),
              from: t.fmt.dateTime(cover.startAt, detail.schedule.timezone),
              to: t.fmt.dateTime(cover.endAt, detail.schedule.timezone),
            })}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="submit"
            data-testid="cover-accept"
            className="oi-hover-brand-2"
            style={{
              height: 30,
              padding: "0 13px",
              borderRadius: 8,
              background: "var(--brand)",
              color: "var(--on-brand)",
              border: 0,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("oc2.now.coverAccept")}
          </button>
        </form>
      ))}

      {shown && (
        <div
          data-testid="oncall-grid"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>
              {view === "month" ? t("ocv2.now.weekendsTitle") : t("oc2.now.days")}
            </span>
            {data.details.length > 1 && (
              <div style={SEG} data-testid="grid-schedules">
                {data.details.map((d) => (
                  <Link
                    key={d.schedule.id}
                    href={href({ schedule: d.schedule.id })}
                    aria-current={d === shown ? "true" : undefined}
                    style={segItem(d === shown)}
                  >
                    {d.schedule.name}
                  </Link>
                ))}
              </div>
            )}
            <span style={{ flex: 1 }} />
            <div style={SEG} data-testid="grid-view">
              <Link
                href={href({ view: undefined })}
                aria-current={view === "week" ? "true" : undefined}
                style={segItem(view === "week")}
              >
                {t("ocv2.now.week")}
              </Link>
              <Link
                href={href({ view: "month" })}
                aria-current={view === "month" ? "true" : undefined}
                data-testid="grid-view-month"
                style={segItem(view === "month")}
              >
                {t("ocv2.now.month")}
              </Link>
            </div>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {t("oc2.now.zone", { zone: tz })}
            </span>
          </div>

          {shown.rotations.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("oc2.now.gridEmpty")}</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `130px repeat(${days.length}, minmax(0, 1fr))`,
                gap: view === "month" ? 4 : 5,
              }}
            >
              {view === "month" && (
                <>
                  <span />
                  {days.map((d, i) =>
                    i % 2 === 0 ? (
                      <div
                        key={`m-${dayKey(d)}`}
                        style={{
                          gridColumn: "span 2",
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: ".06em",
                          textTransform: "uppercase",
                          color:
                            i === 0 || days[i - 2]?.[1] !== d[1] ? "var(--ink-3)" : "transparent",
                          paddingLeft: 2,
                        }}
                      >
                        {monthHead(d, tag)}
                      </div>
                    ) : null,
                  )}
                </>
              )}
              <span />
              {days.map((d) => {
                const isToday = dayKey(d) === todayKey;
                return (
                  <div
                    key={`h-${dayKey(d)}`}
                    style={{
                      textAlign: "center",
                      fontSize: 11.5,
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? "var(--brand)" : "var(--ink-3)",
                      background: isToday ? "var(--brand-t)" : "transparent",
                      borderRadius: 7,
                      padding: "3px 0",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                    }}
                  >
                    {isToday && view === "week"
                      ? t("oc2.now.today", { day: dayHead(d, tag) })
                      : dayHead(d, tag)}
                  </div>
                );
              })}
              {shown.rotations.map((rot) => {
                const shifts = shown.shifts[rot.id] ?? [];
                const peopleOpen = q.people === rot.id;
                return (
                  <Fragment key={rot.id}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        minWidth: 0,
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{rot.name}</span>
                      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                        {hoursOf(rot) ?? t("oc2.now.hours247")}
                      </span>
                      <Link
                        href={href({ people: peopleOpen ? undefined : rot.id })}
                        data-testid="rotation-people-toggle"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--brand)",
                          textDecoration: "none",
                          marginTop: 2,
                          width: "fit-content",
                        }}
                      >
                        {t("ocv2.now.people", { count: rot.memberIds.length })}
                      </Link>
                    </div>
                    {days.map((d) => {
                      const slot = slotOf(shown.schedule, rot, d);
                      const key = `${rot.id}:${dayKey(d)}`;
                      const on = q.cell === key;
                      if (!slot)
                        return (
                          <div
                            key={key}
                            data-testid="shift-cell-off"
                            style={{
                              minHeight: view === "month" ? 40 : 46,
                              borderRadius: 9,
                              border: "1px dashed var(--line-2)",
                            }}
                          />
                        );
                      const cell = cellOf(shifts, shown.overrides, rot.id, slot);
                      const s = cell.shift;
                      const label = s ? (s.memberId ? nameOf(s.memberId) : null) : null;
                      const tone = label
                        ? avatarTone(label)
                        : { bg: "var(--sunk)", ink: "var(--ink-3)" };
                      const ov = cell.overrides.length > 0;
                      const style: React.CSSProperties = {
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 2,
                        minHeight: view === "month" ? 40 : 46,
                        minWidth: 0,
                        borderRadius: 9,
                        background: s ? tone.bg : "transparent",
                        border: ov
                          ? `1.5px dashed ${tone.ink}`
                          : s
                            ? "1px solid transparent"
                            : "1px dashed var(--line)",
                        boxShadow: on ? "0 0 0 2px var(--brand)" : "none",
                        textDecoration: "none",
                        color: "inherit",
                        overflow: "hidden",
                      };
                      const content = (
                        <>
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: tone.ink,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: "100%",
                              padding: "0 3px",
                            }}
                          >
                            {s ? (label ? firstName(label) : t("oc2.now.nobody")) : ""}
                          </span>
                          {ov && (
                            <span
                              style={{
                                fontSize: 8.5,
                                fontWeight: 700,
                                letterSpacing: ".06em",
                                color: tone.ink,
                                opacity: 0.8,
                                textTransform: "uppercase",
                              }}
                            >
                              {t("oc2.now.overrideTag")}
                            </span>
                          )}
                        </>
                      );
                      return acts ? (
                        <Link
                          key={key}
                          href={href({ cell: on ? undefined : key, people: q.people })}
                          data-testid="shift-cell"
                          aria-current={on ? "true" : undefined}
                          data-day={dayKey(d)}
                          data-rotation={rot.id}
                          data-override={ov ? "1" : undefined}
                          scroll={false}
                          className="oi-cell"
                          style={{ ...style, cursor: "pointer" }}
                        >
                          {content}
                        </Link>
                      ) : (
                        <div key={key} data-testid="shift-cell" style={style}>
                          {content}
                        </div>
                      );
                    })}
                    {peopleOpen && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <RotationPeople
                          schedule={shown.schedule}
                          rotation={rot}
                          people={data.people}
                          now={now}
                          manages={manages}
                          returnTo={href({ people: rot.id })}
                        />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}

          {selected &&
            acts &&
            (() => {
              const rot = shown.rotations.find((r) => r.id === selected.rotationId);
              const d = days.find((x) => dayKey(x) === selected.day);
              if (!rot || !d) return null;
              const slot = slotOf(shown.schedule, rot, d);
              if (!slot) return null;
              const cell = cellOf(shown.shifts[rot.id] ?? [], shown.overrides, rot.id, slot);
              const holder = cell.shift?.memberId ?? null;
              // A slot under way is handed over from now on: the hours already
              // worked keep the person who worked them.
              const start = new Date(
                Math.max(slot.from.getTime(), Math.floor(now.getTime() / 60_000) * 60_000),
              );
              return (
                <ShiftPicker
                  scheduleId={shown.schedule.id}
                  rotationId={rot.id}
                  startAt={start.toISOString()}
                  endAt={slot.to.toISOString()}
                  overrides={cell.overrides.map((o) => ({
                    id: o.id,
                    partial:
                      o.startAt.getTime() > slot.from.getTime() ||
                      o.endAt.getTime() < slot.to.getTime(),
                    from: t.fmt.time(o.startAt, shown.schedule.timezone),
                    to: t.fmt.time(o.endAt, shown.schedule.timezone),
                  }))}
                  candidates={data.people
                    .filter((m) => m.id !== holder)
                    .map((m) => ({ id: m.id, name: m.name }))}
                  label={`${dayHead(d, tag)}${t("oc2.sep")}${rot.name}`}
                  closeHref={href({ people: q.people })}
                  returnTo={href({ people: q.people })}
                  ended={slot.to.getTime() <= now.getTime()}
                />
              );
            })()}
        </div>
      )}
    </div>
  );
}
