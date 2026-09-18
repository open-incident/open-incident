import type { incidentEvents } from "@openincident/db";
import { getT } from "@/i18n/server";
import { renderEvent } from "@/lib/timeline";
import { LiveTimeline } from "./live-timeline";
import { TimelineFilterClient } from "./timeline-filter";
import { addNote, togglePin } from "./actions";

/**
 * The timeline card of the V2 design: a 44 px mono minute column, an 8 px dot
 * on a hairline rail, the line itself, and the note field at the bottom. The
 * filters count what they filter; the live dot is the real SSE stream.
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
  // The minute column reads "02:47" on the incident's day and "27/08" past it.
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: t.timeZone });
  const declaredDay = day(declaredAt);

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
        minWidth: 0,
        flex: "10 1 420px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("inc2.dtab.timeline")}</span>
        <LiveTimeline incidentId={incidentId} lastEventId={lastId} label={t("inc2.tl.live")} />
        <span style={{ flex: 1 }} />
        <TimelineFilterClient
          labels={{
            all: t("incident.filter.all"),
            updates: t("incident.filter.updates"),
            pinned: t("incident.filter.pinned"),
          }}
          counts={{
            all: items.length,
            updates: items.filter((i) => i.isUpdate).length,
            pinned: items.filter((i) => i.pinned).length,
          }}
        />
      </div>
      <div style={{ padding: "6px 16px 12px" }}>
        <ol
          data-testid="timeline"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {items.map((it) => {
            const key = it.isUpdate || it.pinned || it.card;
            return (
              <li
                key={it.id}
                data-testid="timeline-event"
                data-kind={it.isUpdate ? "update" : it.pinned ? "pinned" : "event"}
                style={{
                  display: "grid",
                  gridTemplateColumns: "44px 16px minmax(0,1fr)",
                  gap: 8,
                  padding: "8px 0",
                  borderRadius: 8,
                  background: it.pinned ? "var(--note)" : "transparent",
                }}
              >
                <span
                  title={t.fmt.dateLong(it.at)}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--ink-3)",
                    textAlign: "right",
                    paddingTop: 2,
                  }}
                >
                  {day(it.at) === declaredDay
                    ? t.fmt.time(it.at, t.timeZone)
                    : t.fmt.dayMonth(it.at, t.timeZone)}
                </span>
                <span
                  aria-hidden
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    paddingTop: 4,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: it.dot }} />
                  <span style={{ width: 1.5, flex: 1, background: "var(--line-2)" }} />
                </span>
                <span style={{ minWidth: 0, paddingRight: 8 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: key ? 600 : 500 }}>
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
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 5,
                          padding: "1px 6px",
                          background: it.tag.bg,
                          color: it.tag.ink,
                        }}
                      >
                        {it.tag.label}
                      </span>
                    )}
                    {it.pinned && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--note-ink)" }}>
                        {t("incident.pinned")}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
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
                    <span
                      style={{
                        display: "block",
                        fontSize: 12.5,
                        color: "var(--ink-2)",
                        lineHeight: 1.5,
                        marginTop: 1,
                      }}
                    >
                      {it.description}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {items.length === 0 && (
          <div style={{ padding: "14px 0", fontSize: 13, color: "var(--ink-3)" }}>
            {t("inc2.tl.empty")}
          </div>
        )}
        {canAct && (
          <form
            action={addNote}
            data-testid="timeline-note"
            style={{ display: "flex", gap: 8, marginTop: 8, paddingLeft: 68 }}
          >
            <input type="hidden" name="number" value={number} />
            <input
              name="message"
              required
              maxLength={2000}
              placeholder={t("inc2.tl.notePlaceholder")}
              className="oi-field"
              style={{
                flex: 1,
                height: 34,
                border: "1px solid var(--line)",
                borderRadius: 9,
                padding: "0 11px",
                fontSize: 13,
                outline: "none",
                background: "var(--panel)",
              }}
            />
            <button
              type="submit"
              className="oi-hover-brand-2"
              style={{
                height: 34,
                padding: "0 13px",
                borderRadius: 9,
                border: 0,
                background: "var(--brand)",
                color: "var(--on-brand)",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("inc2.tl.notePost")}
            </button>
          </form>
        )}
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
          width: 20,
          height: 20,
          borderRadius: 6,
          border: 0,
          background: "transparent",
          color: pinned ? "var(--note-ink)" : "var(--ink-3)",
          cursor: "pointer",
          fontSize: 11,
          padding: 0,
          lineHeight: 1,
        }}
      >
        ★
      </button>
    </form>
  );
}
