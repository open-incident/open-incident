import { notFound } from "next/navigation";
import { currentSnapshot } from "@/lib/snapshot";
import { fmtDate, relative, tr } from "@/lib/i18n";
import { ComponentsList, type Row } from "./components-list";
import { HistoryList, type HistoryItem, type HistoryMonth } from "./history-list";
import { SubscribePanel } from "./subscribe-panel";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const LANGS = ["en", "fr", "de"] as const;
type Lang = (typeof LANGS)[number];

/** The overall banner: a colour, an ink, and the sentence under the title. */
const OVERALL: Record<string, { bg: string; bd: string; dot: string; ink: string }> = {
  operational: { bg: "#EAF6EF", bd: "rgba(46,158,107,.3)", dot: "#2E9E6B", ink: "#14603F" },
  degraded: { bg: "#FDF6E9", bd: "rgba(180,83,9,.3)", dot: "#E0A030", ink: "#8A5A0B" },
  partial_outage: { bg: "#FDF1EE", bd: "rgba(217,83,79,.3)", dot: "#D9534F", ink: "#9B2C28" },
  major_outage: { bg: "#FBEAE8", bd: "rgba(217,83,79,.45)", dot: "#D9534F", ink: "#8E211D" },
  maintenance: { bg: "#F3EEFB", bd: "rgba(109,59,200,.3)", dot: "#6D3BC8", ink: "#4A2490" },
};

/**
 * The public page.
 *
 * Everything here is read from one snapshot document, and everything drawn is
 * something the snapshot actually knows. Where the design shows a control this
 * product cannot honour — a webhook subscription, a full-history archive, a
 * post-mortem link on a page that does not publish post-mortems — the control
 * is absent rather than dead.
 */
