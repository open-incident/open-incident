import { Fragment } from "react";
import Link from "next/link";
import { withTenant } from "@openincident/db";
import { addDays, localParts, zonedTime, type Shift } from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
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

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: [number, number, number]) => `${d[0]}-${pad(d[1])}-${pad(d[2])}`;

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

/**
 * On-call · Now — who carries each pager at this second, what the escalation
 * policy would do with it, and the seven days ahead as one grid where a click
 * hands over a single shift.
 *
 * Everything here is read from the published schedules: a draft covers nobody
 * and is not drawn, and a schedule whose rotations are all outside their hours
 * says so rather than showing a name that would not be woken.
 */
export async function NowTab({ q }: { q: Record<string, string | undefined> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const now = new Date();
  const tz = t.timeZone;
  const acts = canRespond(member);
  const today = localParts(now, tz);
  const dayTriples = Array.from({ length: 7 }, (_, i) =>
    addDays(today.year, today.month, today.day, i),
  );
  const dayStarts = dayTriples.map((d) => zonedTime(d[0], d[1], d[2], "00:00", tz));
  const windowFrom = dayStarts[0]!;
  const after = addDays(today.year, today.month, today.day, 7);
  const windowTo = zonedTime(after[0], after[1], after[2], "00:00", tz);

  const data = await withTenant(tenant.id, async (tx) => {
    const all = await listSchedules(tx, tenant.id);
    const details: ScheduleDetail[] = [];
    for (const s of all.filter((x) => x.status === "published")) {
      const one = await getSchedule(tx, tenant.id, s.id, { from: windowFrom, to: windowTo }, now);
      if (one) details.push(one);
    }
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

  /** The shift of a rotation covering an instant, and the one covering a day the most. */
  const at = (shifts: Shift[], when: Date) =>
    shifts.find(
      (s) => s.startAt.getTime() <= when.getTime() && s.endAt.getTime() > when.getTime(),
    ) ?? null;
  const onDay = (shifts: Shift[], from: Date, to: Date) => {
    let best: Shift | null = null;
    let widest = 0;
    for (const s of shifts) {
      const overlap =
        Math.min(s.endAt.getTime(), to.getTime()) - Math.max(s.startAt.getTime(), from.getTime());
      if (overlap > widest) {
        widest = overlap;
        best = s;
      }
    }
    return best;
  };

  type Card = { detail: ScheduleDetail; slot: ScheduleDetail["current"][number] | null };
  const cards: Card[] = [];
  for (const detail of data.details) {
    if (detail.current.length) for (const slot of detail.current) cards.push({ detail, slot });
    else cards.push({ detail, slot: null });
  }
  const rows = data.details.flatMap((detail) => detail.rotations.map((rot) => ({ detail, rot })));
  const offers = data.details.flatMap((detail) =>
    detail.openCovers
      .filter((c) => c.requesterMemberId !== member.id)
      .map((c) => ({ detail, cover: c })),
  );
  const many = data.details.length > 1;
  const selected = q.cell
    ? { rotationId: q.cell.split(":")[0]!, dayKey: q.cell.split(":")[1]! }
    : null;

  return (
    <div
      className="oi-rise-fast"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      data-testid="oncall-now-tab"
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
          {cards.map(({ detail, slot }) => {
            const shifts = slot ? (detail.shifts[slot.rotationId] ?? []) : [];
            const current = slot ? at(shifts, now) : null;
            const nextShift = slot
              ? (shifts
                  .filter(
                    (s) =>
                      s.startAt.getTime() >= (current?.endAt.getTime() ?? now.getTime()) &&
                      s.memberId !== slot.memberId,
                  )
                  .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0] ?? null)
              : (Object.values(detail.shifts)
                  .flat()
                  .filter((s) => s.memberId && s.startAt.getTime() > now.getTime())
                  .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0] ?? null);
            const who = slot ? nameOf(slot.memberId) : t("oc2.now.uncovered");
            const tone = slot?.memberId
              ? avatarTone(who)
              : { bg: "var(--sunk)", ink: "var(--ink-3)" };
            const policy = policyForSchedule(data.paths, detail.schedule.id);
            const rotation = slot ? detail.rotations.find((r) => r.id === slot.rotationId) : null;
            const isMine = slot?.memberId === member.id;
            return (
              <div
                key={`${detail.schedule.id}:${slot?.rotationId ?? "none"}`}
                style={CARD}
                data-testid="oncall-now"
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{detail.schedule.name}</span>
                  {slot && (
                    <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                      {slot.rotationName}
                    </span>
                  )}
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
                    {slot?.memberId ? initials(who) : "—"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{who}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                      {slot
                        ? t("oc2.now.window", {
                            from: current
                              ? t.fmt.time(current.startAt, detail.schedule.timezone)
                              : t.fmt.time(now, detail.schedule.timezone),
                            to: t.fmt.time(slot.until, detail.schedule.timezone),
                            zone: detail.schedule.timezone,
                          })
                        : t("oc2.now.uncoveredNote")}
                    </div>
                  </div>
                  {slot?.memberId && acts && (
                    <form action={pageOnCall}>
                      <input type="hidden" name="memberId" value={slot.memberId} />
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
                          display: "flex",
                          alignItems: "center",
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {t("oc2.now.page", { name: who.split(" ")[0] ?? who })}
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
                  <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                    {nextShift
                      ? t("oc2.now.nextWho", {
                          name: nameOf(nextShift.memberId),
                          when: t.fmt.dateTime(nextShift.startAt, detail.schedule.timezone),
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
          style={{ ...BANNER, background: "var(--ok-t)", border: "1px solid var(--ok)" }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ok)" }} />
          {t("oc2.now.paged", { name: q.paged })}
        </div>
      )}
      {q.pageError && (
        <div
          role="alert"
          style={{ ...BANNER, background: "var(--dang-t)", border: "1px solid var(--dang)" }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--dang)" }} />
          {t("oc2.now.pageUnavailable")}
        </div>
      )}
      {q.coverSent && (
        <div
          role="status"
          style={{ ...BANNER, background: "var(--ok-t)", border: "1px solid var(--ok)" }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ok)" }} />
          {t("oc2.now.coverSent", { count: Number(q.coverSent) || 0 })}
        </div>
      )}
      {q.covered === "1" && (
        <div
          role="status"
          style={{ ...BANNER, background: "var(--ok-t)", border: "1px solid var(--ok)" }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ok)" }} />
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

      <div
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
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("oc2.now.days")}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
            {t("oc2.now.zone", { zone: tz })}
          </span>
        </div>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("oc2.now.gridEmpty")}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "130px repeat(7, 1fr)", gap: 5 }}>
            <span />
            {dayStarts.map((d, i) => (
              <div
                key={d.getTime()}
                style={{
                  textAlign: "center",
                  fontSize: 11.5,
                  fontWeight: i === 0 ? 700 : 500,
                  color: i === 0 ? "var(--brand)" : "var(--ink-3)",
                  background: i === 0 ? "var(--brand-t)" : "transparent",
                  borderRadius: 7,
                  padding: "3px 0",
                }}
              >
                {i === 0 ? t("oc2.now.today", { day: t.fmt.dateCompact(d) }) : t.fmt.dateCompact(d)}
              </div>
            ))}
            {rows.map(({ detail, rot }) => {
              const shifts = detail.shifts[rot.id] ?? [];
              const hours = rot.activeStart
                ? t("oc2.now.hoursRange", { from: rot.activeStart, to: rot.activeEnd ?? "" })
                : t("oc2.now.hours247");
              return (
                <Fragment key={rot.id}>
                  <div
                    style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{rot.name}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      {many ? `${detail.schedule.name}${t("oc2.sep")}${hours}` : hours}
                    </span>
                  </div>
                  {dayTriples.map((triple, i) => {
                    const from = dayStarts[i]!;
                    const to = dayStarts[i + 1] ?? windowTo;
                    const shift = onDay(shifts, from, to);
                    const label = shift ? nameOf(shift.memberId) : null;
                    const tone =
                      shift && shift.memberId
                        ? avatarTone(label!)
                        : { bg: "var(--sunk)", ink: "var(--ink-3)" };
                    const key = `${rot.id}:${keyOf(triple)}`;
                    const on = q.cell === key;
                    const cell = (
                      <>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: tone.ink }}>
                          {shift
                            ? shift.memberId
                              ? (label!.split(" ")[0] ?? label)
                              : t("oc2.now.nobody")
                            : ""}
                        </span>
                        {shift?.override && (
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
                    const style: React.CSSProperties = {
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2,
                      minHeight: 46,
                      borderRadius: 9,
                      background: shift ? tone.bg : "transparent",
                      border: shift?.override
                        ? `1.5px dashed ${tone.ink}`
                        : shift
                          ? "1px solid transparent"
                          : "1px dashed var(--line-2)",
                      boxShadow: on ? "0 0 0 2px var(--brand)" : "none",
                      textDecoration: "none",
                      color: "inherit",
                    };
                    return acts ? (
                      <Link
                        key={key}
                        href={on ? "/app/on-call?tab=now" : `/app/on-call?tab=now&cell=${key}`}
                        data-testid="shift-cell"
                        className="oi-hover-edge"
                        style={{ ...style, cursor: "pointer" }}
                      >
                        {cell}
                      </Link>
                    ) : (
                      <div key={key} data-testid="shift-cell" style={style}>
                        {cell}
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        )}
        {selected &&
          acts &&
          (() => {
            const hit = rows.find(({ rot }) => rot.id === selected.rotationId);
            if (!hit) return null;
            const index = dayTriples.findIndex((d) => keyOf(d) === selected.dayKey);
            if (index < 0) return null;
            const from = dayStarts[index]!;
            const to = dayStarts[index + 1] ?? windowTo;
            const shift = onDay(hit.detail.shifts[hit.rot.id] ?? [], from, to);
            const pool = hit.rot.memberIds.length
              ? data.people.filter((m) => hit.rot.memberIds.includes(m.id))
              : data.people;
            // No shift to hand over: the override covers the rotation's own
            // window on that day, read in the SCHEDULE's zone — the hours the
            // rotation is written in, not the reader's.
            const zone = hit.detail.schedule.timezone;
            const day = dayTriples[index]!;
            const fallbackStart = zonedTime(
              day[0],
              day[1],
              day[2],
              hit.rot.activeStart ?? "00:00",
              zone,
            );
            const afterDay = addDays(day[0], day[1], day[2], 1);
            let fallbackEnd = zonedTime(day[0], day[1], day[2], hit.rot.activeEnd ?? "00:00", zone);
            if (fallbackEnd.getTime() <= fallbackStart.getTime())
              fallbackEnd = zonedTime(
                afterDay[0],
                afterDay[1],
                afterDay[2],
                hit.rot.activeEnd ?? "00:00",
                zone,
              );
            return (
              <ShiftPicker
                scheduleId={hit.detail.schedule.id}
                rotationId={hit.rot.id}
                startAt={(shift?.startAt ?? fallbackStart).toISOString()}
                endAt={(shift?.endAt ?? fallbackEnd).toISOString()}
                overrideId={shift?.override ? (shift.overrideId ?? null) : null}
                candidates={pool
                  .filter((m) => m.id !== shift?.memberId)
                  .map((m) => ({ id: m.id, name: m.name }))}
                label={`${t.fmt.dateCompact(from)}${t("oc2.sep")}${hit.rot.name}`}
              />
            );
          })()}
      </div>
    </div>
  );
}
