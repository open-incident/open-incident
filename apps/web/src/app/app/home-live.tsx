import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  monitors,
  statusPageSubscribers,
  statusPages,
  withTenant,
  type MonitorState,
} from "@openincident/db";
import { buildSnapshot, statusPageUrl } from "@openincident/statuspages";
import { getT, type Translate } from "@/i18n/server";
import { listIncidents } from "@/lib/incidents";
import { listServices } from "@/lib/services";
import { onCallNow } from "@/lib/oncall";
import { initials } from "@/lib/avatar";
import { AtlasHomeBanner } from "@/components/atlas/home-banner";
import { severityTone, statusInk } from "./incidents/tone";
import { listCertificates, type CertRow } from "./certificates";

/**
 * Home, once the workspace is running: what is burning, how the monitors are,
 * who answers, the certificates about to lapse, the public pages and the
 * services nobody owns — each card a door to its screen.
 *
 * The layout is the design's fluid one: the right column takes 280 to 320 px
 * and drops under the left one when the content area is narrower than about
 * 800 px. Every figure is counted from rows; a card with nothing to say says
 * so rather than disappearing — except the services one, whose only news is
 * a service without an owner.
 */

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

const HEAD: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 16px",
  borderBottom: "1px solid var(--line)",
};

const MORE: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--brand)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const QUIET: React.CSSProperties = { fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 };

const MON_DOT: Record<MonitorState, string> = {
  online: "var(--ok)",
  degraded: "var(--wait)",
  offline: "var(--dang)",
  paused: "var(--ink-3)",
  waiting: "var(--ink-3)",
};
const MON_ORDER: Record<MonitorState, number> = {
  offline: 0,
  degraded: 1,
  online: 2,
  waiting: 3,
  paused: 4,
};

const CERT_INK = ["var(--ok)", "var(--wait)", "var(--dang)"] as const;

const PAGE_DOT: Record<string, string> = {
  operational: "var(--ok)",
  degraded: "var(--wait)",
  partial_outage: "var(--dang)",
  major_outage: "var(--dang)",
  maintenance: "var(--open)",
};

/** Morning until noon, afternoon until six, evening otherwise — in the reader's own zone. */
function greetingKey(now: Date, timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone }).format(now),
  );
  if (hour >= 5 && hour < 12) return "hm.greeting.morning" as const;
  if (hour >= 12 && hour < 18) return "hm.greeting.afternoon" as const;
  return "hm.greeting.evening" as const;
}

