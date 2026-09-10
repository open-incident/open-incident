import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { alertSources, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { sourceHealth } from "@/lib/alerting-setup";
import { SOURCE_KINDS, sourceKindMeta } from "@/lib/alert-sources";
import { IntegrationIcon } from "../integrations/icons";
import { NewSourceDialog } from "./new-source";
import { testSource, toggleSource } from "./actions";

const btn: React.CSSProperties = {
  height: 30,
  padding: "0 11px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

/**
 * Alert sources: one row per tool connected — its mark, its name, what it
 * sent in the last day, when it last spoke — and the way to its page, where
 * the payload becomes attributes. Creating one takes three steps in a dialog.
 */
export default async function AlertSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ tested?: string; alert?: string; new?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { tested, alert, new: openNew } = await searchParams;
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => ({
    sources: await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenant.id), eq(alertSources.managed, false)))
      .orderBy(alertSources.name),
    health: await sourceHealth(tx, tenant.id),
  }));
  const kinds = SOURCE_KINDS.map((k) => ({ kind: k.kind, label: k.label, icon: k.icon }));

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.sources.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.sources.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/settings/alerting" className="oi-link" style={{ fontSize: 12.5 }}>
          {t("settings.nav.alerting")}
        </Link>
        {manages && <NewSourceDialog kinds={kinds} initialOpen={openNew === "1"} />}
      </div>
      {tested && (
        <div
          role="status"
          style={{
            padding: "9px 14px",
            borderRadius: 10,
            background: "var(--ok-t)",
            color: "var(--ok)",
            fontSize: 12.5,
            fontWeight: 600,
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          {t("settings.sources.testSent")}
          {alert && (
            <Link href={`/app/alerts/${alert}`} className="oi-link" style={{ color: "var(--ok)" }}>
              {t("settings.sources.openTestAlert")}
            </Link>
          )}
        </div>
      )}
      <div className="oi-panel" style={{ overflow: "hidden" }}>
        {data.sources.length === 0 && (
          <div
            style={{
              padding: "28px 20px",
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 13.5,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span>{t("settings.sources.empty")}</span>
            <span style={{ fontSize: 12.5, maxWidth: 460 }}>{t("settings.sources.emptyNote")}</span>
          </div>
        )}
        {data.sources.map((s) => {
          const meta = sourceKindMeta(s.kind);
          const h = data.health.get(s.id);
          return (
            <div
              key={s.id}
              data-testid="source-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 16px",
                borderBottom: "1px solid var(--line-2)",
                fontSize: 13,
              }}
            >
              <IntegrationIcon id={meta.icon} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link
                  href={`/app/settings/alert-sources/${s.id}`}
                  className="oi-link"
                  style={{ fontWeight: 600, color: "inherit" }}
                >
                  {s.name}
                </Link>
                <div
                  style={{
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {meta.label}
                  {s.description ? ` · ${s.description}` : ""}
                  {" · "}
                  {s.lastAlertAt
                    ? t("settings.sources.lastAlert", { when: t.fmt.relative(s.lastAlertAt) })
                    : t("settings.sources.noAlerts")}
                </div>
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  color: h?.firing ? "var(--dang)" : "var(--ink-3)",
                  width: 120,
                  textAlign: "right",
                }}
              >
                {h ? t("setup.health", { day: h.day, firing: h.firing }) : t("setup.healthNone")}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 8px",
                  borderRadius: 999,
                  background: s.active ? "var(--ok-t)" : "var(--sunk)",
                  color: s.active ? "var(--ok)" : "var(--ink-3)",
                }}
              >
                {s.active ? t("settings.sources.active") : t("settings.sources.inactive")}
              </span>
              {manages && (
                <>
                  <form action={testSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" style={btn} data-testid="source-test">
                      {tested === s.id
                        ? t("settings.sources.testDone")
                        : t("settings.sources.test")}
                    </button>
                  </form>
                  <form action={toggleSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" style={btn}>
                      {s.active ? t("settings.sources.disable") : t("settings.sources.enable")}
                    </button>
                  </form>
                </>
              )}
              <Link
                href={`/app/settings/alert-sources/${s.id}`}
                style={{
                  ...btn,
                  background: "var(--brand)",
                  borderColor: "var(--brand)",
                  color: "#fff",
                }}
              >
                {t("settings.sources.configure")}
              </Link>
            </div>
          );
        })}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
        {t("settings.sources.note")}
      </p>
    </div>
  );
}
