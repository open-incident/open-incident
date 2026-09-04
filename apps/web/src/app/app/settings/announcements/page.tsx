import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  announcementRules,
  announcementTemplates,
  incidentTypes,
  incidents,
  severities,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { NewRuleDialog, NewTemplateDialog } from "./dialogs";
import { deleteRule, deleteTemplate, toggleRule } from "./actions";

/**
 * Settings → Announcements: templates on the left (name, body with its
 * variables), rules on the right (name, active chip, condition chips → audience
 * and template chips, how often it fired). Each rule is a wired automation with
 * one writer — lib/announcements.ts — traced in the timeline.
 */
export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const { saved, error } = await searchParams;
  const data = await withTenant(tenant.id, async (tx) => {
    const templates = await tx
      .select()
      .from(announcementTemplates)
      .where(eq(announcementTemplates.tenantId, tenant.id))
      .orderBy(asc(announcementTemplates.position));
    const rules = await tx
      .select()
      .from(announcementRules)
      .where(eq(announcementRules.tenantId, tenant.id))
      .orderBy(desc(announcementRules.createdAt));
    const sevs = await tx
      .select()
      .from(severities)
      .where(eq(severities.tenantId, tenant.id))
      .orderBy(asc(severities.rank));
    const types = await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenant.id))
      .orderBy(asc(incidentTypes.position));
    const lastIds = rules.map((r) => r.lastIncidentId).filter((x): x is string => Boolean(x));
    const lastIncidents = lastIds.length
      ? await tx
          .select({ id: incidents.id, number: incidents.number })
          .from(incidents)
          .where(inArray(incidents.id, lastIds))
      : [];
    return { templates, rules, sevs, types, lastIncidents };
  });
  const audienceLabel = (a: string) =>
    t(`settings.announcements.audience.${a as "workspace" | "owner_team" | "role_holders"}`);
  const mono: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    background: "var(--sunk)",
    borderRadius: 999,
    padding: "2px 8px",
  };
  const brandChip: React.CSSProperties = {
    ...mono,
    background: "var(--brand-t)",
    color: "var(--brand)",
  };

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 920 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.announcements.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.announcements.subtitle")}
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
              ? t("settings.announcements.errorDuplicate")
              : t("settings.fields.errorInvalid")}
          </span>
        )}
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}
      >
        <div className="oi-panel" style={{ overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {t("settings.announcements.templates")}
            </span>
            <span style={{ flex: 1 }} />
            <NewTemplateDialog />
          </div>
          {data.templates.map((tpl, i) => (
            <div
              key={tpl.id}
              data-testid="template-row"
              style={{
                padding: "12px 16px",
                borderBottom: i < data.templates.length - 1 ? "1px solid var(--line-2)" : undefined,
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{tpl.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
                  « {tpl.body} » · {audienceLabel(tpl.audience)}
                </div>
              </div>
              <form action={deleteTemplate}>
                <input type="hidden" name="id" value={tpl.id} />
                <button
                  type="submit"
                  aria-label={t("common.delete")}
                  className="oi-hover-dang"
                  style={{
                    height: 24,
                    width: 24,
                    border: 0,
                    borderRadius: 6,
                    background: "transparent",
                    color: "var(--ink-3)",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  ✕
                </button>
              </form>
            </div>
          ))}
          {data.templates.length === 0 && (
            <div style={{ padding: 16, fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("settings.announcements.noTemplates")}
            </div>
          )}
        </div>
        <div className="oi-panel" style={{ overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {t("settings.announcements.rules")}
            </span>
            <span style={{ flex: 1 }} />
            <NewRuleDialog
              templates={data.templates.map((x) => ({ id: x.id, name: x.name }))}
              severities={data.sevs.map((s) => ({ rank: s.rank, name: s.name }))}
              types={data.types.map((x) => ({ id: x.id, name: x.name }))}
            />
          </div>
          {data.rules.map((r, i) => {
            const tpl = data.templates.find((x) => x.id === r.templateId);
            const sev =
              r.minSeverityRank === null
                ? null
                : data.sevs.find((s) => s.rank === r.minSeverityRank);
            const type = r.typeId ? data.types.find((x) => x.id === r.typeId) : null;
            const last = r.lastIncidentId
              ? data.lastIncidents.find((x) => x.id === r.lastIncidentId)
              : null;
            return (
              <div
                key={r.id}
                data-testid="rule-row"
                style={{
                  padding: "12px 16px",
                  borderBottom: i < data.rules.length - 1 ? "1px solid var(--line-2)" : undefined,
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: r.active ? "var(--ok-t)" : "var(--sunk)",
                      color: r.active ? "var(--ok)" : "var(--ink-3)",
                      fontSize: 10.5,
                      fontWeight: 700,
                    }}
                  >
                    {r.active
                      ? t("settings.announcements.active")
                      : t("settings.announcements.inactive")}
                  </span>
                  <span style={{ flex: 1 }} />
                  <form action={toggleRule}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="oi-hover"
                      style={{
                        height: 24,
                        padding: "0 9px",
                        border: "1px solid var(--line)",
                        borderRadius: 7,
                        background: "var(--panel)",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {r.active
                        ? t("settings.announcements.disable")
                        : t("settings.announcements.enable")}
                    </button>
                  </form>
                  <form action={deleteRule}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      aria-label={t("common.delete")}
                      className="oi-hover-dang"
                      style={{
                        height: 24,
                        width: 24,
                        border: 0,
                        borderRadius: 6,
                        background: "transparent",
                        color: "var(--ink-3)",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      ✕
                    </button>
                  </form>
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                  {sev ? (
                    <span style={mono}>
                      {t("settings.announcements.ifSeverity", { severity: sev.name })}
                    </span>
                  ) : (
                    <span style={mono}>{t("settings.announcements.anySeverity")}</span>
                  )}
                  {type && (
                    <span style={mono}>
                      {t("settings.announcements.andType", { type: type.name })}
                    </span>
                  )}
                  <span style={{ fontSize: 10.5, color: "var(--ink-3)", padding: "2px 0" }}>→</span>
                  <span style={brandChip}>
                    {t("settings.announcements.audienceChip", {
                      audience: audienceLabel(r.audience),
                    })}
                  </span>
                  <span style={brandChip}>
                    {t("settings.announcements.templateChip", { template: tpl?.name ?? "—" })}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {t("settings.announcements.triggered", { count: r.triggeredCount })}
                  {last
                    ? ` · ${t("settings.announcements.lastIncident", { number: `INC-${last.number}` })}`
                    : ""}
                </div>
              </div>
            );
          })}
          {data.rules.length === 0 && (
            <div style={{ padding: 16, fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("settings.announcements.noRules")}
            </div>
          )}
        </div>
      </div>
      <div className="oi-note">{t("settings.announcements.note")}</div>
    </div>
  );
}
