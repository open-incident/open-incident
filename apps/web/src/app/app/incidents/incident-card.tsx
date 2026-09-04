import Link from "next/link";
import { getT } from "@/i18n/server";
import { avatarTone, initials } from "@/lib/avatar";
import type { IncidentRow } from "@/lib/incidents";
import { StatusPill } from "./status-pill";
import { severityInk } from "@/lib/tones";

/** One card of the list — the design's row: 13/16 padding, radius 13, hairline, resting shadow. */
export async function IncidentCard({ row }: { row: IncidentRow }) {
  const t = await getT();
  const lead = row.leadName ?? "—";
  const tone = row.leadName ? avatarTone(row.leadName) : { bg: "var(--sunk)", ink: "var(--ink-3)" };
  const declared = t.fmt.dateTime(row.declaredAt, t.timeZone);
  const by = row.creatorName
    ? t("incidents.card.declaredBy", { when: declared, actor: row.creatorName })
    : t("incidents.card.declaredFrom", {
        when: declared,
        source: t(
          `timeline.source.${(row.source === "alert" ? "alert" : row.source === "api" ? "api" : "web") as "alert" | "api" | "web"}`,
        ),
      });
  const subtitle = [
    row.visibility === "private" ? t("incidents.card.private") : "",
    row.phase === "triage" ? t("incidents.card.awaitingTriage") : by,
    row.region ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/app/incidents/${row.number}`}
      className="oi-card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 16px",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 13,
        boxShadow: "var(--shadow-card)",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 34,
          height: 34,
          flex: "none",
          borderRadius: "50%",
          background: tone.bg,
          color: tone.ink,
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {row.leadName ? initials(lead) : "—"}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--ink-3)",
              whiteSpace: "nowrap",
              flex: "none",
            }}
          >
            INC-{row.number}
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.name}
          </span>
          {row.visibility === "private" && (
            <span
              style={{
                padding: "1px 8px",
                borderRadius: 999,
                background: "var(--viol-t)",
                color: "var(--viol)",
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {t("incident.private")}
            </span>
          )}
          {row.mode === "test" && (
            <span
              style={{
                padding: "1px 8px",
                borderRadius: 999,
                background: "var(--sunk)",
                color: "var(--ink-2)",
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {t("incident.mode.test")}
            </span>
          )}
        </span>
        <span
          style={{
            fontSize: 12.5,
            color: "var(--ink-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subtitle}
        </span>
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          fontWeight: 500,
          color: severityInk(row.severityRank),
          whiteSpace: "nowrap",
        }}
      >
        {row.severityName ?? "—"}
      </span>
      <StatusPill row={row} />
      <span
        style={{
          width: 64,
          textAlign: "right",
          fontSize: 12,
          color: "var(--ink-3)",
          fontVariantNumeric: "tabular-nums",
          flex: "none",
        }}
      >
        {t.fmt.relativeCompact(row.lastActivityAt)}
      </span>
    </Link>
  );
}
