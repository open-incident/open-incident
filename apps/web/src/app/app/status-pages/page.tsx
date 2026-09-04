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
  withTenant,
} from "@openincident/db";
import { buildSnapshot, statusPageUrl } from "@openincident/statuspages";
import { isManagerRole } from "@openincident/config";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
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

const TICK: Record<string, string> = {
  operational: "var(--ok)",
  maintenance: "var(--viol)",
  degraded: "var(--wait)",
  partial_outage: "var(--wait)",
  major_outage: "var(--dang)",
};

/**
 * Status pages — the design's screen: pages in the rail, the selected page's
 * components with their 30-day bars and uptime, recent public incidents and
 * maintenances, and on the right subscribers, message templates, brand and
 * domain. Everything here writes the projection the public app serves.
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
    if (!page)
      return {
        pages,
        page: null,
        snap: null,
        comps: [],
        publicIncidents: [],
        maints: [],
        templates: [],
        subs: 0,
        services: [],
        updatesCount: new Map<string, number>(),
        linked: new Map<string, number>(),
      };
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
      pages,
      page,
      snap,
      comps,
      publicIncidents,
      maints,
      templates,
      subs: subs?.n ?? 0,
      services,
      updatesCount: new Map(updates.map((u) => [u.id, u.n])),
      linked: new Map(linked.map((l) => [l.id, l.number])),
    };
  });
  const { page, snap } = data;
  const overallTone = (s: string) =>
    s === "operational"
      ? ["var(--ok-t)", "var(--ok)"]
      : s === "major_outage"
        ? ["var(--dang-t)", "var(--dang)"]
        : s === "maintenance"
          ? ["var(--viol-t)", "var(--viol)"]
          : ["var(--wait-t)", "var(--wait)"];
  const ghost: React.CSSProperties = {
    height: 34,
    padding: "0 13px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    background: "var(--panel)",
    display: "inline-flex",
    alignItems: "center",
    fontSize: 13,
    fontWeight: 500,
    color: "inherit",
    textDecoration: "none",
    cursor: "pointer",
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
  const card: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 9,
  };
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".1em",
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
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--ink-3)" }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{children}</span>
    </div>
  );
  const localeName = (l: string) => t(`statusPages.locale.${l as "en" | "fr" | "de"}`);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <nav
        aria-label={t("statusPages.railLabel")}
        style={{
          width: 232,
          flex: "none",
          background: "var(--panel)",
          borderRight: "1px solid var(--line)",
          padding: "16px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflow: "auto",
        }}
      >
        <div className="oi-eyebrow" style={{ padding: "0 10px 8px" }}>
          {t("statusPages.pages")}
        </div>
        {data.pages.map((p) => {
          const on = p.id === page?.id;
          return (
            <div key={p.id}>
              <Link
                href={`/app/status-pages?page=${p.id}`}
                className={on ? undefined : "oi-hover"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 10px",
                  borderRadius: 9,
                  background: on ? "var(--brand-t)" : "transparent",
                  color: on ? "var(--brand)" : "var(--ink-2)",
                  fontWeight: on ? 600 : 450,
                  fontSize: 13.5,
                  textDecoration: "none",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    background: p.accentColor,
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 9,
                    fontWeight: 700,
                    flex: "none",
                  }}
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.name}
                </span>
                <span
                  style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ok)" }}
                />
              </Link>
              <div
                style={{
                  padding: "2px 10px 6px",
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  fontFamily: "var(--font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {new URL(statusPageUrl(p)).host}
              </div>
            </div>
          );
        })}
        {manages && <NewPageDialog defaultAccent="#0B4A6F" />}
        <div
          style={{
            marginTop: 8,
            padding: "10px 12px",
            background: "var(--sunk)",
            borderRadius: 12,
            fontSize: 12,
            color: "var(--ink-3)",
            lineHeight: 1.5,
          }}
        >
          {t("statusPages.v2Note")}
        </div>
      </nav>

      <main style={{ flex: 1, minWidth: 0, padding: "16px 20px 24px", overflow: "auto" }}>
        {!page || !snap ? (
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
            {t("statusPages.empty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 className="oi-title" style={{ margin: 0 }}>
                {page.name}
              </h1>
              {(() => {
                const tone = overallTone(snap.overall);
                return (
                  <span
                    data-testid="page-overall"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 11px 3px 9px",
                      borderRadius: 999,
                      background: tone[0],
                      color: tone[1],
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "currentColor",
                      }}
                    />
                    {t(`statusPages.overall.${snap.overall as "operational"}`)}
                  </span>
                );
              })()}
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {page.customDomain
                  ? page.customDomainVerifiedAt
                    ? t("statusPages.domainVerified")
                    : t("statusPages.domainPending")
                  : t("statusPages.noDomain")}{" "}
                · {localeName(page.locale)}
              </span>
              <span style={{ flex: 1 }} />
              {q.saved === "1" && (
                <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
                  {t("common.saved")}
                </span>
              )}
              {q.error && (
                <span
                  role="alert"
                  style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}
                >
                  {q.error === "slug"
                    ? t("statusPages.errorSlug")
                    : q.error === "owner"
                      ? t("statusPages.errorOwner")
                      : t("settings.fields.errorInvalid")}
                </span>
              )}
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
                style={{ ...ghost, fontWeight: 600, color: "var(--brand)" }}
              >
                {t("statusPages.viewPublic")}
              </a>
              {acts && (
                <MaintenanceDialog
                  pageId={page.id}
                  components={data.comps.map((c) => ({ id: c.id, name: c.name }))}
                />
              )}
            </div>
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
                <span
                  style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }}
                />
                {t("statusPages.createdNote", { url: statusPageUrl(page) })}
              </div>
            )}
            {q.maintenance === "1" && (
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
                <span
                  style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }}
                />
                {t("statusPages.maintenanceScheduled")}
              </div>
            )}
            {q.imported && (
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
                <span
                  style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }}
                />
                {t("statusPages.imported", { count: Number(q.imported) })}
              </div>
            )}
            {q.domain && (
              <div
                role="status"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: q.domain === "verified" ? "var(--ok-t)" : "var(--note)",
                  border: `1px solid ${q.domain === "verified" ? "var(--ok)" : "var(--note-b)"}`,
                  borderRadius: 12,
                  padding: "10px 14px",
                  fontSize: 13,
                  color: "var(--ink-2)",
                }}
              >
                {q.domain === "verified"
                  ? t("statusPages.domainOk")
                  : q.domain === "pending"
                    ? t("statusPages.domainNotYet", {
                        target: `status.${(process.env.BASE_DOMAIN ?? "localhost").split(":")[0]}`,
                      })
                    : t("statusPages.domainCleared")}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
              <div
                style={{
                  flex: "10 1 460px",
                  minWidth: 420,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <section className="oi-panel">
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
                      {t("statusPages.components")}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {t("statusPages.componentsNote")}
                    </span>
                    <span style={{ flex: 1 }} />
                    {manages && <NewComponentDialog pageId={page.id} services={data.services} />}
                  </div>
                  {snap.components.map((c, i) => {
                    const row = data.comps.find((x) => x.id === c.id);
                    const svc = data.services.find((s) => s.id === row?.serviceEntryId);
                    return (
                      <div
                        key={c.id}
                        data-testid="component-row"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(110px, 1fr) minmax(120px, 2fr) 84px auto",
                          gap: 14,
                          alignItems: "center",
                          padding: "11px 18px",
                          borderBottom:
                            i < snap.components.length - 1 ? "1px solid var(--line-2)" : undefined,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</div>
                          <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                            {svc ? (
                              <>
                                ↳ <span style={{ fontFamily: "var(--font-mono)" }}>{svc.name}</span>{" "}
                                · {t("statusPages.catalog")}
                              </>
                            ) : (
                              t("statusPages.noService")
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 2, alignItems: "flex-end" }}>
                          {c.ticks.map((tk, k) => (
                            <span
                              key={k}
                              title={t(`statusPages.state.${tk as "operational"}`)}
                              style={{
                                flex: 1,
                                height: 16,
                                borderRadius: 2,
                                background: TICK[tk] ?? "var(--ok)",
                              }}
                            />
                          ))}
                        </div>
                        <div style={{ fontVariantNumeric: "tabular-nums" }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 700,
                              color:
                                c.uptime90 >= 99.9
                                  ? "var(--ok)"
                                  : c.uptime90 >= 99
                                    ? "var(--wait)"
                                    : "var(--dang)",
                            }}
                          >
                            {c.uptime90.toFixed(2)} %
                          </span>
                          <span style={{ fontSize: 11, color: "var(--ink-3)" }}> · 90 j</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {acts && (
                            <form action={updateComponentState} style={{ display: "contents" }}>
                              <input type="hidden" name="id" value={c.id} />
                              <select
                                name="state"
                                defaultValue={c.state}
                                className="oi-field"
                                style={{ ...control, width: 104, height: 28, fontSize: 11 }}
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
                      </div>
                    );
                  })}
                  {snap.components.length === 0 && (
                    <div style={{ padding: 16, fontSize: 12.5, color: "var(--ink-3)" }}>
                      {t("statusPages.noComponents")}
                    </div>
                  )}
                </section>

                <section className="oi-panel">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "12px 18px",
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{t("statusPages.recent")}</span>
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
                          padding: "12px 18px",
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
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{i.title}</div>
                          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
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
                                  style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}
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
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "3px 10px 3px 8px",
                            borderRadius: 999,
                            background: i.status === "resolved" ? "var(--ok-t)" : "var(--wait-t)",
                            color: i.status === "resolved" ? "var(--ok)" : "var(--wait)",
                            fontSize: 11.5,
                            fontWeight: 600,
                          }}
                        >
                          <span
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: "50%",
                              background: "currentColor",
                            }}
                          />
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
                        padding: "12px 18px",
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
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.title}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
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
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "3px 10px 3px 8px",
                          borderRadius: 999,
                          background: m.status === "in_progress" ? "var(--viol-t)" : "var(--sunk)",
                          color: m.status === "in_progress" ? "var(--viol)" : "var(--ink-2)",
                          fontSize: 11.5,
                          fontWeight: 600,
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: "50%",
                            background: "currentColor",
                          }}
                        />
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
                <div
                  style={{
                    background: "var(--sunk)",
                    borderRadius: 14,
                    padding: "13px 16px",
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    lineHeight: 1.55,
                  }}
                >
                  {t("statusPages.isolationNote")}
                </div>
              </div>

              <div
                style={{
                  flex: "1 1 280px",
                  maxWidth: 340,
                  minWidth: 260,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <section style={card}>
                  <div className="oi-eyebrow">{t("statusPages.subscribers")}</div>
                  <Row k={t("statusPages.emailOptin")}>{data.subs}</Row>
                  <Row k="RSS / Atom">{page.feedHits}</Row>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {t("statusPages.subscribersNote")}
                  </div>
                  {member.role === "owner" && (
                    <form
                      action={importSubscribers}
                      style={{ display: "flex", flexDirection: "column", gap: 6 }}
                    >
                      <input type="hidden" name="pageId" value={page.id} />
                      <input
                        name="file"
                        type="file"
                        accept=".csv,text/csv,text/plain"
                        className="oi-field"
                        style={{ fontSize: 11.5 }}
                      />
                      <button
                        type="submit"
                        className="oi-hover"
                        style={{
                          height: 32,
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          fontSize: 12.5,
                          fontWeight: 500,
                          cursor: "pointer",
                        }}
                      >
                        {t("statusPages.importCsv")}
                      </button>
                    </form>
                  )}
                </section>
                <section style={card}>
                  <div className="oi-eyebrow">{t("statusPages.templates")}</div>
                  {data.templates.map((tpl) => (
                    <div
                      key={tpl.id}
                      data-testid="template-row"
                      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
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
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
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
                        paddingTop: 8,
                      }}
                    >
                      <input type="hidden" name="pageId" value={page.id} />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 6 }}>
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
                      <button
                        type="submit"
                        className="oi-hover"
                        style={{
                          height: 30,
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {t("statusPages.addTemplate")}
                      </button>
                    </form>
                  )}
                  <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                    {t("statusPages.templatesNote")}
                  </div>
                </section>
                <form action={saveStatusPage} style={card} data-testid="brand-form">
                  <input type="hidden" name="id" value={page.id} />
                  <div className="oi-eyebrow">{t("statusPages.brand")}</div>
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
                          style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
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
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                    <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                      {t("statusPages.visibilityHint")}
                    </span>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12.5,
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
                    <button
                      type="submit"
                      className="oi-hover"
                      style={{
                        height: 30,
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        background: "var(--panel)",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {t("common.save")}
                    </button>
                  )}
                </form>
                <form action={saveCustomDomain} style={card} data-testid="domain-form">
                  <input type="hidden" name="id" value={page.id} />
                  <div className="oi-eyebrow">{t("statusPages.domain")}</div>
                  <Row k={t("statusPages.address")}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
                      {new URL(statusPageUrl(page)).host}
                    </span>
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
                    style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                    readOnly={!manages}
                  />
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                    {t("statusPages.domainNote", {
                      target: `status.${(process.env.BASE_DOMAIN ?? "localhost").split(":")[0]}`,
                    })}
                  </div>
                  <Row k={t("statusPages.indexing")}>
                    {page.noindex ? t("statusPages.noindexBefore") : t("statusPages.indexed")}
                  </Row>
                  {manages && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="submit"
                        className="oi-hover"
                        style={{
                          flex: 1,
                          height: 30,
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {t("statusPages.verifyDomain")}
                      </button>
                      <button
                        type="submit"
                        formAction={deleteStatusPage}
                        formNoValidate
                        className="oi-hover-dang"
                        style={{
                          height: 30,
                          padding: "0 10px",
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          fontSize: 12,
                          color: "var(--dang)",
                          cursor: "pointer",
                        }}
                      >
                        {t("statusPages.deletePage")}
                      </button>
                    </div>
                  )}
                </form>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
