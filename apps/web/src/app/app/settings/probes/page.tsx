import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { monitors, probes, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";

/**
 * Probes — where the monitor checks are made from.
 *
 * The honest version of the design's screen. A `probes` table exists, but
 * nothing in the product writes to it and nothing dispatches a check to one:
 * every monitor is checked by the instance's own worker, in the worker's own
 * network. So the screen says that, proves it with the two facts it can read
 * — how many monitors are being checked, and when the last check happened —
 * and shows the registry as the empty thing it is, rather than inventing a
 * Paris and a Frankfurt that nobody runs.
 */
export default async function ProbesPage() {
  const { tenant } = await requireMember();
  const t = await getT();
  const data = await withTenant(tenant.id, async (tx) => ({
    // Only the workspace's own rows are readable: row-level security matches
    // tenant_id to the current workspace, so an instance probe (tenant_id null)
    // never comes back through the application role.
    rows: await tx.select().from(probes).where(eq(probes.tenantId, tenant.id)),
    checked: await tx
      .select({
        n: sql<number>`count(*)`.mapWith(Number),
        // Raw aggregates come back as text; the column's own mapper is not applied.
        last: sql<string | null>`max(${monitors.lastCheckAt})`,
      })
      .from(monitors)
      .where(and(eq(monitors.tenantId, tenant.id), eq(monitors.paused, false))),
  }));
  const active = data.checked[0]?.n ?? 0;
  const lastRaw = data.checked[0]?.last ?? null;
  const last = lastRaw ? new Date(lastRaw) : null;

  const card: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-card)",
    boxShadow: "var(--shadow-card)",
    overflow: "hidden",
  };
  const cols = "minmax(0,1fr) 140px 130px 150px 100px";

  return (
    <div className="oi-rise" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("set2.probes.title")}
        </h1>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
          {t("set2.probes.subtitle")}
        </div>
      </div>

      <div className="oi-note">{t("set2.probes.noRunner")}</div>

      <div
        style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("set2.probes.whereChecksRun")}</span>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--ink-2)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: last ? "var(--ok)" : "var(--ink-3)",
              flex: "none",
              marginTop: 6,
            }}
          />
          <span>{t("set2.probes.workerLine")}</span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 18,
            flexWrap: "wrap",
            fontSize: 12.5,
            color: "var(--ink-3)",
          }}
        >
          <span>
            {active > 0
              ? t("set2.probes.activeMonitors", { count: active })
              : t("set2.probes.noMonitors")}
          </span>
          <span>
            {last
              ? t("set2.probes.lastSweep", { when: t.fmt.relative(last) })
              : t("set2.probes.neverSwept")}
          </span>
          <Link href="/app/monitors" className="oi-link" style={{ fontSize: 12.5 }}>
            {t("set2.probes.openMonitors")}
          </Link>
        </div>
      </div>

      <div style={card}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: cols,
            gap: 12,
            padding: "8px 16px",
            borderBottom: "1px solid var(--line)",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          <span>{t("set2.probes.col.name")}</span>
          <span>{t("set2.probes.col.region")}</span>
          <span>{t("set2.probes.col.owner")}</span>
          <span>{t("set2.probes.col.lastSeen")}</span>
          <span>{t("set2.probes.col.version")}</span>
        </div>
        {data.rows.length === 0 ? (
          <div style={{ padding: "18px 16px", fontSize: 13, color: "var(--ink-3)" }}>
            {t("set2.probes.none")}
          </div>
        ) : (
          data.rows.map((p, i) => (
            <div
              key={p.id}
              style={{
                display: "grid",
                gridTemplateColumns: cols,
                gap: 12,
                alignItems: "center",
                padding: "10px 16px",
                borderBottom: i < data.rows.length - 1 ? "1px solid var(--line-2)" : undefined,
                fontSize: 12.5,
              }}
            >
              <span style={{ fontWeight: 600, minWidth: 0 }}>{p.name}</span>
              <span style={{ fontFamily: "var(--mono)", color: "var(--ink-2)" }}>{p.region}</span>
              <span style={{ color: "var(--ink-2)" }}>
                {p.managed ? t("set2.probes.ownerInstance") : t("set2.probes.ownerWorkspace")}
              </span>
              <span style={{ color: "var(--ink-3)" }}>
                {p.lastSeenAt ? t.fmt.relative(p.lastSeenAt) : t("set2.probes.neverReported")}
              </span>
              <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
                {p.version ?? "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
