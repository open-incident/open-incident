"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { saveSourceChoices } from "../../settings/alert-sources/actions";
import { chipStyle } from "./chip";
import { describeIncident, describePage } from "./describe";
import type { IncidentChoice, PageChoice } from "./choices";

type Named = { id: string; name: string };

/**
 * The three choices, on the source's own page.
 *
 * Each chip writes straight through to the route the pipeline reads, so the
 * screen never shows an intention: it shows what the next alert will do.
 */
export function ChoiceRows({
  sourceId,
  page,
  incident,
  autoResolve,
  teams,
  schedules,
  urgentFrom,
  readerId,
  canEdit,
}: {
  sourceId: string;
  page: PageChoice;
  incident: IncidentChoice;
  autoResolve: boolean;
  teams: Named[];
  schedules: Named[];
  urgentFrom: string | null;
  readerId: string;
  canEdit: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const send = (field: string, value: string, extra?: Record<string, string>) =>
    start(async () => {
      const data = new FormData();
      data.set("id", sourceId);
      data.set("field", field);
      data.set("value", value);
      for (const [k, v] of Object.entries(extra ?? {})) data.set(k, v);
      await saveSourceChoices(data);
      router.refresh();
    });

  const row = (title: string, note: string, chips: React.ReactNode, value: string) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "150px minmax(0,1fr)",
        gap: 14,
        alignItems: "start",
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>{note}</div>
      </div>
      {canEdit ? (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {chips}
        </div>
      ) : (
        <div style={{ fontSize: 13, fontWeight: 600, paddingTop: 6 }}>{value}</div>
      )}
    </div>
  );

  const teamOn = page.kind === "team";
  const scheduleOn = page.kind === "schedule";

  return (
    <>
      {row(
        t("alt2.choice.pageTitle"),
        t("alt2.choice.pageNote"),
        <>
          <button
            type="button"
            onClick={() => send("page", "owner")}
            style={chipStyle(page.kind === "owner")}
          >
            {t("alt2.choice.page.owner")}
          </button>
          <button
            type="button"
            onClick={() => send("page", "me")}
            style={chipStyle(page.kind === "member" && page.memberId === readerId)}
          >
            {t("alt2.choice.page.me")}
          </button>
          {teams.length > 0 && (
            <select
              aria-label={t("alt2.choice.page.teamLabel")}
              value={teamOn ? page.teamId : (teams[0]?.id ?? "")}
              onChange={(e) => send("page", "team", { teamId: e.target.value })}
              style={{ ...chipStyle(teamOn), appearance: "auto" }}
            >
              {teams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
          {schedules.length > 0 && (
            <select
              aria-label={t("alt2.choice.page.scheduleLabel")}
              value={scheduleOn ? page.scheduleId : (schedules[0]?.id ?? "")}
              onChange={(e) => send("page", "schedule", { scheduleId: e.target.value })}
              style={{ ...chipStyle(scheduleOn), appearance: "auto" }}
            >
              {schedules.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => send("page", "nobody")}
            style={chipStyle(page.kind === "nobody")}
          >
            {t("alt2.choice.page.nobody")}
          </button>
          {page.kind === "path" && (
            <span style={{ ...chipStyle(true), cursor: "default" }}>{page.name}</span>
          )}
        </>,
        describePage(t, page, readerId),
      )}
      {row(
        t("alt2.choice.incidentTitle"),
        t("alt2.choice.incidentNote"),
        <>
          {(
            [
              ["triage", t("alt2.choice.incident.triage")],
              [
                "urgent",
                urgentFrom
                  ? t("alt2.choice.incident.urgentFrom", { priority: urgentFrom })
                  : t("alt2.choice.incident.urgent"),
              ],
              ["never", t("alt2.choice.incident.never")],
            ] as Array<[IncidentChoice, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => send("incident", id)}
              style={chipStyle(incident === id)}
            >
              {label}
            </button>
          ))}
        </>,
        describeIncident(t, incident, urgentFrom),
      )}
      {row(
        t("alt2.choice.autoTitle"),
        t("alt2.choice.autoNote"),
        <>
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => send("autoResolve", v ? "on" : "off")}
              style={chipStyle(autoResolve === v)}
            >
              {v ? t("common.on") : t("common.off")}
            </button>
          ))}
        </>,
        autoResolve ? t("common.on") : t("common.off"),
      )}
    </>
  );
}
