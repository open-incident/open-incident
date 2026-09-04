import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { alertSources, alerts, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { NewSourceDialog } from "./new-source";
import { deleteSource, testSource, toggleSource } from "./actions";
import { requestOrigin } from "@/lib/tenant";
import { headers } from "next/headers";

/** Settings → Alert sources: one row per source with its endpoint, activity, status and a real test button. */
export default async function AlertSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ tested?: string; alert?: string; new?: string }>;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const h = await headers();
  const origin = requestOrigin({
    headers: h,
    nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`),
  });
  const rows = await withTenant(tenant.id, (tx) =>
    tx
      .select({
        s: alertSources,
        count90:
          sql<number>`(select count(*) from ${alerts} a where a.source_id = ${alertSources.id} and a.first_at > now() - interval '90 days')`.mapWith(
            Number,
          ),
      })
      .from(alertSources)
      .where(eq(alertSources.tenantId, tenant.id))
      .orderBy(asc(alertSources.createdAt)),
  );
  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1000 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.sources.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.sources.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        <NewSourceDialog initialKind={q.new} />
      </div>
      {q.tested && (
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
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} />
          {t("settings.sources.testSent")}
          {q.alert && (
            <Link href={`/app/alerts/${q.alert}`} className="oi-link" style={{ fontWeight: 600 }}>
              {t("settings.sources.openTestAlert")}
            </Link>
          )}
        </div>
      )}
      <div className="oi-panel" style={{ overflow: "hidden" }}>
        {rows.map(({ s, count90 }, i) => (
          <div
            key={s.id}
            data-testid="source-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 16px",
              borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : undefined,
            }}
          >
            <div style={{ width: 170, flex: "none", fontSize: 13, fontWeight: 600 }}>{s.name}</div>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--ink-2)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {origin}/api/ingest/alerts/{s.id}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
              {count90 > 0
                ? t("settings.sources.meta", { count: count90 })
                : t("settings.sources.noAlerts")}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 9px 2px 7px",
                borderRadius: 999,
                background: s.active ? "var(--ok-t)" : "var(--sunk)",
                color: s.active ? "var(--ok)" : "var(--ink-2)",
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              <span
                style={{ width: 4, height: 4, borderRadius: "50%", background: "currentColor" }}
              />
              {s.active ? t("settings.sources.active") : t("settings.sources.configured")}
            </span>
            <form action={testSource}>
              <input type="hidden" name="id" value={s.id} />
              <button
                type="submit"
                data-testid="source-test"
                disabled={!s.active}
                className="oi-hover"
                style={{
                  height: 28,
                  padding: "0 11px",
                  border: `1px solid ${q.tested === s.id ? "var(--ok)" : "var(--line)"}`,
                  borderRadius: 8,
                  background: "var(--panel)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: q.tested === s.id ? "var(--ok)" : "inherit",
                  cursor: s.active ? "pointer" : "not-allowed",
                  opacity: s.active ? 1 : 0.5,
                }}
              >
                {q.tested === s.id ? t("settings.sources.testDone") : t("settings.sources.test")}
              </button>
            </form>
            <form action={toggleSource}>
              <input type="hidden" name="id" value={s.id} />
              <button
                type="submit"
                className="oi-hover"
                style={{
                  height: 28,
                  padding: "0 11px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: "var(--panel)",
                  fontSize: 11.5,
                  cursor: "pointer",
                }}
              >
                {s.active ? t("settings.api.disable") : t("settings.api.enable")}
              </button>
            </form>
            <form action={deleteSource}>
              <input type="hidden" name="id" value={s.id} />
              <button
                type="submit"
                aria-label={t("common.delete")}
                className="oi-hover-dang"
                style={{
                  width: 28,
                  height: 28,
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: "var(--panel)",
                  color: "var(--dang)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            </form>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: 16, fontSize: 12.5, color: "var(--ink-3)" }}>
            {t("settings.sources.empty")}
          </div>
        )}
      </div>
      <div
        style={{
          background: "var(--sunk)",
          borderRadius: 14,
          padding: "13px 15px",
          fontSize: 12.5,
          color: "var(--ink-2)",
          lineHeight: 1.55,
        }}
      >
        {t("settings.sources.note")}
      </div>
    </div>
  );
}