function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export async function LiveHome({
  tenantId,
  memberId,
  memberName,
  workspaceName,
  justDone,
}: {
  tenantId: string;
  memberId: string;
  memberName: string;
  workspaceName: string;
  /** The steps were finished a moment ago: say so once, then never again. */
  justDone: boolean;
}) {
  const t = await getT();
  const now = new Date();

  const data = await withTenant(tenantId, async (tx) => {
    const [open, mons, onCall, svcs, certs, pages] = await Promise.all([
      listIncidents(tx, tenantId, "open", memberId),
      tx
        .select({
          id: monitors.id,
          name: monitors.name,
          type: monitors.type,
          state: monitors.state,
          paused: monitors.paused,
          lastLatencyMs: monitors.lastLatencyMs,
          lastDetail: monitors.lastDetail,
          lastCheckAt: monitors.lastCheckAt,
        })
        .from(monitors)
        .where(eq(monitors.tenantId, tenantId))
        .orderBy(asc(monitors.name)),
      onCallNow(tx, tenantId),
      listServices(tx, tenantId),
      listCertificates(tx, tenantId, now),
      tx
        .select({
          id: statusPages.id,
          name: statusPages.name,
          slug: statusPages.slug,
          customDomain: statusPages.customDomain,
          customDomainVerifiedAt: statusPages.customDomainVerifiedAt,
        })
        .from(statusPages)
        .where(eq(statusPages.tenantId, tenantId))
        .orderBy(asc(statusPages.name))
        .limit(3),
    ]);
    const pageRows = await Promise.all(
      pages.map(async (p) => {
        const snap = await buildSnapshot(tx, tenantId, p.id).catch(() => null);
        const [subs] = await tx
          .select({
            n: sql<number>`count(*) filter (where ${statusPageSubscribers.confirmedAt} is not null)`.mapWith(
              Number,
            ),
          })
          .from(statusPageSubscribers)
          .where(
            and(
              eq(statusPageSubscribers.tenantId, tenantId),
              eq(statusPageSubscribers.pageId, p.id),
            ),
          );
        const hit = snap?.components.find(
          (c) => c.state !== "operational" && c.state !== "unknown",
        );
        return {
          id: p.id,
          name: p.name,
          host: statusPageUrl(p).replace(/^https?:\/\//, ""),
          overall: snap?.overall ?? "operational",
          hit: hit ? { name: hit.name, state: hit.state } : null,
          subs: subs?.n ?? 0,
        };
      }),
    );
    return { open, mons, onCall, svcs, certs, pages: pageRows };
  });

  const firstName = memberName.split(" ")[0] || memberName;
  const date = now.toLocaleDateString(t.locale.tag, {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: t.timeZone,
  });

  return (
    <div
      data-screen-label="Home — living workspace"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        animation: "ohd-rise .2s ease backwards",
      }}
    >
      {justDone && (
        <div
          data-testid="home-just-done"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--ok-t)",
            border: "1px solid rgba(14,122,88,.3)",
            borderRadius: 12,
            padding: "11px 15px",
            fontSize: 13.5,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--ok)",
              flex: "none",
            }}
          />
          <span style={{ flex: 1, minWidth: 0, lineHeight: 1.5 }}>
            <strong>{t("hm.set.title")}</strong> {t("hm.set.body", { workspace: workspaceName })}
          </span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t(greetingKey(now, t.timeZone), { name: firstName })}
        </h1>
        <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
          {date} · {t.fmt.time(now, t.timeZone)} · {t.timeZone}
        </span>
      </div>

      <AtlasHomeBanner tenantId={tenantId} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minWidth: 0,
            flex: "10 1 460px",
          }}
        >
          <Burning t={t} rows={data.open} />
          <Monitors t={t} mons={data.mons} certs={data.certs} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            flex: "1 1 280px",
            maxWidth: 320,
            minWidth: 260,
          }}
        >
          <OnCall t={t} slots={data.onCall} />
          <Certificates t={t} certs={data.certs} />
          <StatusPagesCard t={t} pages={data.pages} />
          <Unowned t={t} svcs={data.svcs} now={now} />
        </div>
      </div>
    </div>
  );
}

/* ---------- What's burning ---------- */

function Burning({ t, rows }: { t: Translate; rows: Awaited<ReturnType<typeof listIncidents>> }) {
  const shown = rows.slice(0, 6);
  return (
    <div data-testid="home-burning" style={{ ...CARD, overflow: "hidden" }}>
      <div style={HEAD}>
        <span
          className={rows.length > 0 ? "oi-pulse" : undefined}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: rows.length > 0 ? "var(--dang)" : "var(--ok)",
            flex: "none",
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("home.burning")}</span>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {t("home.openIncidents", { count: rows.length })}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/incidents" style={MORE}>
          {t("home.allIncidents")} →
        </Link>
      </div>
      {shown.length === 0 ? (
        <div style={{ padding: "18px 16px", fontSize: 13, color: "var(--ink-2)" }}>
          {t("home.nothingBurning")}
        </div>
      ) : (
        shown.map((i) => {
          const sev = severityTone(i.severityRank);
          return (
            <Link
              key={i.id}
              href={`/app/incidents/${i.number}`}
              className="oi-hover"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 16px",
                borderBottom: "1px solid var(--line-2)",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  color: "var(--brand)",
                  fontWeight: 600,
                  flex: "none",
                }}
              >
                INC-{i.number}
              </span>
              {i.severityName && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    borderRadius: 999,
                    padding: "2px 8px",
                    background: sev.bg,
                    color: sev.ink,
                    flex: "none",
                  }}
                >
                  {i.severityName}
                </span>
              )}
              <span
                style={{
                  flex: 1,
                  minWidth: 160,
                  fontSize: 13.5,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {i.name}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: statusInk(i.phase, i.status),
                  whiteSpace: "nowrap",
                }}
              >
                {i.phase === "active" && i.statusName
                  ? i.statusName
                  : t(`incident.phase.${i.phase}`)}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                {t.fmt.relativeCompact(i.lastActivityAt)}
              </span>
            </Link>
          );
        })
      )}
    </div>
  );
}

