import type { incidentEvents } from "@openincident/db";
import { getT } from "@/i18n/server";
import { renderEvent } from "@/lib/timeline";
import { LiveTimeline } from "./live-timeline";
import { togglePin } from "./actions";

/**
 * The timeline: a 44 px mono minute column, a 9 px dot on a 1 px rail, then
 * either a plain line (title + description) or a card (updates, notes,
 * attached alerts, links) with its tag. Events stream in through SSE — the
 * live badge is the real thing.
 */
export async function Timeline({
  incidentId,
  number,
  events,
  canAct,
  declaredAt,
}: {
  incidentId: string;
  number: number;
  events: Array<typeof incidentEvents.$inferSelect>;
  canAct: boolean;
  declaredAt: Date;
}) {
  const t = await getT();
  const items = events.map((ev) => renderEvent(ev, t));
  const lastId = events[events.length - 1]?.id ?? "";
  // The minute column reads "14:02" on the incident's day and "27/08" past it —
  // the design's idiom for an event that happened on a later day.
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: t.timeZone });
  const declaredDay = day(declaredAt);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="oi-eyebrow">{t("incident.tab.timeline")}</span>
        <LiveTimeline incidentId={incidentId} lastEventId={lastId} label={t("incident.live")} />
        <span style={{ flex: 1 }} />
        <TimelineFilter
          number={number}
          labels={{
            all: t("incident.filter.all"),
            updates: t("incident.filter.updates"),
            pinned: t("incident.filter.pinned"),
          }}
        />
      </div>
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
        }}
        data-testid="timeline"
      >
        {items.map((it) => {
          const pad = it.card ? 13 : 2;
          return (
            <li
              key={it.id}
              data-testid="timeline-event"
              data-kind={it.isUpdate ? "update" : it.pinned ? "pinned" : "event"}
              style={{ display: "flex", gap: 12 }}
            >
              <span
                style={{
                  width: 44,
                  flex: "none",
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                  paddingTop: pad,
                }}
                title={t.fmt.dateLong(it.at)}
              >
                {day(it.at) === declaredDay
                  ? t.fmt.time(it.at, t.timeZone)
                  : t.fmt.dayMonth(it.at, t.timeZone)}
              </span>
              <span
                aria-hidden
                style={{
                  flex: "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  width: 12,
                  paddingTop: pad,
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: it.dot }} />
                <span style={{ flex: 1, width: 1, background: "var(--line)" }} />
              </span>
              {it.card ? (
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: `1px solid ${it.border ?? "var(--line)"}`,
                    background: it.bg ?? "var(--panel)",
                    borderRadius: 13,
                    padding: "12px 15px",
                    marginBottom: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                    boxShadow: "var(--shadow-card)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {it.href ? (
                        <a href={it.href} target="_blank" rel="noreferrer" className="oi-link">
                          {it.title}
                        </a>
                      ) : (
                        it.title
                      )}
                    </span>
                    {it.tag && (
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: it.tag.bg,
                          color: it.tag.ink,
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                        }}
                      >
                        {it.tag.label}
                      </span>
                    )}
                    {it.pinned && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--note-ink)" }}>
                        ★ {t("incident.pinned")}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      {t.fmt.dateCompact(it.at)}
                    </span>
                    {canAct && (
                      <PinButton
                        id={it.id}
                        number={number}
                        pinned={it.pinned}
                        label={it.pinned ? t("incident.unpin") : t("incident.pin")}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 13.5,
                      color: "var(--ink-2)",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {it.description}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "0 2px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {it.href ? (
                        <a href={it.href} target="_blank" rel="noreferrer" className="oi-link">
                          {it.title}
                        </a>
                      ) : (
                        it.title
                      )}
                    </span>
                    {it.pinned && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--note-ink)" }}>
                        ★ {t("incident.pinned")}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      {t.fmt.dateCompact(it.at)}
                    </span>
                    {canAct && (
                      <PinButton
                        id={it.id}
                        number={number}
                        pinned={it.pinned}
                        label={it.pinned ? t("incident.unpin") : t("incident.pin")}
                      />
                    )}
                  </span>
                  {it.description && (
                    <span style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
                      {it.description}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 0 0 68px",
          color: "var(--ink-3)",
          fontSize: 12.5,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ok)" }} />
        {t("incident.listening")}
      </div>
    </div>
  );
}

function PinButton({
  id,
  number,
  pinned,
  label,
}: {
  id: string;
  number: number;
  pinned: boolean;
  label: string;
}) {
  return (
    <form action={togglePin} style={{ display: "contents" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="number" value={number} />
      <button
        type="submit"
        aria-pressed={pinned}
        title={label}
        aria-label={label}
        className="oi-hover"
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          border: 0,
          background: "transparent",
          color: pinned ? "var(--note-ink)" : "var(--ink-3)",
          cursor: "pointer",
          fontSize: 12,
          padding: 0,
        }}
      >
        ★
      </button>
    </form>
  );
}

/** The three-way filter — a segmented control the client component drives. */
function TimelineFilter({
  labels,
}: {
  number: number;
  labels: { all: string; updates: string; pinned: string };
}) {
  return <TimelineFilterClient labels={labels} />;
}

import { TimelineFilterClient } from "./timeline-filter";