export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<{
    lang?: string;
    subscribed?: string;
    error?: string;
    confirmed?: string;
    unsubscribed?: string;
  }>;
}) {
  const cur = await currentSnapshot();
  if (!cur) notFound();
  const { snap, origin } = cur;
  const q = await searchParams;

  // The page has a language; a reader may prefer another. `?lang=` only ever
  // changes what this render says, never what the page is configured with.
  const picked = LANGS.includes(q.lang as Lang) ? (q.lang as Lang) : null;
  const L: string = picked ?? snap.page.locale;
  const t = tr(L);
  const accent = snap.page.accentColor;
  const num = new Intl.NumberFormat(L === "fr" ? "fr-FR" : L === "de" ? "de-DE" : "en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const keep = (lang: string | null) => (lang ? `/?lang=${lang}` : "/");

  const stateLabel = (s: string) =>
    s === "operational"
      ? t("operational")
      : s === "degraded"
        ? t("stateDegraded")
        : s === "partial_outage"
          ? t("statePartial")
          : s === "major_outage"
            ? t("stateMajor")
            : s === "unknown"
              ? t("stateUnknown")
              : t("stateMaintenance");

  const overall = OVERALL[snap.overall] ?? OVERALL.operational!;
  const overallTitle = t(
    snap.overall === "operational"
      ? "allOk"
      : snap.overall === "degraded"
        ? "degraded"
        : snap.overall === "partial_outage"
          ? "partial"
          : snap.overall === "major_outage"
            ? "major"
            : "maintenance",
  );
  const overallBody = t(
    snap.overall === "operational"
      ? "allOkD"
      : snap.overall === "degraded"
        ? "degradedD"
        : snap.overall === "partial_outage"
          ? "partialD"
          : snap.overall === "major_outage"
            ? "majorD"
            : "maintenanceD",
  );

  // The bars carry no dates of their own: they are the days ending at the
  // snapshot's own clock, which is how they were rolled up in the first place.
  const generated = new Date(snap.generatedAt).getTime();
  const dayFormat: Record<string, string> = {};
  const rows: Row[] = snap.components.map((c) => {
    const bars = c.ticks.map((state, i) => {
      const day = new Date(generated - (c.ticks.length - 1 - i) * DAY).toISOString().slice(0, 10);
      if (!dayFormat[day]) dayFormat[day] = fmtDate(day, L, { day: "numeric", month: "short" });
      return { day, state };
    });
    return {
      id: c.id,
      name: c.name,
      description: c.description ?? c.groupName,
      state: c.state,
      stateLabel: stateLabel(c.state),
      uptime90: c.uptime90 === null ? "—" : `${num.format(c.uptime90)} %`,
      uptime30: c.uptime30 === null ? "—" : `${num.format(c.uptime30)} %`,
      response: c.responseMs === null ? t("noMeasure") : `${c.responseMs} ms`,
      responseMono: c.responseMs !== null,
      lastIncident:
        c.lastIncidentAt === null
          ? t("never")
          : fmtDate(c.lastIncidentAt, L, { day: "numeric", month: "long", year: "numeric" }),
      bars,
    };
  });

  const active = snap.incidents.filter((i) => i.status !== "resolved");
  const past = snap.incidents.filter((i) => i.status === "resolved");
  const upcoming = snap.maintenances.filter(
    (m) => m.status === "scheduled" || m.status === "in_progress",
  );
  // A cancelled maintenance never happened; a history of what happened has no
  // room for it. Only the completed ones join the past incidents.
  const doneMaint = snap.maintenances.filter((m) => m.status === "completed");

  const time = (iso: string) =>
    fmtDate(iso, L, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  /**
   * A bare time is a lie on an incident that started three days ago — but
   * repeating the date on twelve updates of the same morning is noise. The
   * date appears where the reader would otherwise guess: on the start, and on
   * an update that fell on another day than the start.
   */
  const day = (iso: string) =>
    fmtDate(iso, L, { year: "numeric", month: "2-digit", day: "2-digit" });
  const today = day(snap.generatedAt);
  const dated = (iso: string) =>
    `${fmtDate(iso, L, { day: "numeric", month: "long" })} ${time(iso)}`;
  const when = (iso: string) => (day(iso) === today ? time(iso) : dated(iso));
  const since = (iso: string, from: string) => (day(iso) === day(from) ? time(iso) : dated(iso));
  const impact = (k: string) => t(`impact_${k}` as "impact_degraded");
  const maintStatus = (s: string) =>
    s === "completed"
      ? t("maintDone")
      : s === "in_progress"
        ? t("maintProgress")
        : s === "cancelled"
          ? t("maintCancelled")
          : t("maintScheduled");

  // Past incidents and finished maintenances, newest first, grouped by month.
  const items: Array<{ at: string; item: HistoryItem }> = [
    ...past.map((i) => ({
      at: i.startedAt,
      item: {
        id: i.id,
        title: i.title,
        meta: `${fmtDate(i.startedAt, L, { day: "numeric", month: "long" })} · ${impact(i.impact)}`,
        statusLabel: t("resolved"),
        tone: "ok" as const,
        updates: i.updates.map((u) => ({
          status: u.status,
          label: t(u.status as "resolved"),
          at: since(u.at, i.startedAt),
          body: u.body,
          correctedAt: u.correctedAt ? t("corrected", { time: time(u.correctedAt) }) : null,
        })),
      },
    })),
    ...doneMaint.map((m) => ({
      at: m.startAt,
      item: {
        id: m.id,
        title: m.title,
        meta: `${t("maint")} · ${fmtDate(m.startAt, L, { day: "numeric", month: "long" })}`,
        statusLabel: maintStatus(m.status),
        tone: "ok" as const,
        updates: [
          ...(m.body
            ? [{ status: "monitoring", label: t("maint"), at: time(m.startAt), body: m.body }]
            : []),
          ...m.updates.map((u) => ({
            status: u.status,
            label: maintStatus(u.status),
            at: since(u.at, m.startAt),
            body: u.body,
          })),
        ],
      },
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const months: HistoryMonth[] = [];
  for (const { at, item } of items) {
    const label = fmtDate(at, L, { month: "long", year: "numeric" }).toUpperCase();
    const last = months[months.length - 1];
    if (last && last.label === label) last.items.push(item);
    else months.push({ label, items: [item] });
  }

  const notice = (() => {
    if (q.subscribed === "1") return { id: "subscribed", tone: "ok", text: t("checkMail") };
    if (q.subscribed === "already") return { id: "subscribed", tone: "mute", text: t("already") };
    if (q.error)
      return {
        id: "sub-error",
        tone: "bad",
        text: q.error === "invalid" ? t("invalid") : t("down"),
      };
    if (q.confirmed)
      return {
        id: "confirmed",
        tone: q.confirmed === "1" ? "ok" : "bad",
        text: q.confirmed === "1" ? t("confirmed", { name: snap.page.name }) : t("confirmFailed"),
      };
    if (q.unsubscribed)
      return {
        id: "unsubscribed",
        tone: "mute",
        text:
          q.unsubscribed === "1" ? t("unsubscribed", { name: snap.page.name }) : t("unsubFailed"),
      };
    return null;
  })();
  const NOTICE: Record<string, { bg: string; ink: string }> = {
    ok: { bg: "#E8F3EC", ink: "#0E5A3E" },
    bad: { bg: "#FBECEB", ink: "#9B2C28" },
    mute: { bg: "#F4F3EF", ink: "#5C5750" },
  };

  return (
    <div
      lang={L}
      style={{
        ["--st-accent" as string]: accent,
        minHeight: "100vh",
        position: "relative",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          backdropFilter: "blur(14px)",
          background: "rgba(250,250,247,.82)",
          borderBottom: "1px solid rgba(27,25,23,.08)",
        }}
      >
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            padding: "0 24px",
            minHeight: 60,
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            position: "relative",
          }}
        >
          {snap.page.logoUrl ? (
            <img
              src={snap.page.logoUrl}
              alt=""
              style={{ width: 30, height: 30, borderRadius: 9, objectFit: "contain" }}
            />
          ) : (
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: accent,
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
                fontSize: 14,
                letterSpacing: "-.02em",
              }}
            >
              {snap.page.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span
            style={{
              fontFamily: "var(--title)",
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "-.01em",
            }}
          >
            {snap.page.name}
          </span>
          <span style={{ flex: 1 }} />
          <div
            style={{
              display: "flex",
              gap: 2,
              background: "rgba(27,25,23,.05)",
              borderRadius: 9,
              padding: 2,
            }}
          >
            {LANGS.map((l) => {
              const on = L === l;
              return (
                <a
                  key={l}
                  href={keep(l)}
                  hrefLang={l}
                  style={{
                    height: 26,
                    padding: "0 10px",
                    borderRadius: 7,
                    background: on ? "#fff" : "transparent",
                    boxShadow: on ? "0 1px 2px rgba(27,25,23,.1)" : "none",
                    fontSize: 12,
                    fontWeight: 600,
                    color: on ? "#1B1917" : "#8A8378",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {l.toUpperCase()}
                </a>
              );
            })}
          </div>
          {snap.page.visibility !== "internal" && (
            <SubscribePanel
              accent={accent}
              origin={origin}
              lang={picked}
              labels={{
                getUpdates: t("getUpdates"),
                subTitle: t("subTitle"),
                subConfirm: t("subConfirm"),
                optinFull: t("optinFull"),
                copy: t("copy"),
                copied: t("copied"),
                channelEmail: t("channelEmail"),
                channelRss: t("channelRss"),
                channelAtom: t("channelAtom"),
              }}
            />
          )}
        </div>
      </header>

      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "44px 24px 80px",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {notice && (
          <div
            data-testid={notice.id}
            role={notice.tone === "bad" ? "alert" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              background: NOTICE[notice.tone]!.bg,
              color: NOTICE[notice.tone]!.ink,
              borderRadius: 13,
              padding: "12px 16px",
              fontSize: 13,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "currentColor",
                flex: "none",
              }}
            />
            {notice.text}
          </div>
        )}

        <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            data-testid="overall"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              background: overall.bg,
              border: `1px solid ${overall.bd}`,
              borderRadius: 20,
              padding: "22px 26px",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                position: "relative",
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: overall.dot,
                flex: "none",
              }}
            >
              {snap.overall !== "operational" && (
                <span
                  style={{
                    position: "absolute",
                    inset: -6,
                    borderRadius: "50%",
                    border: `2px solid ${overall.dot}`,
                    opacity: 0.35,
                    animation: "st-pulse 2s ease-out infinite",
                  }}
                />
              )}
            </span>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div
                style={{
                  fontFamily: "var(--title)",
                  fontSize: 24,
                  fontWeight: 600,
                  letterSpacing: "-.02em",
                  lineHeight: 1.15,
                  color: overall.ink,
                }}
              >
                {overallTitle}
              </div>
              <div style={{ fontSize: 13.5, color: "#5C5750", marginTop: 4 }}>{overallBody}</div>
            </div>
            <div style={{ fontSize: 12, color: "#8A8378", textAlign: "right", lineHeight: 1.5 }}>
              {t("updatedAt")}{" "}
              <strong style={{ color: "#1B1917" }}>{relative(snap.generatedAt, L)}</strong>
              <br />
              {t("refreshes")}
            </div>
          </div>

          {active.map((i) => {
            const tone =
              i.impact === "major_outage"
                ? { ink: "#9B2C28", bg: "#FBECEB", line: "#D9534F" }
                : { ink: "#B45309", bg: "#FDF2E3", line: "#B45309" };
            return (
              <article
                key={i.id}
                id={`incident-${i.id}`}
                data-testid="active-incident"
                style={{
                  background: "#fff",
                  border: `1px solid ${tone.line}59`,
                  borderLeft: `4px solid ${tone.line}`,
                  borderRadius: 16,
                  padding: "18px 22px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  boxShadow: "0 12px 30px -24px rgba(27,25,23,.4)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: ".06em",
                      color: tone.ink,
                      background: tone.bg,
                      borderRadius: 999,
                      padding: "3px 10px",
                    }}
                  >
                    {t(i.status as "resolved")}
                  </span>
                  <span style={{ fontSize: 12.5, color: "#8A8378" }}>
                    {i.components.length > 0 && (
                      <>
                        {t("affects")}{" "}
                        <strong style={{ color: "#1B1917" }}>{i.components.join(", ")}</strong>{" "}
                        ·{" "}
                      </>
                    )}
                    {t("since")} {when(i.startedAt)}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "var(--title)",
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: "-.015em",
                  }}
                >
                  {i.title}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    borderLeft: "2px solid #EFEDE7",
                    paddingLeft: 16,
                    marginLeft: 4,
                  }}
                >
                  {i.updates.map((u, k) => (
                    <div key={k} style={{ position: "relative" }}>
                      <span
                        style={{
                          position: "absolute",
                          left: -21,
                          top: 5,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: tone.line,
                          border: "2px solid #fff",
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "baseline",
                          fontSize: 12,
                          color: "#8A8378",
                        }}
                      >
                        <strong style={{ color: tone.ink }}>{t(u.status as "resolved")}</strong>
                        <span>{since(u.at, i.startedAt)}</span>
                        {u.correctedAt && (
                          <span>· {t("corrected", { time: time(u.correctedAt) })}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 2 }}>{u.body}</div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </section>

        <section
          data-testid="components"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "0 2px" }}>
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--title)",
                fontSize: 17,
                fontWeight: 600,
                letterSpacing: "-.01em",
              }}
            >
              {t("components")}
            </h2>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "#8A8378" }}>
              {t("last90")}
              {snap.components.some((c) => c.source === "monitor") && ` · ${t("fromMonitors")}`}
            </span>
          </div>
          <ComponentsList
            rows={rows}
            dayFormat={dayFormat}
            labels={{
              uptime30: t("uptime30"),
              response: t("response"),
              lastIncident: t("lastIncidentCol"),
              ago90: t("ago90"),
              today: t("today"),
              operational: t("legendOperational"),
              degraded: t("legendDegraded"),
              outage: t("legendOutage"),
              tipOk: t("tipOk"),
              tipDeg: t("tipDeg"),
              tipOut: t("tipOut"),
              tipNone: t("tipNone"),
            }}
          />
        </section>

        {upcoming.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--title)",
                fontSize: 17,
                fontWeight: 600,
                letterSpacing: "-.01em",
                padding: "0 2px",
              }}
            >
              {t("scheduled")}
            </h2>
            {upcoming.map((m) => (
              <article
                key={m.id}
                id={`maintenance-${m.id}`}
                data-testid="maintenance"
                style={{
                  background: "#fff",
                  border: "1px solid rgba(27,25,23,.08)",
                  borderRadius: 18,
                  padding: "16px 22px",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 14,
                    background: "#F3EEFB",
                    color: "#6D3BC8",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                    flex: "none",
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em" }}>
                    {fmtDate(m.startAt, L, { month: "short" }).toUpperCase()}
                  </span>
                  <span style={{ fontFamily: "var(--title)", fontSize: 22, fontWeight: 600 }}>
                    {fmtDate(m.startAt, L, { day: "numeric" })}
                  </span>
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{m.title}</div>
                  <div style={{ fontSize: 13, color: "#5C5750", marginTop: 3, lineHeight: 1.5 }}>
                    {fmtDate(m.startAt, L, { hour: "2-digit", minute: "2-digit" })} –{" "}
                    {time(m.endAt)}
                    {m.components.length > 0 && ` · ${m.components.join(", ")}`} ·{" "}
                    {maintStatus(m.status)}
                  </div>
                  {m.body && (
                    <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>{m.body}</div>
                  )}
                </div>
                <a
                  href={`/calendar/${m.id}`}
                  style={{
                    height: 32,
                    padding: "0 12px",
                    border: "1px solid rgba(27,25,23,.12)",
                    borderRadius: 9,
                    display: "flex",
                    alignItems: "center",
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  {t("addCal")}
                </a>
              </article>
            ))}
          </section>
        )}

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--title)",
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-.01em",
              padding: "0 2px",
            }}
          >
            {t("history")}
          </h2>
          {months.length > 0 ? (
            <HistoryList months={months} />
          ) : (
            <div style={{ fontSize: 13, color: "#8A8378", padding: "0 2px" }}>{t("none")}</div>
          )}
        </section>

        <footer
          className="st-foot"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            paddingTop: 20,
            borderTop: "1px solid rgba(27,25,23,.08)",
            fontSize: 12.5,
            color: "#8A8378",
            flexWrap: "wrap",
          }}
        >
          <a className="st-link" href="/rss.xml">
            RSS
          </a>
          <a className="st-link" href="/atom.xml">
            Atom
          </a>
          {snap.page.privacyUrl && (
            <a className="st-link" href={snap.page.privacyUrl}>
              {t("privacy")}
            </a>
          )}
          {snap.page.legalUrl && (
            <a className="st-link" href={snap.page.legalUrl}>
              {t("legal")}
            </a>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            {t("powered")}
            <span style={{ fontFamily: "var(--title)", fontWeight: 600, color: "#1B1917" }}>
              Open<span style={{ color: "var(--brand)" }}>*</span>Incident
            </span>
          </span>
        </footer>
      </div>
    </div>
  );
}
