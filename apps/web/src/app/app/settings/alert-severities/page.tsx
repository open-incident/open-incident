import { asc, eq } from "drizzle-orm";
import { alertPriorities, severities, withTenant } from "@openincident/db";
import { DIGEST_AT } from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { ListCard, ListItem, SettingsPage, type ChipSpec } from "@/components/settings/template";
import { SeverityDialog } from "./severity-dialog";

/**
 * Settings › Alert severities (design V2): P1 to P4 — what an alert is worth,
 * and what each level does on its own.
 *
 * "On its own" is read, not invented: a level's urgency decides whether the
 * person on call is woken (the default personal rule calls at high urgency;
 * at low it sends a silent push and the morning email digest), and with no
 * rule saying otherwise an incident opens only for an alert that wakes
 * people — at the incident severity of the same rank, the pipeline's own
 * pairing.
 */
export default async function AlertSeveritiesPage() {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => ({
    levels: await tx
      .select()
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenant.id))
      .orderBy(asc(alertPriorities.rank)),
    sevs: await tx
      .select({ name: severities.name, rank: severities.rank })
      .from(severities)
      .where(eq(severities.tenantId, tenant.id))
      .orderBy(asc(severities.rank)),
  }));
  const { levels, sevs } = data;
  // The pipeline's pairing: same rank in both lists, the last one catching the rest.
  const opensAs = (rank: number) => sevs.find((s) => s.rank === rank) ?? sevs[sevs.length - 1];

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.alerts")}
      title={t("settingsV2.entry.alertSeverities")}
      lead={
        levels.length >= 2
          ? t("settingsV2.asev.lead", {
              first: levels[0]!.name,
              last: levels[levels.length - 1]!.name,
            })
          : t("settingsV2.asev.leadNone")
      }
      testId="settings-alert-severities"
    >
      <ListCard
        testId="severities-card"
        title={t("settingsV2.asev.listTitle", { count: levels.length })}
        foot={
          levels.length === 4
            ? t("settingsV2.asev.foot4")
            : t("settingsV2.asev.footN", { count: levels.length })
        }
      >
        {levels.length === 0 && (
          <div
            style={{
              padding: "14px 18px",
              borderTop: "1px solid var(--line-2)",
              fontSize: 13,
              color: "var(--ink-3)",
            }}
          >
            {t("settingsV2.asev.empty")}
          </div>
        )}
        {levels.map((p) => {
          const wakes = p.urgency === "high";
          const sev = opensAs(p.rank);
          const sub = wakes
            ? [
                t("settingsV2.asev.wakes"),
                ...(sev ? [t("settingsV2.asev.opens", { severity: sev.name })] : []),
              ]
            : [t("settingsV2.asev.silent", { time: DIGEST_AT }), t("settingsV2.asev.noIncident")];
          const chips: ChipSpec[] = wakes
            ? [{ label: t("settingsV2.asev.chipWakes"), tone: "wait" }]
            : [
                { label: t("settingsV2.asev.chipSilent"), tone: "mute" },
                { label: t("settingsV2.asev.chipDigest"), tone: "mute" },
              ];
          if (p.isDefault) chips.push({ label: t("settingsV2.asev.chipDefault"), tone: "brand" });
          return (
            <ListItem
              key={p.id}
              testId="priority-row"
              data={{ level: p.name }}
              dot={p.color}
              title={p.description ? `${p.name} — ${p.description}` : p.name}
              sub={sub.join(" · ")}
              chips={chips}
              button={
                manages ? (
                  <SeverityDialog
                    level={{
                      id: p.id,
                      name: p.name,
                      description: p.description ?? "",
                      urgency: p.urgency,
                      color: p.color,
                      aliases: p.aliases,
                      isDefault: p.isDefault,
                    }}
                  />
                ) : undefined
              }
            />
          );
        })}
      </ListCard>
    </SettingsPage>
  );
}