/* ---------- Monitors ---------- */

type MonRow = {
  id: string;
  name: string;
  type: string;
  state: MonitorState;
  paused: boolean;
  lastLatencyMs: number | null;
  lastDetail: string | null;
  lastCheckAt: Date | null;
};

function monValue(t: Translate, m: MonRow, cert: CertRow | undefined): string {
  if (m.paused || m.state === "paused") return t("hm.mon.paused");
  if (m.state === "waiting") return t("home.noCheckYet");
  let value: string;
  if (m.type === "ssl" && cert) value = t("hm.mon.days", { count: cert.daysLeft });
  else if (m.type === "domain") {
    const days = /expires in (-?\d+) days?/i.exec(m.lastDetail ?? "")?.[1];
    value = days !== undefined ? t("hm.mon.days", { count: Number(days) }) : (m.lastDetail ?? "");
  } else if (m.type === "dns" || m.type === "manual") value = t("hm.mon.ok");
  else if (m.type === "incoming")
    value = m.lastCheckAt ? t.fmt.time(m.lastCheckAt, t.timeZone) : t("home.noCheckYet");
  else if (m.lastLatencyMs !== null && m.lastLatencyMs > 0) value = duration(m.lastLatencyMs);
  else value = m.lastDetail ?? "";
  if (m.state === "degraded" || m.state === "offline")
    return value ? `${t(`hm.mon.${m.state}`)} · ${value}` : t(`hm.mon.${m.state}`);
  return value;
}

function Monitors({ t, mons, certs }: { t: Translate; mons: MonRow[]; certs: CertRow[] }) {
  const state = (m: MonRow): MonitorState => (m.paused ? "paused" : m.state);
  const count = (s: MonitorState) => mons.filter((m) => state(m) === s).length;
  const shown = [...mons]
    .sort((a, b) => MON_ORDER[state(a)] - MON_ORDER[state(b)] || a.name.localeCompare(b.name))
    .slice(0, 8);
  const pad = shown.length % 4 === 0 ? 0 : 4 - (shown.length % 4);
  const certBy = new Map(certs.map((c) => [c.monitorId, c]));
  return (
    <div data-testid="home-monitors" style={{ ...CARD, overflow: "hidden" }}>
      <div style={HEAD}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("nav.monitors")}</span>
        {mons.length > 0 && (
          <>
            <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>
              {t("home.monitorsOnline", { count: count("online") })}
            </span>
            {count("degraded") > 0 && (
              <span style={{ fontSize: 12, color: "var(--wait)", fontWeight: 600 }}>
                {t("home.monitorsDegraded", { count: count("degraded") })}
              </span>
            )}
            {count("offline") > 0 && (
              <span style={{ fontSize: 12, color: "var(--dang)", fontWeight: 600 }}>
                {t("hm.monOffline", { count: count("offline") })}
              </span>
            )}
            {count("paused") > 0 && (
              <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>
                {t("hm.monPaused", { count: count("paused") })}
              </span>
            )}
          </>
        )}
        <span style={{ flex: 1 }} />
        <Link href="/app/monitors" style={MORE}>
          {t("home.allMonitors")} →
        </Link>
      </div>
      {mons.length === 0 ? (
        <div style={{ padding: "18px 16px", fontSize: 13, color: "var(--ink-2)" }}>
          {t("home.noMonitors")}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 1,
            background: "var(--line-2)",
          }}
        >
          {shown.map((m) => (
            <Link
              key={m.id}
              href={`/app/monitors/${m.id}`}
              className="oi-hover"
              style={{
                background: "var(--panel)",
                padding: "10px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                textDecoration: "none",
                color: "inherit",
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: MON_DOT[state(m)],
                    flex: "none",
                  }}
                />
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.name}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  fontFamily: "var(--mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {monValue(t, m, certBy.get(m.id))}
              </div>
            </Link>
          ))}
          {Array.from({ length: pad }, (_, i) => (
            <span key={`pad-${i}`} style={{ background: "var(--panel)" }} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- On call now ---------- */

const PEOPLE_TONE = [
  { bg: "var(--wait-t)", ink: "var(--wait)" },
  { bg: "var(--open-t)", ink: "var(--open)" },
  { bg: "var(--viol-t)", ink: "var(--viol)" },
];

function OnCall({ t, slots }: { t: Translate; slots: Awaited<ReturnType<typeof onCallNow>> }) {
  const covered = slots.filter((s) => s.memberName).slice(0, 3);
  return (
    <div
      data-testid="home-oncall"
      style={{ ...CARD, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 11 }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("home.onCallNow")}</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/on-call" style={MORE}>
          {t("nav.onCall")} →
        </Link>
      </div>
      {covered.length === 0 ? (
        <div style={QUIET}>{t("home.nobodyOnCall")}</div>
      ) : (
        covered.map((s, i) => (
          <div
            key={`${s.scheduleId}-${s.rotationName}`}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: PEOPLE_TONE[i]!.bg,
                color: PEOPLE_TONE[i]!.ink,
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                fontWeight: 700,
                flex: "none",
              }}
            >
              {initials(s.memberName!)}
            </span>
            <div style={{ flex: 1, lineHeight: 1.25, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.memberName}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {s.scheduleName} · {s.rotationName} ·{" "}
                {t("home.until", { until: t.fmt.time(s.until, t.timeZone) })}
              </div>
            </div>
            {i === 0 && (
              <span
                className="oi-pulse"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--dang)",
                  flex: "none",
                }}
              />
            )}
          </div>
        ))
      )}
    </div>
  );
}

