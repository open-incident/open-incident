import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { alertPriorities, severities, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { deletePriority, movePriority, savePriority } from "./actions";

/** The tint that goes with each ink the editor offers. Tokens only, in pairs. */
const TINT: Record<string, string> = {
  "var(--dang)": "var(--dang-t)",
  "var(--wait)": "var(--wait-t)",
  "var(--open)": "var(--open-t)",
  "var(--viol)": "var(--viol-t)",
  "var(--ok)": "var(--ok-t)",
  "var(--ink-3)": "var(--sunk)",
};

/**
 * Alert severities — P1 to P4, the qualification an alert carries from the
 * moment it is ingested.
 *
 * Two of the four columns are read, not set. Whether a level wakes people up
 * is its urgency, which the row's editor owns. Which incident severity it
 * opens as is not a column anywhere: the pipeline pairs the two lists by rank,
 * so the mapping is shown as what it is — derived — rather than as a dropdown
 * that would have nowhere to write.
 */
export default async function AlertSeveritiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => ({
    rows: await tx
      .select()
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenant.id))
      .orderBy(asc(alertPriorities.rank)),
    sevs: await tx
      .select({ id: severities.id, name: severities.name, rank: severities.rank })
      .from(severities)
      .where(eq(severities.tenantId, tenant.id))
      .orderBy(asc(severities.rank)),
  }));
  const rows = data.rows;
  // The pipeline's own rule: same rank in both lists, the last one catching the rest.
  const opensAs = (rank: number) =>
    data.sevs.find((s) => s.rank === rank) ?? data.sevs[data.sevs.length - 1] ?? null;
  // "opens as SEV2" — the level's name set in bold inside the sentence.
  const [opensAsHead, opensAsTail] = t.parts("set2.sev.opensAs", "severity");

  const editing = manages
    ? q.edit === "new"
      ? "new"
      : (rows.find((r) => r.id === q.edit) ?? null)
    : null;
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
    <div className="oi-rise" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--title)",
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: "-.015em",
            }}
          >
            {t("set2.sev.title")}
          </h1>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>
            {t("set2.sev.subtitle")}
          </div>
        </div>
        {q.saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {manages && (
          <Link
            href="/app/settings/alert-priorities?edit=new"
            data-testid="priority-new"
            className="oi-hover-brand-2"
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 9,
              background: "var(--brand)",
              color: "var(--on-brand)",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {t("set2.sev.new")}
          </Link>
        )}
      </div>

      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
          overflow: "hidden",
        }}
      >
        {rows.length === 0 && (
          <div style={{ padding: 22, fontSize: 13, color: "var(--ink-3)" }}>
            {t("set2.sev.empty")}
          </div>
        )}
        {rows.map((p, i) => {
          const sev = opensAs(p.rank);
          const wakes = p.urgency === "high";
          return (
            <div
              key={p.id}
              data-testid="priority-row"
              style={{
                display: "grid",
                gridTemplateColumns: manages
                  ? "14px 56px minmax(0,1fr) 150px 170px auto"
                  : "56px minmax(0,1fr) 150px 170px",
                gap: 14,
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : undefined,
              }}
            >
              {manages && (
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
              )}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  padding: "3px 0",
                  textAlign: "center",
                  background: TINT[p.color] ?? "var(--sunk)",
                  color: p.color,
                }}
              >
                {p.name}
              </span>
              <span style={{ fontSize: 13, color: "var(--ink-2)", minWidth: 0 }}>
                {p.description}
                {(p.aliases.length > 0 || p.isDefault) && (
                  <span
                    style={{
                      display: "block",
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      fontFamily: "var(--mono)",
                    }}
                  >
                    {p.isDefault && (
                      <span
                        style={{
                          fontFamily: "inherit",
                          fontWeight: 700,
                          color: "var(--brand)",
                          marginRight: 8,
                        }}
                      >
                        {t("settings.priorities.default")}
                      </span>
                    )}
                    {p.aliases.join(" · ")}
                  </span>
                )}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: wakes ? "var(--dang)" : "var(--ink-3)",
                }}
              >
                {wakes ? t("set2.sev.wakes") : t("set2.sev.waits")}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                {sev ? (
                  <>
                    {opensAsHead}
                    <strong>{sev.name}</strong>
                    {opensAsTail}
                  </>
                ) : (
                  <span style={{ color: "var(--ink-3)" }}>{t("set2.sev.opensAsNone")}</span>
                )}
              </span>
              {manages && (
                <span style={{ display: "flex", gap: 6 }}>
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
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="oi-note">{t("set2.sev.mappingNote")}</div>
      <div className="oi-note">
        <strong>{t("settings.priorities.noteTitle")}</strong> {t("set2.sev.alsoCalled")}
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
            className="oi-rise-modal"
            style={{
              width: 500,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: "var(--radius-modal)",
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
              <div style={{ fontFamily: "var(--title)", fontSize: 16.5, fontWeight: 600 }}>
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
                    style={{ ...control, fontFamily: "var(--mono)" }}
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
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.priorities.aliases")}</span>
                <input
                  name="aliases"
                  maxLength={400}
                  defaultValue={r?.aliases.join(", ") ?? ""}
                  placeholder="critical, sev1, high"
                  className="oi-field"
                  style={{ ...control, fontFamily: "var(--mono)" }}
                />
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {t("settings.priorities.aliasesHint")}
                </span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" name="isDefault" defaultChecked={r?.isDefault ?? false} />
                {t("settings.priorities.isDefault")}
              </label>
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
                className="oi-hover-brand-2"
                style={{
                  height: 34,
                  padding: "0 16px",
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "var(--on-brand)",
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
