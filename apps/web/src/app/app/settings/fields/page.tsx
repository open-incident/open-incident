import { asc, eq } from "drizzle-orm";
import { incidentFields, incidentTypes, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { NewFieldDialog } from "./new-field";
import { deleteField } from "./actions";

/**
 * Settings → Custom fields: one row per field — key in mono, the type as a
 * tinted chip, description, and the type it belongs to. A field carried by a
 * type's form is required or optional there; the form is what reads it.
 */
export default async function FieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const { saved, error } = await searchParams;
  const data = await withTenant(tenant.id, async (tx) => ({
    fields: await tx
      .select()
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, tenant.id))
      .orderBy(asc(incidentFields.position)),
    types: await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenant.id))
      .orderBy(asc(incidentTypes.position)),
  }));
  const tone: Record<string, [string, string]> = {
    text: ["var(--sunk)", "var(--ink-2)"],
    long_text: ["var(--sunk)", "var(--ink-2)"],
    select: ["var(--open-t)", "var(--open)"],
    number: ["var(--viol-t)", "var(--viol)"],
    link: ["var(--wait-t)", "var(--wait)"],
    catalog_entry: ["var(--brand-t)", "var(--brand)"],
  };
  const typeLabel = (k: string) =>
    t(
      `settings.fields.type.${k as "text" | "long_text" | "select" | "number" | "link" | "catalog_entry"}`,
    );

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 920 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.fields.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.fields.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        {saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {error === "duplicate"
              ? t("settings.fields.errorDuplicate")
              : error === "options"
                ? t("settings.fields.errorOptions")
                : t("settings.fields.errorInvalid")}
          </span>
        )}
        <NewFieldDialog
          types={data.types.map((ty) => ({ id: ty.id, name: ty.name, isDefault: ty.isDefault }))}
        />
      </div>
      <div className="oi-panel" style={{ overflow: "hidden" }}>
        {data.fields.map((f, i) => {
          const [bg, ink] = tone[f.type] ?? tone.text!;
          const owner = data.types.find((ty) => ty.id === f.incidentTypeId);
          const inForm = owner?.declareForm.find((x) => x.key === f.key);
          const desc = [
            f.description,
            f.type === "select" ? f.options.join(", ") : null,
            inForm
              ? inForm.required
                ? t("settings.fields.requiredAtDeclare")
                : t("common.optional")
              : t("settings.fields.notInForm"),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={f.id}
              data-testid="field-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 16px",
                borderBottom: i < data.fields.length - 1 ? "1px solid var(--line-2)" : undefined,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                  fontWeight: 500,
                  width: 150,
                  flex: "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.key}
              </span>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: bg,
                  color: ink,
                  fontSize: 10.5,
                  fontWeight: 700,
                  flex: "none",
                }}
              >
                {typeLabel(f.type)}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  color: "var(--ink-2)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {desc}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                {owner
                  ? t("settings.fields.ofType", { type: owner.name })
                  : t("settings.fields.allTypes")}
              </span>
              <form action={deleteField}>
                <input type="hidden" name="id" value={f.id} />
                <button
                  type="submit"
                  className="oi-hover-dang"
                  style={{
                    height: 26,
                    padding: "0 10px",
                    border: "1px solid var(--line)",
                    borderRadius: 7,
                    background: "var(--panel)",
                    fontSize: 11,
                    color: "var(--dang)",
                    cursor: "pointer",
                  }}
                >
                  {t("common.delete")}
                </button>
              </form>
            </div>
          );
        })}
        {data.fields.length === 0 && (
          <div style={{ padding: 20, fontSize: 12.5, color: "var(--ink-3)" }}>
            {t("settings.fields.empty")}
          </div>
        )}
      </div>
      <div className="oi-note">{t("settings.fields.note")}</div>
    </div>
  );
}
