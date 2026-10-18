import { asc, eq } from "drizzle-orm";
import { alertAttributes, alertAttributeTypeOf, withTenant } from "@openincident/db";
import { redact } from "@openincident/ai";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { ListCard, SettingsPage, type ChipSpec } from "@/components/settings/template";
import { LabelRow, type LabelSettings } from "./label-row";
import { observedLabels } from "./observed";

/**
 * Settings › Labels (design V2): the keys seen in the workspace's alerts over
 * ninety days — observed, never declared. Each row: the key, its values, how
 * many alerts carry it, and what the product does with it — the key that
 * names a service ties alerts to Services and their owners; a key whose values
 * the redaction before any model call rewrites (emails, phone numbers,
 * addresses, internal hosts, secrets) is redacted before Atlas.
 *
 * How the pipeline reads a key (the old declared attributes: what it names,
 * required, what a repeat does) is still a real setting the ingest reads; a
 * manager opens it from the label's row. A key somebody declared that matters
 * to ingestion — required, or naming a service, a team or a severity — stays
 * listed while no alert carries it, so it can be undone.
 */
export default async function LabelsPage() {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => ({
    observed: await observedLabels(tx, tenant.id),
    declared: await tx
      .select()
      .from(alertAttributes)
      .where(eq(alertAttributes.tenantId, tenant.id))
      .orderBy(asc(alertAttributes.position), asc(alertAttributes.createdAt)),
  }));

  const settingsOf = (key: string): LabelSettings => {
    const d = data.declared.find((x) => x.key === key);
    return {
      key,
      label: d?.label ?? key,
      type: d
        ? alertAttributeTypeOf(d)
        : key === "service"
          ? "service"
          : key === "team"
            ? "team"
            : "text",
      required: d?.required ?? false,
      mergeStrategy: d?.mergeStrategy ?? "last",
    };
  };
  const chipsOf = (s: LabelSettings, values: string[]): Array<ChipSpec & { label: string }> => {
    const chips: Array<ChipSpec & { label: string }> = [];
    // The ingest matches `service` against the workspace's services and fills
    // in the owner team; a key declared as a service is read the same way.
    if (s.key === "service" || s.type === "service")
      chips.push({
        label: t("settingsV2.labels.chipServices"),
        tone: "brand",
        testId: "label-services",
      });
    if (values.some((v) => redact(v) !== v))
      chips.push({
        label: t("settingsV2.labels.chipRedacted"),
        tone: "brand",
        testId: "label-redacted",
      });
    if (s.required)
      chips.push({
        label: t("settingsV2.labels.chipRequired"),
        tone: "wait",
        testId: "label-required-chip",
      });
    return chips;
  };

  const seen = new Set(data.observed.map((o) => o.key));
  const unseen = data.declared.filter(
    (d) => !seen.has(d.key) && (d.required || alertAttributeTypeOf(d) !== "text"),
  );

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.alerts")}
      title={t("settingsV2.entry.labels")}
      lead={t("settingsV2.labels.lead")}
      testId="settings-labels"
    >
      <ListCard
        testId="labels-card"
        title={t("settingsV2.labels.listTitle", { count: data.observed.length })}
        foot={t("settingsV2.labels.foot")}
      >
        {data.observed.length === 0 && unseen.length === 0 && (
          <div
            style={{
              padding: "14px 18px",
              borderTop: "1px solid var(--line-2)",
              fontSize: 13,
              color: "var(--ink-3)",
            }}
          >
            {t("settingsV2.labels.empty")}
          </div>
        )}
        {data.observed.map((o) => {
          const s = settingsOf(o.key);
          return (
            <LabelRow
              key={o.key}
              settings={s}
              sub={
                o.distinct <= 4
                  ? o.values.slice(0, 4).join(", ")
                  : t("settingsV2.labels.values", { count: o.distinct })
              }
              chips={chipsOf(s, o.values)}
              right={t("settingsV2.labels.alerts", { count: o.alerts })}
              editable={manages}
            />
          );
        })}
        {unseen.map((d) => {
          const s = settingsOf(d.key);
          return (
            <LabelRow
              key={d.key}
              settings={s}
              sub={d.label !== d.key ? d.label : ""}
              chips={chipsOf(s, [])}
              right={t("settingsV2.labels.unseen")}
              muted
              editable={manages}
            />
          );
        })}
      </ListCard>
    </SettingsPage>
  );
}
