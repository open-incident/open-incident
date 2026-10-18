"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { saveSourceChoices } from "../../settings/alert-sources/actions";
import { chipStyle } from "./chip";
import { describeIncident, describePage, incidentOptions, pageNote, type Level } from "./describe";
import type { IncidentChoice, PageChoice } from "./choices";

type Named = { id: string; name: string };
export type PageKind = "owner" | "me" | "team" | "schedule" | "nobody";

/**
 * A chip that opens a list — "Platform ▾", "Schedule ▾". The native select
 * lies over the chip, transparent: the keyboard, the screen reader and the
 * phone's own picker all get a real select, the eye gets the design's chip.
 * Its first option is empty, so picking the name the chip shows still counts.
 */
export function ChipSelect({
  label,
  on,
  options,
  value,
  ariaLabel,
  testId,
  onPick,
}: {
  label: string;
  on: boolean;
  options: Named[];
  value: string;
  ariaLabel: string;
  testId?: string;
  onPick: (id: string) => void;
}) {
  return (
    <span style={{ ...chipStyle(on), position: "relative" }}>
      {label} ▾
      <select
        aria-label={ariaLabel}
        data-testid={testId}
        value={on ? value : ""}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          cursor: "pointer",
          width: "100%",
          height: "100%",
        }}
      >
        <option value="" disabled>
          {ariaLabel}
        </option>
        {options.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/** "Who to page": service owner, me, a team, a schedule, nobody. */
export function PageChips({
  kind,
  teamId,
  scheduleId,
  teams,
  schedules,
  extra,
  onPick,
}: {
  kind: PageKind | "other";
  teamId: string | null;
  scheduleId: string | null;
  teams: Named[];
  schedules: Named[];
  /** A path the chips cannot express, shown selected so the truth stays on screen. */
  extra?: string | null;
  onPick: (kind: PageKind, extra?: { teamId?: string; scheduleId?: string }) => void;
}) {
  const t = useT();
  const team = teams.find((x) => x.id === teamId) ?? null;
  const schedule = schedules.find((x) => x.id === scheduleId) ?? null;
  return (
    <>
      <button
        type="button"
        data-testid="choice-page-owner"
        onClick={() => onPick("owner")}
        style={chipStyle(kind === "owner")}
      >
        {t("alt2.choice.page.owner")}
      </button>
      <button
        type="button"
        data-testid="choice-page-me"
        onClick={() => onPick("me")}
        style={chipStyle(kind === "me")}
      >
        {t("alt2.choice.page.me")}
      </button>
      {teams.length > 0 && (
        <ChipSelect
          label={(kind === "team" && team ? team : teams[0]!).name}
          on={kind === "team"}
          options={teams}
          value={teamId ?? ""}
          ariaLabel={t("alt2.choice.page.teamLabel")}
          testId="choice-page-team"
          onPick={(id) => onPick("team", { teamId: id })}
        />
      )}
      {schedules.length > 0 && (
        <ChipSelect
          label={kind === "schedule" && schedule ? schedule.name : t("alst.choice.schedule")}
          on={kind === "schedule"}
          options={schedules}
          value={scheduleId ?? ""}
          ariaLabel={t("alt2.choice.page.scheduleLabel")}
          testId="choice-page-schedule"
          onPick={(id) => onPick("schedule", { scheduleId: id })}
        />
      )}
      <button
        type="button"
        data-testid="choice-page-nobody"
        onClick={() => onPick("nobody")}
        style={chipStyle(kind === "nobody")}
      >
        {t("alt2.choice.page.nobody")}
      </button>
      {kind === "other" && extra && (
        <span style={{ ...chipStyle(true), cursor: "default" }}>{extra}</span>
      )}
    </>
  );
}

/** The chips of "Open an incident". */
export function IncidentChips({
  incident,
  fromRank,
  levels,
  onPick,
}: {
  incident: IncidentChoice;
  fromRank: number | null;
  levels: Level[];
  onPick: (value: string) => void;
}) {
  const t = useT();
  return (
    <>
      {incidentOptions(t, incident, fromRank, levels).map((o) => (
        <button
          key={o.value}
          type="button"
          data-testid={`choice-incident-${o.value.replace(":", "-")}`}
          onClick={() => onPick(o.value)}
          style={chipStyle(o.on)}
        >
          {o.label}
        </button>
      ))}
    </>
  );
}

/** On / Off. */
export function AutoChips({ on, onPick }: { on: boolean; onPick: (on: boolean) => void }) {
  const t = useT();
  return (
    <>
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          data-testid={`choice-auto-${v ? "on" : "off"}`}
          onClick={() => onPick(v)}
          style={chipStyle(on === v)}
        >
          {v ? t("common.on") : t("common.off")}
        </button>
      ))}
    </>
  );
}

/** What the chips show for a choice read back from the database. */
export function pageState(
  page: PageChoice,
  readerId: string,
): { kind: PageKind | "other"; teamId: string | null; scheduleId: string | null } {
  if (page.kind === "owner" || page.kind === "nobody")
    return { kind: page.kind, teamId: null, scheduleId: null };
  if (page.kind === "member" && page.memberId === readerId)
    return { kind: "me", teamId: null, scheduleId: null };
  if (page.kind === "team") return { kind: "team", teamId: page.teamId, scheduleId: null };
  if (page.kind === "schedule")
    return { kind: "schedule", teamId: null, scheduleId: page.scheduleId };
  return { kind: "other", teamId: null, scheduleId: null };
}

/**
 * The three choices, on the source's own page.
 *
 * Each chip writes straight through to the source the pipeline reads, so the
 * screen never shows an intention: it shows what the next alert will do.
 */
export function ChoiceRows({
  sourceId,
  page,
  incident,
  fromRank,
  autoResolve,
  teams,
  schedules,
  levels,
  readerId,
  canEdit,
}: {
  sourceId: string;
  page: PageChoice;
  incident: IncidentChoice;
  fromRank: number | null;
  autoResolve: boolean;
  teams: Named[];
  schedules: Named[];
  levels: Level[];
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

  const state = pageState(page, readerId);

  return (
    <>
      {row(
        t("alt2.choice.pageTitle"),
        pageNote(t, levels),
        <PageChips
          kind={state.kind}
          teamId={state.teamId}
          scheduleId={state.scheduleId}
          teams={teams}
          schedules={schedules}
          extra={page.kind === "path" || page.kind === "member" ? page.name : null}
          onPick={(kind, extra) =>
            send("page", kind, {
              ...(extra?.teamId ? { teamId: extra.teamId } : {}),
              ...(extra?.scheduleId ? { scheduleId: extra.scheduleId } : {}),
            })
          }
        />,
        describePage(t, page, readerId),
      )}
      {row(
        t("alt2.choice.incidentTitle"),
        t("alt2.choice.incidentNote"),
        <IncidentChips
          incident={incident}
          fromRank={fromRank}
          levels={levels}
          onPick={(v) => send("incident", v)}
        />,
        describeIncident(t, incident, fromRank, levels),
      )}
      {row(
        t("alt2.choice.autoTitle"),
        t("alt2.choice.autoNote"),
        <AutoChips on={autoResolve} onPick={(v) => send("autoResolve", v ? "on" : "off")} />,
        autoResolve ? t("common.on") : t("common.off"),
      )}
    </>
  );
}
