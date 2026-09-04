import { getT } from "@/i18n/server";
import type { IncidentRow } from "@/lib/incidents";
import { phaseTone } from "@/lib/tones";

/** The status pill — 11.5/600, tinted, a 5 px dot before the word. */
export async function StatusPill({
  row,
  size = "md",
  publicStatus,
}: {
  row: Pick<IncidentRow, "phase" | "statusName">;
  size?: "md" | "lg";
  publicStatus?: string | null;
}) {
  const t = await getT();
  const label =
    row.phase === "active" && row.statusName
      ? row.statusName
      : t(
          `incident.phase.${row.phase}` as
            | "incident.phase.triage"
            | "incident.phase.active"
            | "incident.phase.post_incident"
            | "incident.phase.closed",
        );
  const tone = phaseTone(
    row.phase,
    publicStatus ??
      (row.statusName?.toLowerCase().startsWith("surv") ||
      row.statusName?.toLowerCase().startsWith("monit") ||
      row.statusName?.toLowerCase().startsWith("beob")
        ? "monitoring"
        : row.phase === "active"
          ? "investigating"
          : null),
  );
  const lg = size === "lg";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: lg ? "4px 12px 4px 10px" : "4px 11px 4px 9px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.ink,
        fontSize: lg ? 12 : 11.5,
        fontWeight: lg ? 700 : 600,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: tone.ink }} />
      {label}
    </span>
  );
}