/* ---------- Certificates ---------- */

function Certificates({ t, certs }: { t: Translate; certs: CertRow[] }) {
  const by = (l: 0 | 1 | 2) => certs.filter((c) => c.level === l).length;
  const soon = certs.filter((c) => c.level > 0);
  const badge =
    by(2) > 0
      ? { text: t("hm.cert.badge7", { count: by(2) }), bg: "var(--dang-t)", ink: "var(--dang)" }
      : by(1) > 0
        ? { text: t("hm.cert.badge30", { count: by(1) }), bg: "var(--wait-t)", ink: "var(--wait)" }
        : certs.length > 0
          ? { text: t("hm.cert.allValid"), bg: "var(--ok-t)", ink: "var(--ok)" }
          : null;
  const segs = ([0, 1, 2] as const).map((l) => ({
    l,
    n: by(l),
    w: certs.length ? `${Math.round((by(l) / certs.length) * 100)}%` : "0%",
    label: t(l === 0 ? "hm.cert.valid" : l === 1 ? "hm.cert.under30" : "hm.cert.under7"),
  }));
  return (
    <div
      data-testid="home-certificates"
      data-screen-label="Home — Certificates"
      style={{ ...CARD, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("hm.cert.title")}</span>
        {badge && (
          <span
            data-testid="home-cert-badge"
            style={{
              fontSize: 11,
              fontWeight: 700,
              background: badge.bg,
              color: badge.ink,
              borderRadius: 999,
              padding: "2px 8px",
              whiteSpace: "nowrap",
            }}
          >
            {badge.text}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Link href="/app/monitors" style={MORE}>
          {t("nav.monitors")} →
        </Link>
      </div>
      {certs.length === 0 ? (
        <div style={QUIET}>{t("hm.cert.none")}</div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              height: 6,
              borderRadius: 999,
              overflow: "hidden",
              background: "var(--sunk)",
            }}
          >
            {segs.map((s) => (
              <span key={s.l} style={{ width: s.w, background: CERT_INK[s.l] }} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {segs.map((s) => (
              <div key={s.l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{ width: 7, height: 7, borderRadius: "50%", background: CERT_INK[s.l] }}
                />
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700 }}>
                  {s.n}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{s.label}</span>
              </div>
            ))}
          </div>
          {soon.map((c) => (
            <Link
              key={c.monitorId}
              href={`/app/monitors/${c.monitorId}`}
              data-testid="home-cert-row"
              style={{
                display: "grid",
                gridTemplateColumns: "8px minmax(0,1fr) auto",
                gap: 10,
                alignItems: "center",
                padding: "8px 0 2px",
                borderTop: "1px solid var(--line-2)",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <span
                style={{ width: 8, height: 8, borderRadius: "50%", background: CERT_INK[c.level] }}
              />
              <span style={{ minWidth: 0, lineHeight: 1.25 }}>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.host}
                </span>
                <span style={{ display: "block", fontSize: 11, color: "var(--ink-3)" }}>
                  {c.issuer
                    ? t("hm.cert.issuerExpires", {
                        issuer: c.issuer,
                        date: t.fmt.dateShort(c.validTo),
                      })
                    : t("hm.cert.expires", { date: t.fmt.dateShort(c.validTo) })}
                </span>
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: c.level === 2 ? "var(--dang)" : "var(--wait)",
                  whiteSpace: "nowrap",
                }}
              >
                {c.daysLeft < 0 ? t("hm.cert.expired") : t("hm.cert.left", { count: c.daysLeft })}
              </span>
            </Link>
          ))}
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink-3)",
              lineHeight: 1.5,
              borderTop: "1px solid var(--line-2)",
              paddingTop: 8,
            }}
          >
            {soon.length > 0 ? t("hm.cert.notePaging") : t("hm.cert.noteAllValid")}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Status pages ---------- */

function StatusPagesCard({
  t,
  pages,
}: {
  t: Translate;
  pages: Array<{
    id: string;
    name: string;
    host: string;
    overall: string;
    hit: { name: string; state: string } | null;
    subs: number;
  }>;
}) {
  const stateWord = (s: string) =>
    t(
      s === "degraded"
        ? "hm.sp.degraded"
        : s === "partial_outage"
          ? "hm.sp.partial"
          : s === "major_outage"
            ? "hm.sp.major"
            : "hm.sp.maintenance",
    );
  return (
    <div
      data-testid="home-status-pages"
      style={{ ...CARD, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("nav.statusPages")}</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/status-pages" style={MORE}>
          {t("home.manage")} →
        </Link>
      </div>
      {pages.length === 0 ? (
        <div style={QUIET}>{t("hm.sp.none")}</div>
      ) : (
        pages.map((p) => (
          <Link
            key={p.id}
            href={`/app/status-pages?page=${p.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "9px 12px",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: PAGE_DOT[p.overall] ?? "var(--ink-3)",
                flex: "none",
              }}
            />
            <div style={{ flex: 1, lineHeight: 1.25, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {p.host} ·{" "}
                {p.hit
                  ? t("hm.sp.component", { name: p.hit.name, state: stateWord(p.hit.state) })
                  : t("hm.sp.operational")}{" "}
                · {t("hm.sp.subscribers", { count: p.subs })}
              </div>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}

/* ---------- Services without an owner ---------- */

function Unowned({
  t,
  svcs,
  now,
}: {
  t: Translate;
  svcs: Awaited<ReturnType<typeof listServices>>;
  now: Date;
}) {
  const unowned = svcs.filter((s) => !s.ownerTeamId);
  if (unowned.length === 0) return null;
  const week = now.getTime() - 7 * 86_400_000;
  const recent = unowned.filter((s) => s.lastSeenAt && s.lastSeenAt.getTime() >= week);
  const named = (recent.length > 0 ? recent : unowned).slice(0, 3).map((s) => s.key);
  const names = new Intl.ListFormat(t.locale.tag, { type: "conjunction" }).format(named);
  return (
    <div
      data-testid="home-unowned"
      style={{ ...CARD, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("nav.services")}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            background: "var(--wait-t)",
            color: "var(--wait)",
            borderRadius: 999,
            padding: "2px 8px",
          }}
        >
          {t("home.withoutOwner", { count: unowned.length })}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/services" style={MORE}>
          {t("home.assign")} →
        </Link>
      </div>
      <div style={QUIET}>
        {recent.length > 0 ? t("hm.unownedWeek", { names }) : t("home.unownedBody", { names })}
      </div>
    </div>
  );
}
