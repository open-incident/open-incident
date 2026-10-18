import { asc, eq } from "drizzle-orm";
import { severities, statusPages, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { severityInk } from "@/lib/tones";
import { ListCard, ListItem, SettingsPage } from "@/components/settings/template";
import { SeverityDialog } from "./severity-dialog";

/**
 * Settings › Severities (design V2): one list, from the worst — each with its
 * colour, its name and the word that titles it, what it means, and what it
 * drives: the post-incident flow, a status page proposal. "+ Add severity"
 * adds one at the end; "Edit" changes one; both on the same four rows.
 *
 * The description carries the title by convention — "Critical — The product
 * is down…": the declaration form reads it the same way.
 */
export default async function SeveritiesPage() {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => {
    const sevs = await tx
      .select()
      .from(severities)
      .where(eq(severities.tenantId, tenant.id))
      .orderBy(asc(severities.rank));
    // The page an incident proposes to update: the workspace's first.
    const [page] = await tx
      .select({ name: statusPages.name, minSeverityRank: statusPages.minSeverityRank })
      .from(statusPages)
      .where(eq(statusPages.tenantId, tenant.id))
      .orderBy(asc(statusPages.createdAt))
      .limit(1);
    return { sevs, page: page ?? null };
  });

  const split = (description: string | null): { label: string | null; text: string | null } => {
    if (!description) return { label: null, text: null };
    const [head, ...rest] = description.split(" — ");
    if (rest.length && head && head.length <= 24) return { label: head, text: rest.join(" — ") };
    return { label: null, text: description };
  };

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.incidents")}
      title={t("settingsV2.entry.severities")}
      lead={t("settingsV2.sev.lead")}
      actions={manages ? <SeverityDialog page={data.page?.name ?? null} /> : null}
      testId="settings-severities"
    >
      <ListCard
        title={t("settingsV2.sev.count", { count: data.sevs.length })}
        foot={t("settingsV2.sev.foot")}
        testId="sev-list"
      >
        {data.sevs.map((sv, i) => {
          const { label, text } = split(sv.description);
          const startsPost = sv.postIncident === "always" || sv.postIncident === "yes";
          const proposes = data.page !== null && sv.rank <= data.page.minSeverityRank;
          return (
            <ListItem
              key={sv.id}
              testId="sev-row"
              data={{ severity: sv.name }}
              dot={severityInk(sv.rank)}
              title={label ? `${sv.name} — ${label}` : sv.name}
              sub={text ?? undefined}
              chips={[
                ...(startsPost
                  ? [{ label: t("settingsV2.sev.chipPost"), tone: "brand" as const }]
                  : []),
                ...(proposes
                  ? [{ label: t("settingsV2.sev.chipStatus"), tone: "brand" as const }]
                  : []),
              ]}
              button={
                manages ? (
                  <SeverityDialog
                    page={data.page?.name ?? null}
                    severity={{
                      id: sv.id,
                      name: sv.name,
                      description: sv.description,
                      startsPost,
                      proposes,
                      worst: i === 0,
                    }}
                  />
                ) : undefined
              }
            />
          );
        })}
        {data.sevs.length === 0 && (
          <div
            style={{
              padding: "11px 18px",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
              color: "var(--ink-3)",
            }}
          >
            {t("settingsV2.sev.empty")}
          </div>
        )}
      </ListCard>
    </SettingsPage>
  );
}
