import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { alertRoutes, alertSources, alerts, escalationPaths, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { alertingSetupStatus, quickTargets, sourceHealth } from "@/lib/alerting-setup";
import { describeRoute } from "@/lib/route-summary";
import { SOURCE_KINDS } from "@/lib/alert-sources";
import { IntegrationIcon } from "../integrations/icons";
import { testSource } from "../alert-sources/actions";
import { pageMe, pageMember, pageSchedule, useExistingPath } from "./actions";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 13,
  boxShadow: "var(--shadow-card)",
};
const btn: React.CSSProperties = {
  height: 32,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "var(--brand)",
  borderColor: "var(--brand)",
  color: "#fff",
  fontWeight: 600,
};
const select: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12.5,
  maxWidth: 260,
};
const muted: React.CSSProperties = { fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 };

/**
 * Alert configuration — the one screen that says where the alerting stands
 * and gets a workspace from nothing to "an alert paged someone" in four
 * steps: who to page, a source, a first alert, the proof it was routed. Then
 * the overview: sources with their health, the routes in their order.
 */
export default async function AlertingPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; setup?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { saved, setup } = await searchParams;
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => {
    const status = await alertingSetupStatus(tx, tenant.id);
    const sources = await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenant.id), eq(alertSources.managed, false)))
      .orderBy(alertSources.name);
    const health = await sourceHealth(tx, tenant.id);
    const routes = await tx
      .select()
      .from(alertRoutes)
      .where(eq(alertRoutes.tenantId, tenant.id))
      .orderBy(alertRoutes.position, alertRoutes.createdAt);
    const paths = await tx
      .select({
        id: escalationPaths.id,
        name: escalationPaths.name,
        current: escalationPaths.currentVersionId,
      })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenant.id))
      .orderBy(escalationPaths.name);
    const targets = await quickTargets(tx, tenant.id);
    const recent = await tx
      .select({
        id: alerts.id,
        title: alerts.title,
        lastAt: alerts.lastAt,
        escalationId: alerts.escalationId,
        incidentId: alerts.incidentId,
        testMode: alerts.testMode,
      })
      .from(alerts)
      .where(eq(alerts.tenantId, tenant.id))
      .orderBy(desc(alerts.lastAt))
      .limit(5);
    const [openCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(alerts)
      .where(and(eq(alerts.tenantId, tenant.id), eq(alerts.status, "firing")));
    return { status, sources, health, routes, paths, targets, recent, open: openCount?.n ?? 0 };
  });
  const { status } = data;
  const showSetup = !status.complete || setup === "1";
  const pathName = (id: string | null) => data.paths.find((p) => p.id === id)?.name ?? null;
  const pagingPaths = new Set<string>();
  for (const r of data.routes)
    for (const e of r.escalations) {
      if (e.kind === "path") pagingPaths.add(e.pathId);
      else if (e.fallbackPathId) pagingPaths.add(e.fallbackPathId);
    }

  const step = (
    n: number,
    done: boolean,
    title: string,
    body: string,
    children: React.ReactNode,
    testId: string,
  ) => (
    <div
      data-testid={testId}
      data-done={done ? "1" : "0"}
      style={{
        display: "flex",
        gap: 14,
        padding: "14px 18px",
        borderTop: n === 1 ? 0 : "1px solid var(--line-2)",
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          flex: "none",
          display: "grid",
          placeItems: "center",
          fontSize: 11.5,
          fontWeight: 700,
          background: done ? "var(--ok)" : "var(--sunk)",
          color: done ? "#fff" : "var(--ink-2)",
          border: done ? 0 : "1px solid var(--line)",
        }}
      >
        {done ? "✓" : n}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{ fontSize: 13.5, fontWeight: 600, color: done ? "var(--ink-2)" : "var(--ink)" }}
        >
          {title}
        </div>
        <p style={{ ...muted, margin: 0 }}>{body}</p>
        {children}
      </div>
    </div>
  );

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("setup.title")}
        </h1>
        <span style={muted}>{t("setup.subtitle")}</span>
        <span style={{ flex: 1 }} />
        {saved && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {saved === "pager" ? t("setup.savedPager") : t("common.saved")}
          </span>
        )}
        {status.complete && !showSetup && (
          <Link
            href="/app/settings/alerting?setup=1"
            className="oi-link"
            style={{ fontSize: 12.5 }}
          >
            {t("setup.showSteps")}
          </Link>
        )}
      </div>

      {showSetup && (
        <section style={card} data-testid="setup-checklist">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 18px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("setup.checklist")}</span>
            <span style={muted}>{t("setup.checklistNote")}</span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: status.complete ? "var(--ok)" : "var(--ink-2)",
              }}
            >
              {
                [
                  status.steps.pager,
                  status.steps.source,
                  status.steps.firstAlert,
                  status.steps.verified,
                ].filter(Boolean).length
              }
              /4
            </span>
          </div>

          {step(
            1,
            status.steps.pager,
            t("setup.step.pager"),
            t("setup.step.pagerBody"),
            status.steps.pager ? (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: "var(--ok)", fontWeight: 600 }}>
                  {t("setup.step.pagerDone", {
                    paths: [...pagingPaths].map(pathName).filter(Boolean).join(", ") || "—",
                  })}
                </span>
                <Link href="/app/settings/alert-routes" className="oi-link">
                  {t("setup.step.changeRoutes")}
                </Link>
              </div>
            ) : manages ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <form action={pageMe}>
                  <button type="submit" style={btnPrimary} data-testid="setup-page-me">
                    {t("setup.pageMe")}
                  </button>
                </form>
                {data.targets.schedules.length > 0 && (
                  <form
                    action={pageSchedule}
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <select name="scheduleId" style={select} defaultValue="">
                      <option value="" disabled>
                        {t("setup.pageSchedule")}
                      </option>
                      {data.targets.schedules.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" style={btn}>
                      {t("common.apply")}
                    </button>
                  </form>
                )}
                <form action={pageMember} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select name="memberId" style={select} defaultValue="">
                    <option value="" disabled>
                      {t("setup.pageSomeone")}
                    </option>
                    {data.targets.people
                      .filter((p) => p.id !== member.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <button type="submit" style={btn}>
                    {t("common.apply")}
                  </button>
                </form>
                {data.paths.filter((p) => p.current).length > 0 && (
                  <form
                    action={useExistingPath}
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <select name="pathId" style={select} defaultValue="">
                      <option value="" disabled>
                        {t("setup.useExistingPath")}
                      </option>
                      {data.paths
                        .filter((p) => p.current)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                    <button type="submit" style={btn}>
                      {t("common.apply")}
                    </button>
                  </form>
                )}
                <Link href="/app/on-call/paths" className="oi-link" style={{ fontSize: 12.5 }}>
                  {t("setup.buildPath")}
                </Link>
              </div>
            ) : (
              <span style={muted}>{t("setup.managersOnly")}</span>
            ),
            "setup-step-pager",
          )}

          {step(
            2,
            status.steps.source,
            t("setup.step.source"),
            t("setup.step.sourceBody"),
            status.steps.source ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {data.sources.slice(0, 8).map((s) => (
                  <Link
                    key={s.id}
                    href={`/app/settings/alert-sources/${s.id}`}
                    style={{ ...btn, height: 28, fontSize: 12 }}
                  >
                    <IntegrationIcon id={s.kind === "http" ? "webhook" : s.kind} />
                    {s.name}
                  </Link>
                ))}
                {data.sources.length > 8 && (
                  <Link
                    href="/app/settings/alert-sources"
                    className="oi-link"
                    style={{ fontSize: 12.5 }}
                  >
                    {t("setup.moreSources", { count: data.sources.length - 8 })}
                  </Link>
                )}
                {manages && (
                  <Link
                    href="/app/settings/alert-sources?new=1"
                    className="oi-link"
                    style={{ fontSize: 12.5 }}
                  >
                    {t("setup.addSource")}
                  </Link>
                )}
              </div>
            ) : manages ? (
              <div>
                <Link
                  href="/app/settings/alert-sources?new=1"
                  style={btnPrimary}
                  data-testid="setup-connect-source"
                >
                  {t("setup.connectSource")}
                </Link>
              </div>
            ) : null,
            "setup-step-source",
          )}

          {step(
            3,
            status.steps.firstAlert,
            t("setup.step.firstAlert"),
            t("setup.step.firstAlertBody"),
            status.steps.firstAlert ? (
              <span style={{ fontSize: 12.5, color: "var(--ok)", fontWeight: 600 }}>
                {t("setup.step.firstAlertDone", {
                  when: status.alerts.lastAt ? t.fmt.relative(status.alerts.lastAt) : "—",
                })}
              </span>
            ) : data.sources.length > 0 && manages ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {data.sources.slice(0, 4).map((s) => (
                  <form key={s.id} action={testSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="back" value="alerting" />
                    <button type="submit" style={btn} data-testid="setup-test-source">
                      {t("setup.sendTest", { name: s.name })}
                    </button>
                  </form>
                ))}
                <Link
                  href={`/app/settings/alert-sources/${data.sources[0]!.id}`}
                  className="oi-link"
                  style={{ fontSize: 12.5 }}
                >
                  {t("setup.realPayload")}
                </Link>
              </div>
            ) : (
              <span style={muted}>{t("setup.step.firstAlertWaiting")}</span>
            ),
            "setup-step-first-alert",
          )}

          {step(
            4,
            status.steps.verified,
            t("setup.step.verified"),
            t("setup.step.verifiedBody"),
            status.steps.verified ? (
              <Link href="/app/alerts" className="oi-link" style={{ fontSize: 12.5 }}>
                {t("setup.step.verifiedDone")}
              </Link>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {data.recent.slice(0, 3).map((a) => (
                  <Link
                    key={a.id}
                    href={`/app/alerts/${a.id}`}
                    className="oi-link"
                    style={{ fontSize: 12.5 }}
                  >
                    {a.title} · {t.fmt.relative(a.lastAt)}
                    {a.testMode ? ` · ${t("alerts.testMode")}` : ""}
                    {a.escalationId ? ` · ${t("setup.paged")}` : ""}
                  </Link>
                ))}
                {data.recent.length === 0 && (
                  <span style={muted}>{t("setup.step.verifiedWaiting")}</span>
                )}
                {data.sources.length > 0 && (
                  <Link
                    href={`/app/settings/alert-sources/${data.sources[0]!.id}#preview`}
                    className="oi-link"
                    style={{ fontSize: 12.5 }}
                  >
                    {t("setup.previewPayload")}
                  </Link>
                )}
              </div>
            ),
            "setup-step-verified",
          )}
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
        {[
          [
            t("setup.tile.sources"),
            String(status.sources.count),
            status.sources.lastAlertAt
              ? t("setup.tile.lastAlert", { when: t.fmt.relative(status.sources.lastAlertAt) })
              : t("setup.tile.noAlert"),
            "/app/settings/alert-sources",
          ],
          [
            t("setup.tile.routes"),
            String(status.routes.count),
            status.routes.paging ? t("setup.tile.paging") : t("setup.tile.notPaging"),
            "/app/settings/alert-routes",
          ],
          [
            t("setup.tile.paths"),
            `${status.paths.published}/${status.paths.count}`,
            t("setup.tile.published"),
            "/app/on-call/paths",
          ],
          [
            t("setup.tile.priorities"),
            String(status.priorities),
            t("setup.tile.prioritiesNote"),
            "/app/settings/alert-priorities",
          ],
          [
            t("setup.tile.attributes"),
            String(status.attributes),
            t("setup.tile.attributesNote"),
            "/app/settings/alert-attributes",
          ],
        ].map(([label, value, note, href]) => (
          <Link
            key={label}
            href={href!}
            className="oi-hover"
            style={{ ...card, padding: "12px 14px", textDecoration: "none", color: "inherit" }}
          >
            <div className="oi-eyebrow">{label}</div>
            <div
              style={{
                fontFamily: "var(--font-title)",
                fontSize: 20,
                fontWeight: 600,
                marginTop: 2,
              }}
            >
              {value}
            </div>
            <div style={{ ...muted, fontSize: 11.5 }}>{note}</div>
          </Link>
        ))}
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}
      >
        <section style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("setup.sources")}</span>
            <span style={{ flex: 1 }} />
            <Link href="/app/settings/alert-sources" className="oi-link" style={{ fontSize: 12.5 }}>
              {t("common.seeAll")}
            </Link>
          </div>
          {data.sources.length === 0 && (
            <div style={{ padding: "14px 16px", ...muted }}>{t("settings.sources.empty")}</div>
          )}
          {data.sources.map((s) => {
            const h = data.health.get(s.id);
            const meta = SOURCE_KINDS.find((k) => k.kind === s.kind);
            return (
              <Link
                key={s.id}
                href={`/app/settings/alert-sources/${s.id}`}
                className="oi-hover"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--line-2)",
                  textDecoration: "none",
                  color: "inherit",
                  fontSize: 13,
                }}
              >
                <IntegrationIcon id={s.kind === "http" ? "webhook" : s.kind} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span style={{ display: "block", ...muted, fontSize: 11.5 }}>
                    {meta?.label ?? s.kind}
                    {s.lastAlertAt
                      ? ` · ${t("setup.tile.lastAlert", { when: t.fmt.relative(s.lastAlertAt) })}`
                      : ` · ${t("setup.tile.noAlert")}`}
                  </span>
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: h?.firing ? "var(--dang)" : "var(--ink-3)",
                  }}
                >
                  {h ? t("setup.health", { day: h.day, firing: h.firing }) : t("setup.healthNone")}
                </span>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: !s.active
                      ? "var(--ink-3)"
                      : s.lastAlertAt
                        ? "var(--ok)"
                        : "var(--wait)",
                  }}
                />
              </Link>
            );
          })}
        </section>
        <section style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("setup.routes")}</span>
            <span style={muted}>{t("setup.routesNote")}</span>
            <span style={{ flex: 1 }} />
            <Link href="/app/settings/alert-routes" className="oi-link" style={{ fontSize: 12.5 }}>
              {t("common.seeAll")}
            </Link>
          </div>
          {data.routes.map((r, i) => {
            const d = describeRoute(r, t, { paths: data.paths, sources: data.sources });
            return (
              <Link
                key={r.id}
                href={`/app/settings/alert-routes/${r.id}`}
                className="oi-hover"
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--line-2)",
                  textDecoration: "none",
                  color: "inherit",
                  fontSize: 13,
                  opacity: r.active ? 1 : 0.55,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--ink-3)",
                    width: 18,
                    textAlign: "right",
                    paddingTop: 2,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                  {r.testMode && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: "var(--wait)",
                      }}
                    >
                      {t("settings.routes.testMode")}
                    </span>
                  )}
                  <span style={{ display: "block", ...muted, fontSize: 11.5 }}>
                    {d.when} → {d.then}
                  </span>
                </span>
                <span
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-3)" }}
                >
                  {r.alertCount}
                </span>
              </Link>
            );
          })}
        </section>
      </div>
      <p style={muted}>
        {t("setup.openAlerts", { count: data.open })} ·{" "}
        <Link href="/app/alerts" className="oi-link">
          {t("nav.alerts")}
        </Link>
      </p>
    </div>
  );
}
