import Link from "next/link";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  services as servicesTable,
  incidents,
  statusPageComponents,
  statusPageIncidentUpdates,
  statusPageIncidents,
  statusPageMaintenances,
  statusPageSubscribers,
  statusPageTemplates,
  statusPages,
  webhookEndpoints,
  withTenant,
} from "@openincident/db";
import { buildSnapshot, statusPageUrl } from "@openincident/statuspages";
import { isManagerRole } from "@openincident/config";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { listMonitors } from "@/lib/monitors";
import {
  ComponentDialog,
  MaintenanceDialog,
  MaintenanceEditDialog,
  NewComponentDialog,
  NewPageDialog,
  PublicIncidentDialog,
} from "./dialogs";
import { SettingsView } from "./settings-view";

/** A day's bar. The green is the design's — `--ok` at 55 %, so a good month reads as texture. */
const BAR: Record<string, string> = {
  operational: "rgba(14,122,88,.55)",
  degraded: "var(--wait)",
  partial_outage: "var(--wait)",
  major_outage: "var(--dang)",
  maintenance: "var(--viol)",
  unknown: "var(--line)",
  none: "var(--line)",
};

const STATE_INK: Record<string, string> = {
  operational: "var(--ok)",
  degraded: "var(--wait)",
  partial_outage: "var(--wait)",
  major_outage: "var(--dang)",
  maintenance: "var(--viol)",
  unknown: "var(--ink-3)",
};

/** The subscriber channels, drawn as in the design. */
const stroked = { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", strokeWidth: 2 };
const ICON = {
  mail: (
    <svg {...stroked} stroke="currentColor">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  ),
  feed: (
    <svg {...stroked} stroke="currentColor">
      <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1.5" fill="currentColor" />
    </svg>
  ),
  hook: (
    <svg {...stroked} stroke="currentColor">
      <path d="M7 8l-4 4 4 4M17 8l4 4-4 4M14 5l-4 14" />
    </svg>
  ),
  slack: (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor">
      <rect x="3" y="10" width="8" height="4" rx="2" />
      <rect x="13" y="10" width="8" height="4" rx="2" />
      <rect x="10" y="3" width="4" height="8" rx="2" />
      <rect x="10" y="13" width="4" height="8" rx="2" />
    </svg>
  ),
  teams: (
    <svg {...stroked} stroke="currentColor">
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M15 12h6v5" />
    </svg>
  ),
};

const panel: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  overflow: "hidden",
};
const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 9,
};
const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: "1px solid var(--line)",
};
const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const pill = (ink: string, bg: string): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  color: ink,
  background: bg,
  borderRadius: 999,
  padding: "2px 9px",
  flex: "none",
});

/**
 * Status pages — the V2 screen.
 *
 * The page one is looking at holds the top of the screen; its components are
 * the heart of it. A component either tracks a monitor — and then its state,
 * its uptime and its thirty bars are the monitor's, nobody's to set — or it is
 * manual and a human moves it from the incidents. A row opens its dialog; the
 * page's own settings (brand, language, domain, wording) live one click away,
 * at `?tab=settings`. Everything written here rewrites the snapshot the
 * isolated public app serves.
 */
