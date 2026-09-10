import Link from "next/link";
import { eq } from "drizzle-orm";
import { alertAttributes, alertSources, catalogTypes, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { attributeCoverage } from "@/lib/alerting-setup";
import { deleteAttribute, moveAttribute, saveAttribute } from "./actions";

const control: React.CSSProperties = {
  height: 34,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  fontSize: 13,
  outline: "none",
};
const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
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
};
const icon: React.CSSProperties = {
  ...btn,
  width: 28,
  padding: 0,
  justifyContent: "center",
  color: "var(--ink-3)",
};

/**
 * The alert attributes: the vocabulary every source maps its payload onto and
 * every route reasons about. Each has a type — text, list, priority, or a
 * catalog type when the workspace wants to bind names to entries — can be
 * required, and says what a repeat of the same alert does to its value. The
 * coverage column tells how many recent alerts carry it, and how many sources.
 */
export default async function AlertAttributesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; edit?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { saved, error, edit } = await searchParams;
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(alertAttributes)
      .where(eq(alertAttributes.tenantId, tenant.id))
      .orderBy(alertAttributes.position, alertAttributes.createdAt);
    const types = await tx
      .select({ key: catalogTypes.key, name: catalogTypes.name })
      .from(catalogTypes)
      .where(eq(catalogTypes.tenantId, tenant.id))
      .orderBy(catalogTypes.position);
    const sources = await tx
      .select({ id: alertSources.id, name: alertSources.name, mappings: alertSources.mappings })
      .from(alertSources)
      .where(eq(alertSources.tenantId, tenant.id));
    const coverage = await attributeCoverage(
      tx,
      tenant.id,
      rows.map((r) => r.key),
    );
    return { rows, types, sources, coverage };
  });
  const editing = edit === "new" ? null : data.rows.find((r) => r.id === edit);
  const showForm = edit === "new" || Boolean(editing);
  const mappedBy = (key: string) =>
    data.sources.filter((s) => s.mappings.some((m) => m.attribute === key));

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.attributes.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.attributes.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        {saved && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {error === "duplicate"
              ? t("settings.attributes.errorDuplicate")
              : t("settings.fields.errorInvalid")}
          </span>
        )}
        {manages && !showForm && (
          <Link
            href="/app/settings/alert-attributes?edit=new"
            className="oi-hover-edge-fill"
            style={{
              ...btn,
              height: 32,
              color: "var(--brand)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
            }}
            data-testid="attribute-new"
          >
            {t("settings.attributes.new")}
          </Link>
        )}
      </div>

      {showForm && manages && (
        <form
          action={saveAttribute}
          className="oi-panel"
          style={{
            padding: "16px 18px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            alignItems: "end",
          }}
          data-testid="attribute-form"
        >
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={label}>{t("settings.attributes.key")}</span>
            <input
              name="key"
              defaultValue={editing?.key ?? ""}
              readOnly={Boolean(editing)}
              required
              pattern="[a-z][a-z0-9_]{0,39}"
              placeholder="customer"
              className="oi-field"
              style={{
                ...control,
                fontFamily: "var(--font-mono)",
                background: editing ? "var(--sunk)" : "var(--panel)",
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={label}>{t("settings.attributes.label")}</span>
            <input
              name="label"
              defaultValue={editing?.label ?? ""}
              required
              maxLength={60}
              className="oi-field"
              style={control}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={label}>{t("settings.attributes.type")}</span>
            <select name="type" defaultValue={editing?.type ?? "text"} style={control}>
              {(["text", "list", "priority", "catalog"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`settings.attributes.kind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{ display: "flex", flexDirection: "column", gap: 5, gridColumn: "1 / span 2" }}
          >
            <span style={label}>{t("settings.attributes.description")}</span>
            <input
              name="description"
              defaultValue={editing?.description ?? ""}
              maxLength={300}
              className="oi-field"
              style={control}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={label}>{t("settings.attributes.catalogType")}</span>
            <select
              name="catalogTypeKey"
              defaultValue={editing?.catalogTypeKey ?? ""}
              style={control}
            >
              <option value="">{t("settings.attributes.catalogNone")}</option>
              {data.types.map((ty) => (
                <option key={ty.key} value={ty.key}>
                  {ty.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={label}>{t("settings.attributes.merge")}</span>
            <select
              name="mergeStrategy"
              defaultValue={editing?.mergeStrategy ?? "last"}
              style={control}
            >
              {(["first", "last", "accumulate", "max"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`settings.attributes.mergeKind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, height: 34 }}
          >
            <input type="checkbox" name="required" defaultChecked={editing?.required ?? false} />
            {t("settings.attributes.required")}
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Link
              href="/app/settings/alert-attributes"
              style={{
                ...btn,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              {t("common.cancel")}
            </Link>
            <button
              type="submit"
              style={{
                ...btn,
                background: "var(--brand)",
                borderColor: "var(--brand)",
                color: "#fff",
              }}
              data-testid="attribute-save"
            >
              {t("common.save")}
            </button>
          </div>
          <p style={{ margin: 0, gridColumn: "1 / -1", fontSize: 12, color: "var(--ink-3)" }}>
            {t("settings.attributes.formNote")}
          </p>
        </form>
      )}

      <div className="oi-panel" style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,2fr) 120px 120px 130px 140px auto",
            gap: 10,
            padding: "9px 16px",
            borderBottom: "1px solid var(--line)",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--ink-3)",
          }}
        >
          <span>{t("settings.attributes.col.attribute")}</span>
          <span>{t("settings.attributes.col.type")}</span>
          <span>{t("settings.attributes.col.required")}</span>
          <span>{t("settings.attributes.col.merge")}</span>
          <span>{t("settings.attributes.col.coverage")}</span>
          <span />
        </div>
        {data.rows.map((a, i) => {
          const c = data.coverage.get(a.key);
          const pct = c && c.total ? Math.round((c.present / c.total) * 100) : null;
          const sources = mappedBy(a.key);
          return (
            <div
              key={a.id}
              data-testid="attribute-row"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,2fr) 120px 120px 130px 140px auto",
                gap: 10,
                padding: "10px 16px",
                borderBottom: "1px solid var(--line-2)",
                alignItems: "center",
                fontSize: 13,
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{a.label}</span>{" "}
                <code style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{a.key}</code>
                {a.description && (
                  <span
                    style={{
                      display: "block",
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.description}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 12 }}>
                {t(`settings.attributes.kind.${a.type}`)}
                {a.type === "catalog" && a.catalogTypeKey ? (
                  <span style={{ color: "var(--ink-3)" }}>
                    {" "}
                    ·{" "}
                    {data.types.find((ty) => ty.key === a.catalogTypeKey)?.name ?? a.catalogTypeKey}
                  </span>
                ) : null}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: a.required ? "var(--wait)" : "var(--ink-3)",
                  fontWeight: a.required ? 600 : 400,
                }}
              >
                {a.required
                  ? t("settings.attributes.requiredYes")
                  : t("settings.attributes.requiredNo")}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
                {t(`settings.attributes.mergeKind.${a.mergeStrategy}`)}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color:
                    pct === null
                      ? "var(--ink-3)"
                      : pct < 50 && a.required
                        ? "var(--dang)"
                        : "var(--ink-2)",
                }}
                title={t("settings.attributes.coverageHint")}
              >
                {pct === null
                  ? "—"
                  : t("settings.attributes.coverage", { pct, sources: sources.length })}
              </span>
              <span style={{ display: "inline-flex", gap: 4 }}>
                {manages && (
                  <>
                    <form action={moveAttribute}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="dir" value="up" />
                      <button
                        type="submit"
                        disabled={i === 0}
                        style={icon}
                        aria-label={t("postMortem.moveUp")}
                      >
                        ↑
                      </button>
                    </form>
                    <form action={moveAttribute}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="dir" value="down" />
                      <button
                        type="submit"
                        disabled={i === data.rows.length - 1}
                        style={icon}
                        aria-label={t("postMortem.moveDown")}
                      >
                        ↓
                      </button>
                    </form>
                    <Link
                      href={`/app/settings/alert-attributes?edit=${a.id}`}
                      style={{
                        ...btn,
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      {t("common.edit")}
                    </Link>
                    <form action={deleteAttribute}>
                      <input type="hidden" name="id" value={a.id} />
                      <button
                        type="submit"
                        className="oi-hover-dang"
                        style={icon}
                        aria-label={t("common.delete")}
                      >
                        ✕
                      </button>
                    </form>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
        {t("settings.attributes.note")}
      </p>
    </div>
  );
}
