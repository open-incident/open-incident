import Link from "next/link";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  catalogEntries,
  catalogTypes,
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
import { MaintenanceDialog, NewComponentDialog, NewPageDialog } from "./dialogs";
import {
  cancelMaintenance,
  deleteComponent,
  deleteStatusPage,
  deleteTemplate,
  importSubscribers,
  saveCustomDomain,
  saveStatusPage,
  saveTemplate,
  updateComponentState,
} from "./actions";

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

/**
 * Status pages — the V2 screen.
 *
 * The page one is looking at holds the top of the screen; its components are
 * the heart of it. A component either tracks a monitor — and then its state,
 * its uptime and its thirty bars are the monitor's, nobody's to set — or it is
 * manual and a human moves it from the incidents. A tracked component that has
 * never been measured says so, with grey bars, rather than inventing a green.
 *
 * The other pages, the subscriber channels and the page's own settings sit in
 * the right-hand column; everything written here rewrites the snapshot the
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
      updatesCount: new Map<string, number>(),
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
    const updates = publicIncidents.length
      ? await tx
          .select({
            id: statusPageIncidentUpdates.statusPageIncidentId,
            n: sql<number>`count(*)`.mapWith(Number),
          })
          .from(statusPageIncidentUpdates)
          .where(
            inArray(
              statusPageIncidentUpdates.statusPageIncidentId,
              publicIncidents.map((i) => i.id),
            ),
          )
          .groupBy(statusPageIncidentUpdates.statusPageIncidentId)
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
    const [svcType] = await tx
      .select({ id: catalogTypes.id })
      .from(catalogTypes)
      .where(and(eq(catalogTypes.tenantId, tenant.id), eq(catalogTypes.key, "service")));
    const services = svcType
      ? await tx
          .select({ id: catalogEntries.id, name: catalogEntries.name })
          .from(catalogEntries)
          .where(eq(catalogEntries.typeId, svcType.id))
          .orderBy(asc(catalogEntries.name))
      : [];
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
      updatesCount: new Map(updates.map((u) => [u.id, u.n])),
      linked: new Map(linked.map((l) => [l.id, l.number])),
    };
  });
  const { page, snap } = data;

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
  const uptimeInk = (v: number | null) =>
    v === null ? "var(--ink-3)" : v >= 99.9 ? "var(--ok)" : v >= 99 ? "var(--wait)" : "var(--dang)";
  const localeName = (l: string) => t(`statusPages.locale.${l as "en" | "fr" | "de"}`);
  const hostOf = (p: {
    slug: string;
    customDomain: string | null;
    customDomainVerifiedAt: Date | null;
  }) => new URL(statusPageUrl(p)).host;

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
  const label: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--ink-3)",
  };
  const control: React.CSSProperties = {
    height: 32,
    padding: "0 10px",
    border: "1px solid var(--line)",
    borderRadius: 8,
    outline: "none",
    fontSize: 12.5,
    background: "var(--panel)",
    width: "100%",
  };
  const small: React.CSSProperties = {
    height: 26,
    padding: "0 10px",
    border: "1px solid var(--line)",
    borderRadius: 7,
    background: "var(--panel)",
    display: "inline-flex",
    alignItems: "center",
    fontSize: 11,
    cursor: "pointer",
    color: "inherit",
    textDecoration: "none",
  };
  const saveBtn: React.CSSProperties = {
    height: 30,
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "var(--panel)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "var(--ink-3)" }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{children}</span>
    </div>
  );
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
        {q.saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
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
          {q.imported !== undefined &&
            notice(t("statusPages.imported", { count: Number(q.imported) }))}
          {q.domain &&
            notice(
              q.domain === "verified"
                ? t("statusPages.domainOk")
                : q.domain === "pending"
                  ? t("statusPages.domainNotYet", {
                      target: `status.${(process.env.BASE_DOMAIN ?? "localhost").split(":")[0]}`,
                    })
                  : t("statusPages.domainCleared"),
              q.domain === "verified" || q.domain === "cleared",
            )}

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
                  : t("statusPages.noDomain")}{" "}
                · {localeName(page.locale)}
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
              <section style={panel}>
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
                  const svc = data.services.find((s) => s.id === row?.serviceEntryId);
                  const mon = data.monitors.find((m) => m.id === c.monitorId);
                  // The AUTO badge already says where the state comes from, so
                  // the line under the name spends itself on the source: the
                  // monitor, the catalog service, or the plain admission that
                  // a human sets this one from the incidents.
                  const source =
                    c.source === "monitor"
                      ? `${c.monitorName ?? ""}${mon ? ` ${mon.type}` : ""}`.trim()
                      : svc
                        ? svc.name
                        : t("sp2.manualSource");
                  return (
                    <div
                      key={c.id}
                      data-testid="component-row"
                      style={{
                        display: "grid",
                        gridTemplateColumns: acts
                          ? "minmax(150px,1fr) minmax(160px,2fr) 150px auto"
                          : "minmax(150px,1fr) minmax(200px,2fr) 150px",
                        gap: 14,
                        alignItems: "center",
                        padding: "11px 16px",
                        borderBottom: "1px solid var(--line-2)",
                      }}
                    >
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
                        {c.ticks.map((tk, k) => (
                          <span
                            key={k}
                            title={tk === "none" ? t("sp2.noData") : stateLabel(tk)}
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
                            color: uptimeInk(c.uptime90),
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
                      {acts && (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {c.source === "manual" && (
                            <form action={updateComponentState} style={{ display: "contents" }}>
                              <input type="hidden" name="id" value={c.id} />
                              <select
                                name="state"
                                defaultValue={c.state}
                                aria-label={t("sp2.stateLabel")}
                                className="oi-field"
                                style={{ ...control, width: 104, height: 26, fontSize: 11 }}
                              >
                                {(
                                  [
                                    "operational",
                                    "degraded",
                                    "partial_outage",
                                    "major_outage",
                                    "maintenance",
                                  ] as const
                                ).map((s) => (
                                  <option key={s} value={s}>
                                    {t(`statusPages.state.${s}`)}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                aria-label={t("common.apply")}
                                title={t("common.apply")}
                                className="oi-hover"
                                style={{
                                  ...small,
                                  width: 26,
                                  padding: 0,
                                  justifyContent: "center",
                                }}
                              >
                                ✓
                              </button>
                            </form>
                          )}
                          {manages && (
                            <form action={deleteComponent}>
                              <input type="hidden" name="id" value={c.id} />
                              <button
                                type="submit"
                                aria-label={t("common.delete")}
                                className="oi-hover-dang"
                                style={{
                                  ...small,
                                  color: "var(--dang)",
                                  width: 26,
                                  padding: 0,
                                  justifyContent: "center",
                                }}
                              >
                                ✕
                              </button>
                            </form>
                          )}
                        </div>
                      )}
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
                  const n = i.incidentId ? data.linked.get(i.incidentId) : null;
                  const resolvedIn = i.resolvedAt
                    ? Math.round((i.resolvedAt.getTime() - i.startedAt.getTime()) / 60_000)
                    : null;
                  return (
                    <div
                      key={i.id}
                      data-testid="public-incident"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "11px 16px",
                        borderBottom: "1px solid var(--line-2)",
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: i.status === "resolved" ? "var(--ok)" : "var(--wait)",
                          flex: "none",
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{i.title}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                          {t("statusPages.incidentMeta", {
                            date: t.fmt.dayMonth(i.startedAt),
                            count: data.updatesCount.get(i.id) ?? 0,
                          })}
                          {n ? (
                            <>
                              {" · "}
                              {t("statusPages.linkedTo")}{" "}
                              <Link
                                href={`/app/incidents/${n}`}
                                className="oi-link"
                                style={{ fontFamily: "var(--mono)", fontSize: 11 }}
                              >
                                INC-{n}
                              </Link>
                            </>
                          ) : null}
                          {resolvedIn !== null
                            ? ` · ${t("statusPages.resolvedIn", { duration: t.fmt.duration(resolvedIn) })}`
                            : ""}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: i.status === "resolved" ? "var(--ok)" : "var(--wait)",
                          background: i.status === "resolved" ? "var(--ok-t)" : "var(--wait-t)",
                          borderRadius: 999,
                          padding: "2px 9px",
                          flex: "none",
                        }}
                      >
                        {t(`statusPages.publicStatus.${i.status}`)}
                      </span>
                    </div>
                  );
                })}
                {data.maints.map((m) => (
                  <div
                    key={m.id}
                    data-testid="maintenance-row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "11px 16px",
                      borderBottom: "1px solid var(--line-2)",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "var(--viol)",
                        flex: "none",
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{m.title}</div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                        {t("statusPages.maintenanceMeta", {
                          date: t.fmt.dayMonth(m.startAt),
                          from: t.fmt.time(m.startAt),
                          to: t.fmt.time(m.endAt),
                        })}
                        {m.autoTransitions ? ` · ${t("statusPages.autoTransitions")}` : ""}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: m.status === "cancelled" ? "var(--ink-3)" : "var(--viol)",
                        background: m.status === "cancelled" ? "var(--sunk)" : "var(--viol-t)",
                        borderRadius: 999,
                        padding: "2px 9px",
                        flex: "none",
                      }}
                    >
                      {t(`statusPages.maintenanceStatus.${m.status}`)}
                    </span>
                    {acts && (m.status === "scheduled" || m.status === "in_progress") && (
                      <form action={cancelMaintenance}>
                        <input type="hidden" name="id" value={m.id} />
                        <button
                          type="submit"
                          className="oi-hover-dang"
                          style={{ ...small, color: "var(--dang)" }}
                        >
                          {t("common.cancel")}
                        </button>
                      </form>
                    )}
                  </div>
                ))}
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
                {member.role === "owner" && (
                  <form
                    action={importSubscribers}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      borderTop: "1px solid var(--line-2)",
                      paddingTop: 9,
                    }}
                  >
                    <input type="hidden" name="pageId" value={page.id} />
                    <input
                      name="file"
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      className="oi-field"
                      style={{ fontSize: 11.5 }}
                    />
                    <button type="submit" className="oi-hover" style={saveBtn}>
                      {t("statusPages.importCsv")}
                    </button>
                  </form>
                )}
              </section>

              {data.pages
                .filter((p) => p.id !== page.id)
                .map((p) => (
                  <section key={p.id} style={{ ...card, gap: 8 }}>
                    <div style={eyebrow}>
                      {p.visibility === "internal" ? t("sp2.internalPage") : t("sp2.publicPage")}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {p.visibility === "internal" ? t("sp2.ssoOnly") : t("sp2.visibilityPublic")} ·{" "}
                      {t("sp2.nComponents", { count: data.counts.get(p.id) ?? 0 })} ·{" "}
                      {localeName(p.locale)}
                    </div>
                    <Link
                      href={`/app/status-pages?page=${p.id}`}
                      className="oi-link"
                      style={{ fontSize: 12, fontWeight: 600 }}
                    >
                      {t("sp2.openPage")}
                    </Link>
                  </section>
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

              <section style={card}>
                <div style={eyebrow}>{t("statusPages.templates")}</div>
                {data.templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    data-testid="template-row"
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        flex: "none",
                        background:
                          tpl.status === "resolved"
                            ? "var(--ok)"
                            : tpl.status === "monitoring"
                              ? "var(--wait)"
                              : tpl.status === "identified"
                                ? "var(--viol)"
                                : "var(--dang)",
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={tpl.body}
                    >
                      {tpl.name}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      {tpl.approved ? t("statusPages.approved") : t("statusPages.draft")}
                    </span>
                    {manages && (
                      <form action={deleteTemplate}>
                        <input type="hidden" name="id" value={tpl.id} />
                        <button
                          type="submit"
                          aria-label={t("common.delete")}
                          className="oi-hover-dang"
                          style={{
                            width: 22,
                            height: 22,
                            border: 0,
                            borderRadius: 6,
                            background: "transparent",
                            color: "var(--ink-3)",
                            cursor: "pointer",
                            fontSize: 11,
                          }}
                        >
                          ✕
                        </button>
                      </form>
                    )}
                  </div>
                ))}
                {manages && (
                  <form
                    action={saveTemplate}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      borderTop: "1px solid var(--line-2)",
                      paddingTop: 9,
                    }}
                  >
                    <input type="hidden" name="pageId" value={page.id} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 6 }}>
                      <input
                        name="name"
                        required
                        placeholder={t("statusPages.templateName")}
                        className="oi-field"
                        style={control}
                      />
                      <select
                        name="status"
                        defaultValue="investigating"
                        className="oi-field"
                        style={control}
                      >
                        {(["investigating", "identified", "monitoring", "resolved"] as const).map(
                          (s) => (
                            <option key={s} value={s}>
                              {t(`statusPages.publicStatus.${s}`)}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                    <textarea
                      name="body"
                      required
                      rows={2}
                      placeholder={t("statusPages.templateBody")}
                      className="oi-field"
                      style={{
                        ...control,
                        height: "auto",
                        padding: "8px 10px",
                        resize: "vertical",
                      }}
                    />
                    <button type="submit" className="oi-hover" style={saveBtn}>
                      {t("statusPages.addTemplate")}
                    </button>
                  </form>
                )}
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  {t("statusPages.templatesNote")}
                </div>
              </section>

              <form action={saveStatusPage} style={card} data-testid="brand-form">
                <input type="hidden" name="id" value={page.id} />
                <div style={eyebrow}>{t("statusPages.brand")}</div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={label}>{t("oncall.name")}</span>
                  <input
                    name="name"
                    defaultValue={page.name}
                    required
                    className="oi-field"
                    style={control}
                    readOnly={!manages}
                  />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={label}>{t("statusPages.accent")}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 5,
                          background: page.accentColor,
                          flex: "none",
                        }}
                      />
                      <input
                        name="accentColor"
                        defaultValue={page.accentColor}
                        pattern="#[0-9a-fA-F]{6}"
                        className="oi-field"
                        style={{ ...control, fontFamily: "var(--mono)", fontSize: 12 }}
                        readOnly={!manages}
                      />
                    </div>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={label}>{t("statusPages.language")}</span>
                    <select
                      name="locale"
                      defaultValue={page.locale}
                      className="oi-field"
                      style={control}
                      disabled={!manages}
                    >
                      {(["en", "fr", "de"] as const).map((l) => (
                        <option key={l} value={l}>
                          {localeName(l)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={label}>{t("statusPages.threshold")}</span>
                  <select
                    name="minSeverityRank"
                    defaultValue={String(page.minSeverityRank)}
                    className="oi-field"
                    style={control}
                    disabled={!manages}
                  >
                    {[0, 1, 2, 3].map((r) => (
                      <option key={r} value={r}>
                        {t("statusPages.thresholdOption", { severity: `SEV${r + 1}` })}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={label}>{t("statusPages.visibility")}</span>
                  <select
                    name="visibility"
                    defaultValue={page.visibility}
                    disabled={!manages}
                    data-testid="status-visibility"
                    className="oi-field"
                    style={control}
                  >
                    <option value="public">{t("statusPages.visibilityPublic")}</option>
                    <option value="internal">{t("statusPages.visibilityInternal")}</option>
                  </select>
                  <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
                    {t("statusPages.visibilityHint")}
                  </span>
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: "var(--ink-2)",
                  }}
                >
                  <input
                    type="checkbox"
                    name="noindex"
                    defaultChecked={page.noindex}
                    disabled={!manages}
                  />{" "}
                  {t("statusPages.noindex")}
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input
                    name="privacyUrl"
                    type="url"
                    defaultValue={page.privacyUrl ?? ""}
                    placeholder={t("statusPages.privacyUrl")}
                    className="oi-field"
                    style={{ ...control, fontSize: 11.5 }}
                    readOnly={!manages}
                  />
                  <input
                    name="legalUrl"
                    type="url"
                    defaultValue={page.legalUrl ?? ""}
                    placeholder={t("statusPages.legalUrl")}
                    className="oi-field"
                    style={{ ...control, fontSize: 11.5 }}
                    readOnly={!manages}
                  />
                </div>
                <input
                  name="replyTo"
                  type="email"
                  defaultValue={page.replyTo ?? ""}
                  placeholder={t("statusPages.replyTo")}
                  className="oi-field"
                  style={{ ...control, fontSize: 11.5 }}
                  readOnly={!manages}
                />
                {manages && (
                  <button type="submit" className="oi-hover" style={saveBtn}>
                    {t("common.save")}
                  </button>
                )}
              </form>

              <form action={saveCustomDomain} style={card} data-testid="domain-form">
                <input type="hidden" name="id" value={page.id} />
                <div style={eyebrow}>{t("statusPages.domain")}</div>
                <Row k={t("statusPages.address")}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>{hostOf(page)}</span>
                </Row>
                <Row k={t("statusPages.customDomain")}>
                  {page.customDomain ? (
                    <span
                      style={{ color: page.customDomainVerifiedAt ? "var(--ok)" : "var(--wait)" }}
                    >
                      {page.customDomainVerifiedAt
                        ? t("statusPages.verifiedTls")
                        : t("statusPages.pendingDns")}
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
                <input
                  name="customDomain"
                  defaultValue={page.customDomain ?? ""}
                  placeholder="status.example.com"
                  className="oi-field"
                  style={{ ...control, fontFamily: "var(--mono)", fontSize: 12 }}
                  readOnly={!manages}
                />
                <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  {t("statusPages.domainNote", {
                    target: `status.${(process.env.BASE_DOMAIN ?? "localhost").split(":")[0]}`,
                  })}
                </div>
                <Row k={t("statusPages.indexing")}>
                  {page.noindex ? t("statusPages.noindexBefore") : t("statusPages.indexed")}
                </Row>
                {manages && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="submit" className="oi-hover" style={{ ...saveBtn, flex: 1 }}>
                      {t("statusPages.verifyDomain")}
                    </button>
                    <button
                      type="submit"
                      formAction={deleteStatusPage}
                      formNoValidate
                      className="oi-hover-dang"
                      style={{ ...saveBtn, padding: "0 10px", color: "var(--dang)" }}
                    >
                      {t("statusPages.deletePage")}
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
