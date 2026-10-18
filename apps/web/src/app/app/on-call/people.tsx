import {
  nextTurnStarts,
  rotationQueue,
  type RotationLike,
  type ScheduleLike,
} from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { avatarTone, initials } from "@/lib/avatar";
import { updateRotationMembers } from "./actions";
import { nextWhen } from "./grid";

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
  padding: 0,
};

/**
 * "☰ People" — a rotation's people in the order they take the pager: 1 is
 * the turn under way, then +1 at the next handover, +2 after it…
 *
 * Every change (↑ ↓, ✕, + Add) is written as a new order that starts at the
 * next handover: the person on call finishes their shift, the shifts already
 * worked keep their person, and the band says from when the new order runs.
 */
export async function RotationPeople({
  schedule,
  rotation,
  people,
  now,
  manages,
  returnTo,
}: {
  schedule: ScheduleLike & { status?: string };
  rotation: RotationLike;
  people: Array<{ id: string; name: string }>;
  now: Date;
  manages: boolean;
  returnTo: string;
}) {
  const t = await getT();
  const tag = t.locale.tag;
  const zone = schedule.timezone;
  const q = rotationQueue(schedule, rotation, now);
  const starts = nextTurnStarts(schedule, rotation, now, q.upcoming.length);
  const nameOf = (id: string) => people.find((m) => m.id === id)?.name ?? "—";
  const inCycle = new Set([...q.upcoming, ...(q.current ? [q.current] : [])]);
  const free = people.filter((m) => !inCycle.has(m.id));
  const handover = nextWhen(q.handoverAt, now, tag, zone);

  const op = (
    kind: "up" | "down" | "remove" | "add",
    memberId: string,
    body: React.ReactNode,
    aria: string,
  ) => (
    <form action={updateRotationMembers}>
      <input type="hidden" name="rotationId" value={rotation.id} />
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="op" value={kind} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        aria-label={aria}
        title={aria}
        data-testid={`people-${kind}`}
        className="oi-hover"
        style={ICON}
      >
        {body}
      </button>
    </form>
  );

  const row = (
    id: string,
    badge: string,
    meta: string,
    actions: React.ReactNode,
    muted = false,
  ) => {
    const label = nameOf(id);
    const tone = avatarTone(label);
    return (
      <div
        key={`${badge}-${id}`}
        data-testid="people-row"
        data-member={id}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          opacity: muted ? 0.6 : 1,
        }}
      >
        <span
          style={{
            width: 26,
            height: 22,
            borderRadius: 7,
            background: badge === "1" ? "var(--brand-t)" : "var(--panel)",
            color: badge === "1" ? "var(--brand)" : "var(--ink-2)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            fontWeight: 700,
            flex: "none",
          }}
        >
          {badge}
        </span>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: tone.bg,
            color: tone.ink,
            display: "grid",
            placeItems: "center",
            fontSize: 8.5,
            fontWeight: 700,
            flex: "none",
          }}
        >
          {initials(label)}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{meta}</span>
        <span style={{ flex: 1 }} />
        {manages && <div style={{ display: "flex", gap: 4 }}>{actions}</div>}
      </div>
    );
  };

  return (
    <div
      data-testid="rotation-people"
      style={{
        background: "var(--sunk)",
        borderRadius: 12,
        padding: "11px 13px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        animation: "oi-rise .15s ease backwards",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
          {t("ocv2.people.title", { name: rotation.name })}
        </span>
        <span style={{ flex: 1 }} />
        <span
          data-testid="people-applies"
          style={{
            fontSize: 11.5,
            color: q.pending ? "var(--brand)" : "var(--ink-3)",
            fontWeight: q.pending ? 600 : 400,
          }}
        >
          {q.pending
            ? t("ocv2.people.pending", { when: handover })
            : t("ocv2.people.applies", { when: handover })}
        </span>
      </div>

      {q.current === null && q.upcoming.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("oc2.sched.noMembers")}</div>
      )}

      {q.current !== null &&
        row(
          q.current,
          "1",
          q.currentStays
            ? t("ocv2.people.current", { when: handover })
            : t("ocv2.people.leaves", { when: handover }),
          q.currentStays
            ? op("remove", q.current, "✕", t("oc2.sched.removePerson"))
            : op("add", q.current, "↺", t("ocv2.people.keep")),
          !q.currentStays,
        )}

      {q.upcoming.map((id, i) =>
        row(
          id,
          q.current === null ? String(i + 1) : `+${i + 1}`,
          starts[i] ? t("ocv2.people.from", { when: nextWhen(starts[i]!, now, tag, zone) }) : "",
          <>
            {i > 0 ? op("up", id, "↑", t("oc2.sched.moveUp")) : <span style={{ width: 22 }} />}
            {i < q.upcoming.length - 1 ? (
              op("down", id, "↓", t("oc2.sched.moveDown"))
            ) : (
              <span style={{ width: 22 }} />
            )}
            {op("remove", id, "✕", t("oc2.sched.removePerson"))}
          </>,
        ),
      )}

      {manages && free.length > 0 && (
        <div
          style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingTop: 2 }}
        >
          {free.map((m) => {
            const tone = avatarTone(m.name);
            return (
              <form key={m.id} action={updateRotationMembers}>
                <input type="hidden" name="rotationId" value={rotation.id} />
                <input type="hidden" name="memberId" value={m.id} />
                <input type="hidden" name="op" value="add" />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button
                  type="submit"
                  data-testid="people-add"
                  aria-label={t("ocv2.people.addAria", { name: m.name })}
                  className="oi-hover-chip"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    borderRadius: 999,
                    padding: "3px 10px 3px 4px",
                    cursor: "pointer",
                    color: "var(--ink)",
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
                      fontSize: 8,
                      fontWeight: 700,
                    }}
                  >
                    {initials(m.name)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    {t("ocv2.people.add", { name: m.name.split(" ")[0] ?? m.name })}
                  </span>
                </button>
              </form>
            );
          })}
        </div>
      )}
    </div>
  );
}
