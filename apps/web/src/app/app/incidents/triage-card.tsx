import Link from "next/link";
import { getT } from "@/i18n/server";
import type { IncidentRow } from "@/lib/incidents";
import { acceptTriage, declineTriage } from "./triage-actions";

/**
 * A triage card: number, title, the Triage pill, how long ago, the attributes
 * the alert carried, and the two decisions — accept (a real transition) or
 * decline with a reason. Merging lands with the duplicate detection.
 */
export async function TriageCard({ row, canAct }: { row: IncidentRow; canAct: boolean }) {
  const t = await getT();
  return (
    <div
      className="oi-rise"
      style={{
        padding: "15px 18px",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 13,
        boxShadow: "var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
        <Link
          href={`/app/incidents/${row.number}`}
          style={{
            fontSize: 14,
            fontWeight: 600,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          {row.name}
        </Link>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 11px 4px 9px",
            borderRadius: 999,
            background: "var(--viol-t)",
            color: "var(--viol)",
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--viol)" }} />
          {t("incident.phase.triage")}
        </span>
        <span style={{ fontSize: 12, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
          {t.fmt.relative(row.declaredAt)}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 12,
            color: "var(--ink-2)",
            background: "var(--sunk)",
            borderRadius: 999,
            padding: "3px 10px",
          }}
        >
          {t(`timeline.source.${row.source === "api" ? "api" : "alert"}`)}
        </span>
        {row.serviceName && (
          <span
            style={{
              fontSize: 12,
              color: "var(--ink-2)",
              background: "var(--sunk)",
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            {t("incidents.triage.service", { service: row.serviceName })}
          </span>
        )}
      </div>
      {canAct && (
        <div style={{ display: "flex", gap: 8, paddingTop: 2 }}>
          <form action={acceptTriage}>
            <input type="hidden" name="number" value={row.number} />
            <button
              type="submit"
              style={{
                height: 32,
                padding: "0 14px",
                borderRadius: 8,
                background: "var(--brand)",
                color: "#fff",
                border: 0,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("incidents.triage.accept")}
            </button>
          </form>
          <form action={declineTriage} style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="number" value={row.number} />
            <input
              name="reason"
              required
              placeholder={t("incidents.triage.reasonPlaceholder")}
              className="oi-field"
              style={{
                height: 32,
                padding: "0 11px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--panel)",
                fontSize: 12.5,
                width: 260,
                outline: "none",
              }}
            />
            <button
              type="submit"
              className="oi-hover-edge-fill"
              style={{
                height: 32,
                padding: "0 13px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--panel)",
                fontSize: 12.5,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {t("incidents.triage.decline")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
