import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { incidentTypes, postIncidentTaskDefs, severities, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { NewTaskDialog } from "./new-task";
import { deleteTask, savePostMortemTerm } from "./actions";

/**
 * Settings → Post-incident flow: the two phases and their tasks, the automatic
 * entry rule as the default type states it, and the word the workspace uses
 * for its post-mortem.
 */
export default async function PostIncidentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { tenant, workspace } = await requireMember();
  const t = await getT();
  const { saved, error } = await searchParams;
  const data = await withTenant(tenant.id, async (tx) => ({
    defs: await tx
      .select()
      .from(postIncidentTaskDefs)
      .where(eq(postIncidentTaskDefs.tenantId, tenant.id))
      .orderBy(asc(postIncidentTaskDefs.phase), asc(postIncidentTaskDefs.position)),
    defaultType:
      (
        await tx
          .select()
          .from(incidentTypes)
          .where(eq(incidentTypes.tenantId, tenant.id))
          .orderBy(asc(incidentTypes.position))
      ).find((x) => x.isDefault) ?? null,
    sevs: await tx
      .select()
      .from(severities)
      .where(eq(severities.tenantId, tenant.id))
      .orderBy(asc(severities.rank)),
  }));
  const rule = data.defaultType?.postIncidentFromRank;
  const ruleLabel =
    rule === null || rule === undefined
      ? t("settings.types.postNever")
      : rule === -1
        ? t("settings.types.postAlways")
        : t("settings.types.postFrom", {
            severity: data.sevs.find((s) => s.rank === rule)?.name ?? "—",
          });

  const phaseCard = (phase: "documenting" | "reviewing", n: number) => {
    const rows = data.defs.filter((d) => d.phase === phase);
    return (
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
            {t("settings.postIncident.phaseTitle", { n, name: t(`postIncident.phase.${phase}`) })}
          </span>
        </div>
        {rows.map((d) => (
          <div
            key={d.id}
            data-testid="task-def-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 16px",
              borderBottom: "1px solid var(--line-2)",
              fontSize: 12.5,
            }}
          >
            <span style={{ color: "var(--ink-3)" }}>⠿</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              {d.title}
              <span style={{ color: "var(--ink-3)" }}>
                {d.defaultAssigneeRole
                  ? ` — ${t(`settings.postIncident.assignee.${d.defaultAssigneeRole as "lead" | "communication"}`)}`
                  : ""}
                {d.dueAfterDays
                  ? ` · ${t("settings.postIncident.dueAfter", { count: d.dueAfterDays })}`
                  : ""}
              </span>
            </span>
            <form action={deleteTask}>
              <input type="hidden" name="id" value={d.id} />
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
        <NewTaskDialog phase={phase} />
      </div>
    );
  };

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 920 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.postIncident.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.postIncident.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        {saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {t("settings.fields.errorInvalid")}
          </span>
        )}
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}
      >
        {phaseCard("documenting", 1)}
        {phaseCard("reviewing", 2)}
      </div>
      <div
        className="oi-panel"
        style={{ padding: "15px 18px", display: "flex", flexDirection: "column", gap: 11 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12.5,
            color: "var(--ink-2)",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: rule === null || rule === undefined ? "var(--ink-3)" : "var(--ok)",
              flex: "none",
            }}
          />
          <span>
            {t("settings.postIncident.autoEntry")}{" "}
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                background: "var(--sunk)",
                borderRadius: 6,
                padding: "1px 7px",
              }}
            >
              {ruleLabel}
            </span>{" "}
            — {t("settings.postIncident.autoEntryNote")}
          </span>
          <Link
            href="/app/settings/types"
            className="oi-link"
            style={{ fontSize: 12, fontWeight: 600 }}
          >
            {t("settings.postIncident.editInTypes")}
          </Link>
        </div>
        <form
          action={savePostMortemTerm}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12.5,
            color: "var(--ink-2)",
            flexWrap: "wrap",
          }}
        >
          <span className="oi-label" style={{ width: 150, flex: "none" }}>
            {t("settings.postIncident.term")}
          </span>
          <input
            name="term"
            defaultValue={workspace.postMortemTerm ?? ""}
            placeholder={t("postMortem.title")}
            maxLength={40}
            className="oi-field"
            style={{
              height: 34,
              padding: "0 12px",
              border: "1px solid var(--line)",
              borderRadius: 9,
              outline: "none",
              fontSize: 13,
              width: 200,
              background: "var(--panel)",
            }}
          />
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
            {t("settings.postIncident.termHint")}
          </span>
          <button
            type="submit"
            className="oi-hover"
            style={{
              height: 30,
              padding: "0 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--panel)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("common.save")}
          </button>
        </form>
      </div>
    </div>
  );
}
