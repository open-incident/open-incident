import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { escalationPaths, withTenant } from "@openincident/db";
import { aiConfigured, runbooksForService } from "@openincident/ai";
import { getT } from "@/i18n/server";
import { canRespond, isManager, requireMember } from "@/lib/session";
import { getService, listTeams } from "@/lib/services";
import { telemetryInstalled } from "@/lib/telemetry-module";
import {
  assignOwner,
  createRunbook,
  deleteRunbook,
  refreshRunbookAction,
  setTeamPolicy,
} from "../actions";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "13px 15px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const RUNBOOK_BTN: React.CSSProperties = {
  height: 24,
  padding: "0 8px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--panel)",
  fontSize: 11,
  cursor: "pointer",
};

const RUNBOOK_FIELD: React.CSSProperties = {
  height: 30,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 12.5,
  background: "var(--panel)",
  outline: "none",
};

const EYEBROW: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--ink-3)",
};

/**
 * One service: who owns it, what watches it, what broke, and what Atlas knows.
 *
 * The dependency card is the honest one: without traces the product does not
 * know what calls what, and says so rather than drawing a graph it invented.
 */
export default async function ServiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  const { error } = await searchParams;

  const data = await withTenant(tenant.id, async (tx) => {
    const svc = await getService(tx, tenant.id, id);
    if (!svc) return null;
    // The policies on offer, for the case where the owner team has none: the
    // chain has to be completable where the reader notices it is broken.
    const paths = await tx
      .select({ id: escalationPaths.id, name: escalationPaths.name })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenant.id))
      .orderBy(asc(escalationPaths.name));
    return {
      svc,
      teams: await listTeams(tx, tenant.id),
      paths,
      runbooks: await runbooksForService(tx, tenant.id, svc.id),
    };
  });
  if (!data) notFound();
  const { svc, teams, paths, runbooks } = data;
  const mayEdit = canRespond(member);
  const mayManage = isManager(member);

  const STATE_DOT: Record<string, string> = {
    online: "var(--ok)",
    degraded: "var(--wait)",
    offline: "var(--dang)",
    paused: "var(--ink-3)",
    waiting: "var(--ink-3)",
  };

  return (
    <div
      className="oi-rise"
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <Link
        href="/app/services"
        style={{
          fontSize: 12.5,
          color: "var(--ink-3)",
          textDecoration: "none",
          width: "fit-content",
        }}
      >
        ‹ {t("nav.services")}
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: svc.confirmed ? "var(--ok)" : "var(--wait)",
              }}
            />
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {svc.confirmed ? t("services.confirmed") : t("services.seenOnly")} ·{" "}
              {t("services.seenInCount", { count: svc.seenIn.length })}
            </span>
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--mono)",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-.015em",
            }}
          >
            {svc.key}
          </h1>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {Object.entries(svc.labels).map(([k, v]) => (
              <span
                key={k}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  background: "var(--sunk)",
                  borderRadius: 5,
                  padding: "2px 7px",
                }}
              >
                {k}:{v}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 320px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div style={CARD}>
              <div style={EYEBROW}>{t("services.kpiMonitors", { count: svc.monitors.length })}</div>
              {svc.monitors.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {t("services.noMonitors")}
                </div>
              ) : (
                svc.monitors.slice(0, 4).map((m) => (
                  <div
                    key={m.id}
                    style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: STATE_DOT[m.state] ?? "var(--ink-3)",
                        flex: "none",
                      }}
                    />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.name}
                    </span>
                    {m.lastLatencyMs !== null && (
                      <span style={{ color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
                        {m.lastLatencyMs} ms
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
            <div style={CARD}>
              <div style={EYEBROW}>{t("services.kpiAlerts")}</div>
              <div style={{ fontFamily: "var(--title)", fontSize: 22, fontWeight: 600 }}>
                {svc.alerts7d}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("services.alertsPaged", { count: svc.alertsPaged7d })}
              </div>
            </div>
            <div style={CARD}>
              <div style={EYEBROW}>{t("services.kpiIncidents")}</div>
              <div style={{ fontFamily: "var(--title)", fontSize: 22, fontWeight: 600 }}>
                {svc.incidents.length}
              </div>
              {svc.incidents.length > 0 && (
                <div style={{ fontSize: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {svc.incidents.slice(0, 3).map((i) => (
                    <Link
                      key={i.number}
                      href={`/app/incidents/${i.number}`}
                      style={{
                        color: "var(--brand)",
                        fontWeight: 600,
                        textDecoration: "none",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      INC-{i.number}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ ...CARD, padding: "14px 16px", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("services.dependencies")}</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              {telemetryInstalled()
                ? t("services.dependenciesEmpty")
                : t("services.dependenciesNoTelemetry")}
            </div>
          </div>

          <div style={{ ...CARD, padding: "14px 16px" }} data-testid="runbooks">
            <div style={EYEBROW}>{t("svc.runbooks.title")}</div>
            {runbooks.length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("svc.runbooks.none")}</div>
            )}
            {runbooks.map((r) => (
              <div
                key={r.id}
                data-testid="runbook-row"
                style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5 }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  {r.sourceUrl ? (
                    <a
                      href={r.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="oi-link"
                      style={{ fontWeight: 600, display: "block" }}
                    >
                      {r.title}
                    </a>
                  ) : (
                    <span style={{ fontWeight: 600, display: "block" }}>{r.title}</span>
                  )}
                  <span
                    style={{ fontSize: 11.5, color: r.fetchError ? "var(--dang)" : "var(--ink-3)" }}
                  >
                    {r.fetchError
                      ? t("svc.runbooks.fetchError", { error: r.fetchError })
                      : r.fetchedAt
                        ? t("svc.runbooks.fetchedAt", { when: t.fmt.relative(r.fetchedAt) })
                        : t("svc.runbooks.pasted", { chars: r.content.length })}
                  </span>
                </span>
                {mayManage && (
                  <span style={{ display: "flex", gap: 4, flex: "none" }}>
                    {r.sourceUrl && (
                      <form action={refreshRunbookAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="serviceId" value={svc.id} />
                        <button
                          type="submit"
                          className="oi-hover"
                          title={t("svc.runbooks.refresh")}
                          style={RUNBOOK_BTN}
                        >
                          ↻
                        </button>
                      </form>
                    )}
                    <form action={deleteRunbook}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="serviceId" value={svc.id} />
                      <button
                        type="submit"
                        className="oi-hover-dang"
                        aria-label={t("common.delete")}
                        style={{ ...RUNBOOK_BTN, color: "var(--dang)" }}
                      >
                        ✕
                      </button>
                    </form>
                  </span>
                )}
              </div>
            ))}
            {mayManage && (
              <form
                action={createRunbook}
                data-testid="runbook-form"
                style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}
              >
                <input type="hidden" name="serviceId" value={svc.id} />
                <input
                  name="title"
                  required
                  placeholder={t("svc.runbooks.name")}
                  className="oi-field"
                  style={RUNBOOK_FIELD}
                />
                <input
                  name="sourceUrl"
                  type="url"
                  placeholder={t("svc.runbooks.url")}
                  className="oi-field"
                  style={{ ...RUNBOOK_FIELD, fontFamily: "var(--mono)", fontSize: 12 }}
                />
                <textarea
                  name="content"
                  rows={3}
                  placeholder={t("svc.runbooks.content")}
                  className="oi-field"
                  style={{
                    ...RUNBOOK_FIELD,
                    height: "auto",
                    padding: "8px 10px",
                    resize: "vertical",
                  }}
                />
                {error === "runbook" && (
                  <div role="alert" style={{ fontSize: 12, color: "var(--dang)" }}>
                    {t("svc.runbooks.error")}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)", flex: 1 }}>
                    {t("svc.runbooks.hint")}
                  </span>
                  <button
                    type="submit"
                    data-testid="runbook-save"
                    className="oi-hover-brand-2"
                    style={{
                      height: 28,
                      padding: "0 11px",
                      borderRadius: 8,
                      background: "var(--brand)",
                      color: "var(--on-brand)",
                      border: 0,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("svc.runbooks.add")}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div style={{ ...CARD, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--viol)" }}>✦</span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("services.context")}</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
              {aiConfigured() ? t("services.contextEmpty") : t("services.contextUnavailable")}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...CARD, padding: "14px 16px" }}>
            <div style={EYEBROW}>{t("services.owner")}</div>
            {svc.ownerTeamName ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      background: "var(--brand-t)",
                      color: "var(--brand)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {svc.ownerTeamName.slice(0, 2).toUpperCase()}
                  </span>
                  <div style={{ lineHeight: 1.25 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{svc.ownerTeamName}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                      {svc.ownerPolicyName
                        ? t("services.pagesPolicy", { policy: svc.ownerPolicyName })
                        : t("services.noPolicy")}
                      {svc.ownerChannel ? ` · ${svc.ownerChannel}` : ""}
                    </div>
                  </div>
                </div>
                {!svc.ownerPolicyName && mayEdit && paths.length > 0 && svc.ownerTeamId && (
                  <form
                    action={setTeamPolicy}
                    style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}
                  >
                    <input type="hidden" name="serviceId" value={svc.id} />
                    <input type="hidden" name="teamId" value={svc.ownerTeamId} />
                    <label style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.4 }}>
                      {t("services.setPolicy")}
                    </label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <select
                        name="pathId"
                        defaultValue={paths[0]!.id}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          height: 30,
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          color: "var(--ink)",
                          fontSize: 12.5,
                          padding: "0 7px",
                        }}
                      >
                        {paths.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="oi-hover-brand-2"
                        style={{
                          height: 30,
                          padding: "0 11px",
                          border: "none",
                          borderRadius: 8,
                          background: "var(--brand)",
                          color: "var(--on-brand)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {t("services.usePolicy")}
                      </button>
                    </div>
                  </form>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--wait)", fontWeight: 600 }}>
                {t("services.noOwner")}
              </div>
            )}
            {mayEdit && teams.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                {teams
                  .filter((x) => x.id !== svc.ownerTeamId)
                  .slice(0, 3)
                  .map((x) => (
                    <form key={x.id} action={assignOwner}>
                      <input type="hidden" name="serviceId" value={svc.id} />
                      <input type="hidden" name="teamId" value={x.id} />
                      <button
                        type="submit"
                        className="oi-hover-edge"
                        style={{
                          height: 28,
                          padding: "0 10px",
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          color: "var(--ink-2)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {x.name}
                      </button>
                    </form>
                  ))}
              </div>
            )}
          </div>

          <div style={{ ...CARD, padding: "14px 16px" }}>
            <div style={EYEBROW}>{t("services.seenIn")}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
              {svc.seenIn.length > 0 ? svc.seenIn.join(" · ") : t("services.seenNowhere")}
            </div>
            {svc.lastSeenAt && (
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("services.lastSignal", { when: t.fmt.relative(svc.lastSeenAt) })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
