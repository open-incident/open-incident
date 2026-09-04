import { getT } from "@/i18n/server";
import { avatarTone, initials } from "@/lib/avatar";
import type { FollowUpRow } from "@/lib/incidents";
import { priorityTone } from "@/lib/tones";
import { toggleFollowUp } from "./follow-up-actions";
import { ExportFollowUp } from "./export-follow-up";

/** One follow-up line — checkbox, title, priority pill, incident, tracker ref, assignee, due date. */
export async function FollowUpRowView({
  row,
  showIncident,
  canAct = true,
  trackers = [],
}: {
  row: FollowUpRow;
  showIncident?: boolean;
  canAct?: boolean;
  /** Connected issue trackers the follow-up can be exported to (kinds and labels only). */
  trackers?: Array<{ kind: "github" | "gitlab" | "jira" | "linear"; label: string }>;
}) {
  const t = await getT();
  const done = row.status === "done";
  const prio = priorityTone(row.priorityName === "P1" ? 0 : row.priorityName === "P2" ? 1 : 2);
  const who = row.assigneeName ?? "—";
  const tone = row.assigneeName
    ? avatarTone(row.assigneeName)
    : { bg: "var(--sunk)", ink: "var(--ink-3)" };
  const due = done
    ? row.completedAt
      ? t("followUp.doneOn", { date: t.fmt.dateShort(row.completedAt) })
      : t("followUp.status.done")
    : row.dueAt
      ? row.overdue
        ? t("followUp.overdue", { date: t.fmt.dateShort(row.dueAt) })
        : t.fmt.dateShort(row.dueAt)
      : "—";

  return (
    <div
      className="oi-card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "12px 16px",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 13,
        boxShadow: "var(--shadow-card)",
      }}
    >
      <form action={toggleFollowUp} style={{ display: "contents" }}>
        <input type="hidden" name="id" value={row.id} />
        <button
          type="submit"
          disabled={!canAct}
          aria-label={done ? t("followUp.reopen") : t("followUp.complete")}
          aria-pressed={done}
          style={{
            width: 20,
            height: 20,
            flex: "none",
            borderRadius: 6,
            border: `1.5px solid ${done ? "var(--ok)" : "var(--line)"}`,
            background: done ? "var(--ok)" : "var(--panel)",
            display: "grid",
            placeItems: "center",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            cursor: canAct ? "pointer" : "default",
            padding: 0,
          }}
        >
          {done ? "✓" : ""}
        </button>
      </form>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 14,
          fontWeight: 500,
          color: done ? "var(--ink-3)" : "var(--ink)",
          textDecoration: done ? "line-through" : "none",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.title}
      </span>
      <span
        style={{
          padding: "2px 8px",
          borderRadius: 999,
          background: prio.bg,
          color: prio.ink,
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {row.priorityName ?? "—"}
      </span>
      {showIncident && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--ink-3)",
            whiteSpace: "nowrap",
            flex: "none",
          }}
        >
          INC-{row.incidentNumber}
        </span>
      )}
      <span style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
        {row.externalRef ? (
          row.externalRef.url ? (
            <a href={row.externalRef.url} className="oi-link" target="_blank" rel="noreferrer">
              {row.externalRef.tracker === "jira"
                ? "Jira"
                : row.externalRef.tracker === "github"
                  ? "GitHub"
                  : row.externalRef.tracker === "gitlab"
                    ? "GitLab"
                    : "Linear"}{" "}
              · {row.externalRef.key}
            </a>
          ) : (
            `${row.externalRef.tracker} · ${row.externalRef.key}`
          )
        ) : canAct && !done && trackers.length > 0 ? (
          <ExportFollowUp id={row.id} trackers={trackers} />
        ) : (
          "—"
        )}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, width: 150, flex: "none" }}>
        <span
          aria-hidden
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: tone.bg,
            color: tone.ink,
            display: "grid",
            placeItems: "center",
            fontSize: 9.5,
            fontWeight: 700,
          }}
        >
          {row.assigneeName ? initials(who) : "—"}
        </span>
        <span
          style={{
            fontSize: 12.5,
            color: "var(--ink-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {who}
        </span>
      </span>
      <span
        style={{
          width: 96,
          textAlign: "right",
          fontSize: 12,
          fontWeight: row.overdue ? 700 : 400,
          color: row.overdue ? "var(--dang)" : done ? "var(--ink-3)" : "var(--ink-2)",
          whiteSpace: "nowrap",
          flex: "none",
        }}
      >
        {due}
      </span>
    </div>
  );
}
