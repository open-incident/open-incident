import { asc, eq } from "drizzle-orm";
import { incidentFields, incidentTypes, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { ListCard, ListItem, SettingsPage, type ChipSpec } from "@/components/settings/template";
import { FieldDialog } from "./field-dialog";

/**
 * Settings › Custom fields (design V2): one list — each field's name, its
 * kind and options, whether declaring asks for it, and the types it belongs
 * to. "+ New field" and "Edit" share one dialog; a field exists to be read,
 * and the declaration form of its types is its first reader.
 */
export default async function FieldsPage() {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const manages = isManager(member);
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
      .orderBy(asc(incidentTypes.position), asc(incidentTypes.createdAt)),
  }));
  const typeOptions = data.types.map((ty) => ({ id: ty.id, name: ty.name }));
  const list = (names: string[]) =>
    new Intl.ListFormat(t.locale.tag, { type: "conjunction" }).format(names);

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.incidents")}
      title={t("settingsV2.entry.fields")}
      lead={t("settingsV2.fields.lead")}
      actions={manages ? <FieldDialog types={typeOptions} /> : null}
      testId="settings-fields"
    >
      <ListCard
        title={t("settingsV2.fields.count", { count: data.fields.length })}
        testId="fields-list"
      >
        {data.fields.map((f) => {
          const owner = f.incidentTypeId
            ? data.types.find((ty) => ty.id === f.incidentTypeId)
            : undefined;
          // The types that may ask for it, and how each of their forms does.
          const covered = owner ? [owner] : data.types;
          const asks = covered.map((ty) => ({
            type: ty.name,
            entry: ty.declareForm.find((x) => x.key === f.key),
          }));
          const requiredBy = asks.filter((a) => a.entry?.required).map((a) => a.type);
          const asked = asks.some((a) => a.entry);
          const need: ChipSpec =
            requiredBy.length && requiredBy.length === asks.length
              ? { label: t("settingsV2.fields.required"), tone: "wait" }
              : requiredBy.length
                ? {
                    label: t("settingsV2.fields.requiredFor", { types: list(requiredBy) }),
                    tone: "wait",
                  }
                : asked
                  ? { label: t("settingsV2.fields.optional") }
                  : { label: t("settingsV2.fields.notAsked") };
          const kind = t(`settingsV2.fields.kind.${f.type}`);
          const detail = f.type === "select" ? f.options.join(", ") : f.description;
          return (
            <ListItem
              key={f.id}
              testId="field-row"
              data={{ key: f.key }}
              title={f.label}
              sub={detail ? `${kind} · ${detail}` : kind}
              muted={f.type === "catalog_entry"}
              chips={[need, { label: owner ? owner.name : t("settingsV2.fields.allTypes") }]}
              button={
                manages ? (
                  <FieldDialog
                    types={typeOptions}
                    field={{
                      id: f.id,
                      key: f.key,
                      name: f.label,
                      kind: f.type,
                      options: f.options,
                      required: requiredBy.length > 0 && requiredBy.length === asks.length,
                      typeId: f.incidentTypeId,
                    }}
                  />
                ) : undefined
              }
            />
          );
        })}
        {data.fields.length === 0 && (
          <div
            style={{
              padding: "11px 18px",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
              color: "var(--ink-3)",
            }}
          >
            {t("settingsV2.fields.empty")}
          </div>
        )}
      </ListCard>
    </SettingsPage>
  );
}
