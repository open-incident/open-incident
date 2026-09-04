import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { apiKeys, webhookDeliveries, webhookEndpoints, withTenant } from "@openincident/db";
import { WEBHOOK_EVENTS, FUTURE_WEBHOOK_EVENTS } from "@openincident/webhooks";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { NewKeyDialog, NewWebhookDialog } from "./dialogs";
import { deleteWebhook, resendWebhookFailures, revokeApiKey, toggleWebhook } from "./actions";

/**
 * Settings → API & webhooks, the design's two columns: the keys and the
 * contract on the left, the outbound endpoints on the right. A key is shown
 * once, at creation; an endpoint's secret likewise. Every control acts.
 */
export default async function ApiSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ deliveries?: string }>;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const { deliveries: showDeliveries } = await searchParams;
  const data = await withTenant(tenant.id, async (tx) => {
    const keys = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.tenantId, tenant.id), isNull(apiKeys.revokedAt)))
      .orderBy(asc(apiKeys.createdAt));
    const hooks = await tx
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenant.id))
      .orderBy(asc(webhookEndpoints.createdAt));
    const deliveries = hooks.length
      ? await tx
          .select()
          .from(webhookDeliveries)
          .where(
            inArray(
              webhookDeliveries.endpointId,
              hooks.map((h) => h.id),
            ),
          )
          .orderBy(desc(webhookDeliveries.createdAt))
          .limit(200)
      : [];
    return { keys, hooks, deliveries };
  });
  const lastDelivery = (id: string) => data.deliveries.find((d) => d.endpointId === id);
  const failedCount = (id: string) =>
    data.deliveries.filter(
      (d) => d.endpointId === id && (d.httpStatus === null || d.httpStatus >= 300),
    ).length;
  const chip = (tone: "ok" | "dang" | "mute", label: string) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 9px 2px 7px",
        borderRadius: 999,
        background:
          tone === "ok" ? "var(--ok-t)" : tone === "dang" ? "var(--dang-t)" : "var(--sunk)",
        color: tone === "ok" ? "var(--ok)" : tone === "dang" ? "var(--dang)" : "var(--ink-2)",
        fontSize: 10.5,
        fontWeight: 700,
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "currentColor" }} />
      {label}
    </span>
  );
  const ghost: React.CSSProperties = {
    height: 28,
    padding: "0 11px",
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "var(--panel)",
    display: "flex",
    alignItems: "center",
    fontSize: 11.5,
    cursor: "pointer",
  };

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1060 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.api.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("settings.api.subtitle")}</span>
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="oi-panel" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t("settings.api.keys")}</span>
              <span style={{ flex: 1 }} />
              <NewKeyDialog />
            </div>
            {data.keys.map((k, i) => (
              <div
                key={k.id}
                data-testid="api-key-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "12px 16px",
                  borderBottom: i < data.keys.length - 1 ? "1px solid var(--line-2)" : undefined,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500 }}>
                    {k.prefix}…{k.lastFour}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                    {k.name} · {t("settings.api.scopes")} {k.scopes.join(", ")} ·{" "}
                    {k.lastUsedAt
                      ? t("settings.api.usedAgo", { when: t.fmt.relative(k.lastUsedAt) })
                      : t("settings.api.neverUsed")}
                  </div>
                </div>
                {chip("ok", t("settings.api.active"))}
                <form action={revokeApiKey}>
                  <input type="hidden" name="id" value={k.id} />
                  <button
                    type="submit"
                    className="oi-hover-dang"
                    style={{ ...ghost, color: "var(--dang)" }}
                  >
                    {t("settings.api.revoke")}
                  </button>
                </form>
              </div>
            ))}
            {data.keys.length === 0 && (
              <div style={{ padding: "16px", fontSize: 12.5, color: "var(--ink-3)" }}>
                {t("settings.api.noKeys")}
              </div>
            )}
          </div>
          <div className="oi-panel" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t("settings.api.contract")}</span>
              <span style={{ flex: 1 }} />
              <Link
                href="/api/v1/openapi.json"
                target="_blank"
                className="oi-link"
                style={{ fontSize: 12, fontWeight: 600 }}
              >
                openapi.json →
              </Link>
            </div>
            <pre
              style={{
                margin: 0,
                padding: "14px 16px",
                background: "var(--topbar-dark)",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                lineHeight: 1.65,
                color: "var(--code-blue)",
                overflowX: "auto",
              }}
            >
              {`GET   /api/v1/incidents?cursor=…&limit=100
POST  /api/v1/incidents
PATCH /api/v1/incidents/:number
POST  /api/v1/incidents/:number/updates
GET   /api/v1/incidents/:number/timeline
POST  /api/v1/incidents/:number/follow-ups
GET   /api/v1/follow-ups · /catalog/types · /catalog/entries
{ "error": { "code": "missing_scope", "message": "…" } }`}
            </pre>
            <div
              style={{ padding: "10px 16px", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}
            >
              Bearer{" "}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                oi_live_[a-f0-9]{"{32}"}
              </span>{" "}
              · {t("settings.api.contractNote")}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="oi-panel" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t("settings.api.webhooks")}</span>
              <span style={{ flex: 1 }} />
              <NewWebhookDialog
                events={[...WEBHOOK_EVENTS]}
                future={FUTURE_WEBHOOK_EVENTS.map((f) => ({
                  event: f.event,
                  label: f.milestone === "oncall" ? t("nav.soonOnCall") : t("nav.soonStatusPages"),
                }))}
              />
            </div>
            {data.hooks.map((h, i) => {
              const last = lastDelivery(h.id);
              const off = !h.active || Boolean(h.disabledAt);
              const failing = Boolean(h.failingSince) && !off;
              const shown = showDeliveries === h.id;
              return (
                <div
                  key={h.id}
                  data-testid="webhook-row"
                  style={{
                    padding: "12px 16px",
                    borderBottom: i < data.hooks.length - 1 ? "1px solid var(--line-2)" : undefined,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        fontWeight: 500,
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h.url}
                    </span>
                    {off
                      ? chip("mute", t("settings.api.disabled"))
                      : failing
                        ? chip(
                            "dang",
                            t("settings.api.failingFor", {
                              duration: t.fmt
                                .relative(h.failingSince!)
                                .replace(/^il y a |^vor |ago$/g, ""),
                            }),
                          )
                        : chip("ok", t("settings.api.healthy"))}
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {h.events.slice(0, 4).map((e) => (
                      <span
                        key={e}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5,
                          background: "var(--sunk)",
                          borderRadius: 999,
                          padding: "2px 8px",
                        }}
                      >
                        {e}
                      </span>
                    ))}
                    {h.events.length > 4 && (
                      <span style={{ fontSize: 10.5, color: "var(--ink-3)", padding: "2px 2px" }}>
                        {t("settings.api.moreEvents", { count: h.events.length - 4 })}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                    {off
                      ? t("settings.api.disabledNote")
                      : failing
                        ? t("settings.api.failingNote")
                        : t("settings.api.signatureNote")}
                    {last &&
                      ` · ${t("settings.api.lastDelivery", { when: t.fmt.relative(last.createdAt), status: last.httpStatus === null ? t("settings.api.noResponse") : String(last.httpStatus) })}`}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {failedCount(h.id) > 0 && !off && (
                      <form action={resendWebhookFailures}>
                        <input type="hidden" name="id" value={h.id} />
                        <button
                          type="submit"
                          className="oi-hover"
                          style={{ ...ghost, fontWeight: 600 }}
                        >
                          {t("settings.api.resendFailures", { count: failedCount(h.id) })}
                        </button>
                      </form>
                    )}
                    <Link
                      href={shown ? "/app/settings/api" : `/app/settings/api?deliveries=${h.id}`}
                      className="oi-hover"
                      style={{ ...ghost, textDecoration: "none", color: "inherit" }}
                    >
                      {shown ? t("settings.api.hideDeliveries") : t("settings.api.viewDeliveries")}
                    </Link>
                    <form action={toggleWebhook}>
                      <input type="hidden" name="id" value={h.id} />
                      <button type="submit" className="oi-hover" style={ghost}>
                        {off ? t("settings.api.enable") : t("settings.api.disable")}
                      </button>
                    </form>
                    <form action={deleteWebhook}>
                      <input type="hidden" name="id" value={h.id} />
                      <button
                        type="submit"
                        className="oi-hover-dang"
                        style={{ ...ghost, color: "var(--dang)" }}
                      >
                        {t("settings.api.delete")}
                      </button>
                    </form>
                  </div>
                  {shown && (
                    <div
                      style={{
                        marginTop: 4,
                        border: "1px solid var(--line-2)",
                        borderRadius: 10,
                        overflow: "hidden",
                      }}
                    >
                      {data.deliveries
                        .filter((d) => d.endpointId === h.id)
                        .slice(0, 20)
                        .map((d) => (
                          <div
                            key={d.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "7px 10px",
                              borderBottom: "1px solid var(--line-2)",
                              fontSize: 11.5,
                            }}
                          >
                            <span
                              style={{
                                fontFamily: "var(--font-mono)",
                                color: "var(--ink-3)",
                                width: 92,
                                flex: "none",
                              }}
                            >
                              {t.fmt.messageTime(d.createdAt)}
                            </span>
                            <span
                              style={{
                                fontFamily: "var(--font-mono)",
                                flex: 1,
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {d.event}
                            </span>
                            <span
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontWeight: 600,
                                color:
                                  d.httpStatus !== null && d.httpStatus < 300
                                    ? "var(--ok)"
                                    : "var(--dang)",
                              }}
                            >
                              {d.httpStatus === null ? "—" : d.httpStatus}
                            </span>
                            <span style={{ color: "var(--ink-3)", width: 56, textAlign: "right" }}>
                              {d.latencyMs !== null ? `${d.latencyMs} ms` : ""}
                            </span>
                          </div>
                        ))}
                      {data.deliveries.filter((d) => d.endpointId === h.id).length === 0 && (
                        <div style={{ padding: "8px 10px", fontSize: 11.5, color: "var(--ink-3)" }}>
                          {t("settings.api.noDeliveries")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {data.hooks.length === 0 && (
              <div style={{ padding: 16, fontSize: 12.5, color: "var(--ink-3)" }}>
                {t("settings.api.noWebhooks")}
              </div>
            )}
          </div>
          <div className="oi-note">{t("settings.api.emissionNote")}</div>
        </div>
      </div>
    </div>
  );
}