export default async function StatusPagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const manages = isManagerRole(member);
  const acts = canRespond(member);
  const data = await withTenant(tenant.id, async (tx) => {
    const pages = await tx
      .select()
      .from(statusPages)
      .where(eq(statusPages.tenantId, tenant.id))
      .orderBy(asc(statusPages.createdAt));
    const page = pages.find((p) => p.id === q.page) ?? pages[0] ?? null;
    const compCounts = pages.length
      ? await tx
          .select({
            pageId: statusPageComponents.pageId,
            n: sql<number>`count(*)`.mapWith(Number),
          })
          .from(statusPageComponents)
          .where(
            inArray(
              statusPageComponents.pageId,
              pages.map((p) => p.id),
            ),
          )
          .groupBy(statusPageComponents.pageId)
      : [];
    const hooks = await tx
      .select({ events: webhookEndpoints.events, active: webhookEndpoints.active })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenant.id));
    const webhookCount = hooks.filter(
      (h) => h.active && h.events.includes("status_page.incident_published"),
    ).length;
    const empty = {
      pages,
      page: null,
      snap: null,
      comps: [],
      publicIncidents: [],
      maints: [],
      templates: [],
      subs: 0,
      services: [],
      monitors: [],
      webhookCount,
      counts: new Map(compCounts.map((c) => [c.pageId, c.n])),
      updateRows: [] as Array<typeof statusPageIncidentUpdates.$inferSelect>,
      linked: new Map<string, number>(),
    };
    if (!page) return empty;
    const snap = await buildSnapshot(tx, tenant.id, page.id);
    const comps = await tx
      .select()
      .from(statusPageComponents)
      .where(eq(statusPageComponents.pageId, page.id))
      .orderBy(asc(statusPageComponents.position));
    const publicIncidents = await tx
      .select()
      .from(statusPageIncidents)
      .where(eq(statusPageIncidents.pageId, page.id))
      .orderBy(desc(statusPageIncidents.startedAt))
      .limit(8);
    // The updates themselves, not only how many: a published sentence with
    // the wrong service in it is corrected from the row it belongs to.
    const updateRows = publicIncidents.length
      ? await tx
          .select()
          .from(statusPageIncidentUpdates)
          .where(
            inArray(
              statusPageIncidentUpdates.statusPageIncidentId,
              publicIncidents.map((i) => i.id),
            ),
          )
          .orderBy(desc(statusPageIncidentUpdates.publishedAt))
      : [];
    const linkedIds = publicIncidents
      .map((i) => i.incidentId)
      .filter((x): x is string => Boolean(x));
    const linked = linkedIds.length
      ? await tx
          .select({ id: incidents.id, number: incidents.number })
          .from(incidents)
          .where(inArray(incidents.id, linkedIds))
      : [];
    const maints = await tx
      .select()
      .from(statusPageMaintenances)
      .where(eq(statusPageMaintenances.pageId, page.id))
      .orderBy(desc(statusPageMaintenances.startAt))
      .limit(8);
    const templates = await tx
      .select()
      .from(statusPageTemplates)
      .where(eq(statusPageTemplates.pageId, page.id))
      .orderBy(asc(statusPageTemplates.position));
    const [subs] = await tx
      .select({
        n: sql<number>`count(*) filter (where ${statusPageSubscribers.confirmedAt} is not null)`.mapWith(
          Number,
        ),
      })
      .from(statusPageSubscribers)
      .where(eq(statusPageSubscribers.pageId, page.id));
    // The services the workspace has learned about; a component names one of
    // those or nothing.
    const services = await tx
      .select({ id: servicesTable.id, name: servicesTable.key })
      .from(servicesTable)
      .where(eq(servicesTable.tenantId, tenant.id))
      .orderBy(asc(servicesTable.key));
    return {
      ...empty,
      page,
      snap,
      comps,
      publicIncidents,
      maints,
      templates,
      subs: subs?.n ?? 0,
      services,
      monitors: await listMonitors(tx, tenant.id),
      updateRows,
      linked: new Map(linked.map((l) => [l.id, l.number])),
    };
  });
  const { page, snap } = data;

  if (page && q.tab === "settings")
    return (
      <SettingsView
        page={page}
        templates={data.templates}
        manages={manages}
        isOwner={member.role === "owner"}
        notices={q}
      />
    );

  const tone = (s: string): [string, string] =>
    s === "operational"
      ? ["var(--ok-t)", "var(--ok)"]
      : s === "major_outage"
        ? ["var(--dang-t)", "var(--dang)"]
        : s === "maintenance"
          ? ["var(--viol-t)", "var(--viol)"]
          : ["var(--wait-t)", "var(--wait)"];
  const stateLabel = (s: string) =>
    s === "unknown" ? t("monitors.state.waiting") : t(`statusPages.state.${s as "operational"}`);
  const hostOf = (p: {
    slug: string;
    customDomain: string | null;
    customDomainVerifiedAt: Date | null;
  }) => new URL(statusPageUrl(p)).host;
  const time = (d: Date) => t.fmt.time(d, t.timeZone);
  const day = (d: Date) =>
    d.toLocaleDateString(t.locale.tag, { day: "numeric", month: "short", timeZone: t.timeZone });

  const Channel = ({
    icon,
    name,
    value,
    off,
  }: {
    icon: React.ReactNode;
    name: string;
    value: string;
    off?: boolean;
  }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-2)",
          flex: "none",
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, color: off ? "var(--ink-3)" : undefined }}>{name}</span>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontWeight: off ? 400 : 600,
          fontSize: off ? 11 : 12.5,
          color: off ? "var(--ink-3)" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );

  const nPublic = data.pages.filter((p) => p.visibility === "public").length;
  const nInternal = data.pages.length - nPublic;
  const notice = (text: string, ok = true) => (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: ok ? "var(--ok-t)" : "var(--note)",
        border: `1px solid ${ok ? "var(--ok)" : "var(--note-b)"}`,
        borderRadius: "var(--radius-card)",
        padding: "10px 14px",
        fontSize: 12.5,
        color: "var(--ink-2)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: ok ? "var(--ok)" : "var(--note-ink)",
          flex: "none",
        }}
      />
      {text}
    </div>
  );

  const compRow: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(150px,1fr) minmax(200px,2fr) 150px",
    gap: 14,
    alignItems: "center",
    padding: "11px 16px",
    borderBottom: "1px solid var(--line-2)",
  };
  const feedRow: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "11px 16px",
    borderBottom: "1px solid var(--line-2)",
  };

  return (
    <div
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("statusPages.railLabel")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("sp2.countPublic", { count: nPublic })} ·{" "}
          {t("sp2.countInternal", { count: nInternal })}
        </span>
        <span style={{ flex: 1 }} />
        {q.error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {q.error === "slug"
              ? t("statusPages.errorSlug")
              : q.error === "owner"
                ? t("statusPages.errorOwner")
                : t("settings.fields.errorInvalid")}
          </span>
        )}
        {manages && <NewPageDialog defaultAccent="#0B4A6F" />}
      </div>

      {!page || !snap ? (
        <div
          style={{
            padding: 36,
            border: "1.5px dashed var(--line)",
            borderRadius: "var(--radius-card)",
            color: "var(--ink-3)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {t("statusPages.empty")}
        </div>
      ) : (
        <>
          {q.created === "1" && notice(t("statusPages.createdNote", { url: statusPageUrl(page) }))}
          {q.maintenance === "1" && notice(t("statusPages.maintenanceScheduled"))}
          {q.maintenance === "edited" && notice(t("sp2.maintenanceMoved"))}
          {q.corrected === "1" && notice(t("sp2.updateCorrected"))}

          <div
            style={{
              ...panel,
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: page.accentColor,
                color: "var(--on-brand)",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                flex: "none",
              }}
            >
              {page.name.slice(0, 1).toUpperCase()}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{page.name}</h2>
              <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
                {hostOf(page)} ·{" "}
                {page.visibility === "internal"
                  ? t("sp2.visibilityInternal")
                  : t("sp2.visibilityPublic")}{" "}
                ·{" "}
                {page.customDomain
                  ? page.customDomainVerifiedAt
                    ? t("statusPages.domainVerified")
                    : t("statusPages.domainPending")
                  : t("statusPages.noDomain")}
              </div>
            </div>
            {(() => {
              const [bg, ink] = tone(snap.overall);
              return (
                <span
                  data-testid="page-overall"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: ink,
                    background: bg,
                    borderRadius: 999,
                    padding: "4px 12px",
                  }}
                >
                  <span
                    style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }}
                  />
                  {t(`statusPages.overall.${snap.overall as "operational"}`)}
                </span>
              );
            })()}
            <a
              href={
                page.visibility === "internal"
                  ? `/app/status-pages/${page.id}/open`
                  : statusPageUrl(page)
              }
              target="_blank"
              rel="noreferrer"
              data-testid="public-link"
              className="oi-hover-edge-fill"
              style={{
                height: 31,
                padding: "0 13px",
                border: "1px solid var(--line)",
                borderRadius: 9,
                display: "flex",
                alignItems: "center",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                color: "var(--brand)",
                textDecoration: "none",
              }}
            >
              {t("statusPages.viewPublic")}
            </a>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 330px",
              gap: 14,
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              <section style={panel} data-testid="components">
                <div style={head}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {t("statusPages.components")}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: 10 }}>
                    {t("sp2.componentsNote")}
                  </span>
                  <span style={{ flex: 1 }} />
                  {manages && (
                    <NewComponentDialog
                      pageId={page.id}
                      services={data.services}
                      monitors={data.monitors.map((m) => ({
                        id: m.id,
                        name: m.name,
                        type: m.type,
                        state: m.state,
                      }))}
                    />
                  )}
                </div>
                {snap.components.map((c) => {
                  const row = data.comps.find((x) => x.id === c.id);
                  const svc = data.services.find((s) => s.id === row?.serviceId);
                  const mon = data.monitors.find((m) => m.id === c.monitorId);
                  // The AUTO badge already says where the state comes from, so
                  // the line under the name spends itself on the source: the
                  // monitor, or the service a person sets it from.
                  const source =
                    c.source === "monitor"
                      ? `${c.monitorName ?? ""}${mon ? ` ${mon.type}` : ""}`.trim()
                      : svc
                        ? t("alst.sp.manualService", { service: svc.name })
                        : t("sp2.manualSource");
                  const cells = (
                    <>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--ink-3)",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          {c.source === "monitor" && (
                            <span
                              title={t("sp2.autoTitle")}
                              style={{
                                fontSize: 9.5,
                                fontWeight: 700,
                                color: "var(--ok)",
                                background: "var(--ok-t)",
                                borderRadius: 4,
                                padding: "0 5px",
                                flex: "none",
                              }}
                            >
                              {t("sp2.auto")}
                            </span>
                          )}
                          <span
                            title={source}
                            style={{
                              fontFamily: "var(--mono)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {source}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{ display: "flex", gap: 1.5, alignItems: "flex-end" }}
                        title={t("monitors.colLast30")}
                      >
                        {/* The public page draws ninety; this column is a
                            glance the width of a thumb. The last thirty. */}
                        {c.ticks.slice(-30).map((tk, k) => (
                          <span
                            key={k}
                            style={{
                              flex: 1,
                              height: 16,
                              borderRadius: 2,
                              background: BAR[tk] ?? "var(--line)",
                            }}
                          />
                        ))}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 8,
                        }}
                      >
                        <span
                          title={t("sp2.uptime90Title")}
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 12,
                            fontWeight: 600,
                            color: c.uptime90 === null ? "var(--ink-3)" : "var(--ok)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.uptime90 === null ? "—" : `${c.uptime90.toFixed(2)} %`}
                        </span>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 11,
                            fontWeight: 600,
                            color: STATE_INK[c.state] ?? "var(--ink-3)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "currentColor",
                              flex: "none",
                            }}
                          />
                          {stateLabel(c.state)}
                        </span>
                      </div>
                    </>
                  );
                  return acts ? (
                    <ComponentDialog
                      key={c.id}
                      id={c.id}
                      name={c.name}
                      description={row?.description ?? null}
                      groupName={row?.groupName ?? null}
                      state={c.state}
                      tracked={c.source === "monitor"}
                      manages={manages}
                      rowStyle={compRow}
                    >
                      {cells}
                    </ComponentDialog>
                  ) : (
                    <div key={c.id} data-testid="component-row" style={compRow}>
                      {cells}
                    </div>
                  );
                })}
                {snap.components.length === 0 && (
                  <div style={{ padding: 16, fontSize: 12.5, color: "var(--ink-3)" }}>
                    {t("statusPages.noComponents")}
                  </div>
                )}
              </section>

              <section style={panel}>
                <div style={head}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("sp2.publicFeed")}</span>
                  <span style={{ flex: 1 }} />
                  {acts && (
                    <MaintenanceDialog
                      pageId={page.id}
                      components={data.comps.map((c) => ({ id: c.id, name: c.name }))}
                    />
                  )}
                </div>
                {data.publicIncidents.map((i) => {
                  const n = i.incidentId ? (data.linked.get(i.incidentId) ?? null) : null;
                  const mine = data.updateRows.filter((u) => u.statusPageIncidentId === i.id);
                  const resolved = i.status === "resolved";
                  const [ink, bg] = resolved
                    ? ["var(--ok)", "var(--ok-t)"]
                    : ["var(--wait)", "var(--wait-t)"];
                  const meta = [
                    n ? t("alst.sp.fromIncident", { number: String(n) }) : null,
                    resolved ? day(i.startedAt) : null,
                    t("alst.sp.publicUpdates", { count: mine.length }),
                    resolved && i.resolvedAt
                      ? t("statusPages.resolvedIn", {
                          duration: t.fmt.duration(
                            (i.resolvedAt.getTime() - i.startedAt.getTime()) / 60_000,
                          ),
                        })
                      : mine[0]
                        ? t("alst.sp.lastAt", { time: time(mine[0].publishedAt) })
                        : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <PublicIncidentDialog
                      key={i.id}
                      pageId={page.id}
                      title={i.title}
                      incidentNumber={n}
                      acts={acts}
                      rowStyle={feedRow}
                      updates={mine.map((u) => ({
                        id: u.id,
                        status: u.status,
                        body: u.body,
                        at: u.publishedAt.toISOString(),
                        notified: u.notifiedCount,
                        correctedAt: u.correctedAt?.toISOString() ?? null,
                      }))}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: ink,
                          flex: "none",
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{i.title}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{meta}</div>
                      </div>
                      <span style={pill(ink, bg)}>{t(`statusPages.publicStatus.${i.status}`)}</span>
                    </PublicIncidentDialog>
                  );
                })}
                {data.maints.map((m) => {
                  const off = m.status === "cancelled";
                  const done = m.status === "completed";
                  const [ink, bg] = off
                    ? ["var(--ink-3)", "var(--sunk)"]
                    : done
                      ? ["var(--ok)", "var(--ok-t)"]
                      : ["var(--viol)", "var(--viol-t)"];
                  const meta = [
                    `${day(m.startAt)} · ${time(m.startAt)}–${time(m.endAt)}`,
                    m.autoTransitions ? t("statusPages.autoTransitions") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <MaintenanceEditDialog
                      key={m.id}
                      id={m.id}
                      pageId={page.id}
                      title={m.title}
                      body={m.body}
                      startAt={m.startAt.toISOString()}
                      endAt={m.endAt.toISOString()}
                      componentIds={m.componentIds}
                      components={data.comps.map((c) => ({ id: c.id, name: c.name }))}
                      editable={acts && m.status === "scheduled"}
                      cancellable={acts && (m.status === "scheduled" || m.status === "in_progress")}
                      rowStyle={feedRow}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: off ? "var(--ink-3)" : "var(--viol)",
                          flex: "none",
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{m.title}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{meta}</div>
                      </div>
                      <span style={pill(ink, bg)}>
                        {t(`statusPages.maintenanceStatus.${m.status}`)}
                      </span>
                    </MaintenanceEditDialog>
                  );
                })}
                {data.publicIncidents.length === 0 && data.maints.length === 0 && (
                  <div style={{ padding: 16, fontSize: 12.5, color: "var(--ink-3)" }}>
                    {t("statusPages.nothingRecent")}
                  </div>
                )}
              </section>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <section style={card}>
                <div style={eyebrow}>
                  {t("sp2.subscribersEyebrow", { count: data.subs + data.webhookCount })}
                </div>
                <Channel icon={ICON.mail} name={t("sp2.chEmail")} value={String(data.subs)} />
                <Channel icon={ICON.feed} name={t("sp2.chFeed")} value={String(page.feedHits)} />
                <Channel
                  icon={ICON.hook}
                  name={t("sp2.chWebhook")}
                  value={String(data.webhookCount)}
                />
                <Channel
                  icon={ICON.slack}
                  name={t("sp2.chSlack")}
                  value={t("sp2.unavailable")}
                  off
                />
                <Channel
                  icon={ICON.teams}
                  name={t("sp2.chTeams")}
                  value={t("sp2.unavailable")}
                  off
                />
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  {t("sp2.subscribersNote")}
                </div>
              </section>

              {data.pages
                .filter((p) => p.id !== page.id)
                .map((p) => (
                  <Link
                    key={p.id}
                    href={`/app/status-pages?page=${p.id}`}
                    data-testid="other-page"
                    className="oi-hover-edge"
                    style={{ ...card, gap: 8, color: "inherit", textDecoration: "none" }}
                  >
                    <div style={eyebrow}>
                      {p.visibility === "internal" ? t("sp2.internalPage") : t("sp2.publicPage")}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {p.visibility === "internal" ? t("sp2.ssoOnly") : hostOf(p)} ·{" "}
                      {t("sp2.nComponents", { count: data.counts.get(p.id) ?? 0 })}
                    </div>
                  </Link>
                ))}

              <div
                style={{
                  background: "var(--sunk)",
                  borderRadius: "var(--radius-card)",
                  padding: "12px 14px",
                  fontSize: 12,
                  color: "var(--ink-2)",
                  lineHeight: 1.55,
                }}
              >
                {t("statusPages.isolationNote")}
              </div>

              <Link
                href={`/app/status-pages?page=${page.id}&tab=settings`}
                data-testid="page-settings"
                className="oi-hover-edge"
                style={{ ...card, gap: 6, color: "inherit", textDecoration: "none" }}
              >
                <div style={eyebrow}>{t("sp2.settings")}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  {t("alst.sp.settingsHint")}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)" }}>
                  {t("alst.sp.settingsOpen")}
                </span>
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
