import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { alertPriorities, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { deletePriority, movePriority, savePriority } from "./actions";

/** Settings → Priorities: they qualify the alert at ingestion — from the payload or static per route. */
export default async function AlertPrioritiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const rows = await withTenant(tenant.id, (tx) =>
    tx
      .select()
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenant.id))
      .orderBy(asc(alertPriorities.rank)),
  );
  const editing = q.edit === "new" ? "new" : (rows.find((r) => r.id === q.edit) ?? null);
  const r = editing === "new" ? null : editing;
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    color: "var(--ink-3)",
  };
  const control: React.CSSProperties = {
    height: 36,
    padding: "0 11px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    outline: "none",
    fontSize: 12.5,
    background: "var(--panel)",
    width: "100%",
  };
  const COLORS = [
    ["var(--dang)", t("settings.priorities.color.red")],
    ["var(--wait)", t("settings.priorities.color.amber")],
    ["var(--open)", t("settings.priorities.color.blue")],
    ["var(--viol)", t("settings.priorities.color.violet")],
    ["var(--ok)", t("settings.priorities.color.green")],
    ["var(--ink-3)", t("settings.priorities.color.grey")],
  ] as const;
  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 860 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.priorities.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.priorities.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        {q.saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        <Link
          href="/app/settings/alert-priorities?edit=new"
          data-testid="priority-new"
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 9,
            background: "var(--brand)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {t("settings.priorities.new")}
        </Link>
      </div>
      <div className="oi-panel" style={{ overflow: "hidden" }}>
        {rows.map((p, i) => (
          <div
            key={p.id}
            data-testid="priority-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 16px",
              borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : undefined,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <form action={movePriority} style={{ display: "contents" }}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="dir" value="up" />
                <button
                  type="submit"
                  disabled={i === 0}
                  aria-label={t("common.previous")}
                  style={{
                    border: 0,
                    background: "transparent",
                    color: i === 0 ? "var(--line-2)" : "var(--ink-3)",
                    cursor: i === 0 ? "default" : "pointer",
                    fontSize: 9,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ▲
                </button>
              </form>
              <form action={movePriority} style={{ display: "contents" }}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="dir" value="down" />
                <button
                  type="submit"
                  disabled={i === rows.length - 1}
                  aria-label={t("common.next")}
                  style={{
                    border: 0,
                    background: "transparent",
                    color: i === rows.length - 1 ? "var(--line-2)" : "var(--ink-3)",
                    cursor: i === rows.length - 1 ? "default" : "pointer",
                    fontSize: 9,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ▼
                </button>
              </form>
            </div>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: p.color,
                flex: "none",
              }}
            />
            <span
              style={{ width: 40, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500 }}
            >
              {p.name}
            </span>
            <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink-2)" }}>{p.description}</span>
            <span
              style={{
                padding: "2px 9px",
                borderRadius: 999,
                background: p.urgency === "high" ? "var(--dang-t)" : "var(--sunk)",
                color: p.urgency === "high" ? "var(--dang)" : "var(--ink-2)",
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {t("settings.priorities.urgencyChip", { urgency: p.urgency })}
            </span>
            <Link
              href={`/app/settings/alert-priorities?edit=${p.id}`}
              className="oi-hover"
              style={{
                height: 26,
                padding: "0 10px",
                border: "1px solid var(--line)",
                borderRadius: 7,
                display: "flex",
                alignItems: "center",
                fontSize: 11,
                fontWeight: 600,
                color: "inherit",
                textDecoration: "none",
              }}
            >
              {t("common.edit")}
            </Link>
            <form action={deletePriority}>
              <input type="hidden" name="id" value={p.id} />
              <button
                type="submit"
                aria-label={t("common.delete")}
                className="oi-hover-dang"
                style={{
                  width: 26,
                  height: 26,
                  border: "1px solid var(--line)",
                  borderRadius: 7,
                  background: "var(--panel)",
                  color: "var(--dang)",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                ✕
              </button>
            </form>
          </div>
        ))}
      </div>
      <div className="oi-note">
        <strong>{t("settings.priorities.noteTitle")}</strong> {t("settings.priorities.note")}
      </div>
      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <form
            action={savePriority}
            data-testid="priority-form"
            role="dialog"
            className="oi-rise"
            style={{
              width: 500,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <input type="hidden" name="id" value={r?.id ?? ""} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                {r
                  ? t("settings.priorities.editTitle", { name: r.name })
                  : t("settings.priorities.newTitle")}
              </div>
              <Link
                href="/app/settings/alert-priorities"
                aria-label={t("common.close")}
                style={{
                  marginLeft: "auto",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                ✕
              </Link>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.priorities.name")}</span>
                  <input
                    name="name"
                    required
                    maxLength={12}
                    defaultValue={r?.name ?? ""}
                    placeholder="P5"
                    className="oi-field"
                    style={{ ...control, fontFamily: "var(--font-mono)" }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.priorities.description")}</span>
                  <input
                    name="description"
                    maxLength={160}
                    defaultValue={r?.description ?? ""}
                    className="oi-field"
                    style={control}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.routes.urgency")}</span>
                  <select
                    name="urgency"
                    defaultValue={r?.urgency ?? "high"}
                    className="oi-field"
                    style={control}
                  >
                    <option value="high">{t("settings.priorities.urgencyHigh")}</option>
                    <option value="low">{t("settings.priorities.urgencyLow")}</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.priorities.colorLabel")}</span>
                  <select
                    name="color"
                    defaultValue={r?.color ?? "var(--ink-3)"}
                    className="oi-field"
                    style={control}
                  >
                    {COLORS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <span style={{ flex: 1 }} />
              <Link
                href="/app/settings/alert-priorities"
                className="oi-hover"
                style={{
                  height: 34,
                  padding: "0 13px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 12.5,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                {t("common.cancel")}
              </Link>
              <button
                type="submit"
                style={{
                  height: 34,
                  padding: "0 16px",
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "#fff",
                  border: 0,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {r ? t("common.save") : t("common.create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
