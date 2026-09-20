import Link from "next/link";
import { getT } from "@/i18n/server";
import { exceptionDetail, exceptionGroups } from "@/lib/telemetry";
import { ExceptionActions } from "./exception-actions";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };

/**
 * Exceptions, grouped.
 *
 * The list is by fingerprint, not by occurrence: the same bug firing ten
 * thousand times is one line with a count, which is the only way the screen
 * stays readable on the day it matters. The detail shows the most recent
 * occurrence, with the frames that are ours picked out — a stack where every
 * line looks equally important is a stack nobody reads.
 */
export async function ExceptionsTab({
  tenantId,
  open,
  mayEdit,
  service,
}: {
  tenantId: string;
  open?: string;
  mayEdit: boolean;
  service?: string;
}) {
  const t = await getT();
  const groups = await exceptionGroups(tenantId, { service });
  if (groups.length === 0) {
    return (
      <div
        style={{
          ...CARD,
          padding: "28px 20px",
          textAlign: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        {t("telemetry.noExceptions")}
      </div>
    );
  }
  const detail = open ? await exceptionDetail(tenantId, open) : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: open ? "minmax(0,1fr) minmax(0,1.2fr)" : "1fr",
        gap: 14,
      }}
    >
      <div style={{ ...CARD, overflow: "hidden", alignSelf: "start" }}>
        {groups.map((g, i) => (
          <Link
            key={g.fingerprint}
            href={`/app/telemetry?tab=exceptions&fp=${g.fingerprint}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 54px 74px",
              gap: 10,
              alignItems: "center",
              padding: "9px 14px",
              borderTop: i ? "1px solid var(--line-2)" : "none",
              background: g.fingerprint === open ? "var(--sunk)" : "transparent",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span
                style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--dang)" }}
              >
                {g.type}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "var(--ink-2)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {g.message}
              </span>
              <span style={{ ...MONO, fontSize: 10.5, color: "var(--ink-3)" }}>
                {g.services.join(", ")}
                {g.releases.filter(Boolean).length > 0
                  ? ` · ${g.releases.filter(Boolean).join(", ")}`
                  : ""}
              </span>
            </span>
            <span style={{ ...MONO, fontSize: 12, textAlign: "right", color: "var(--ink)" }}>
              {g.occurrences}×
            </span>
            <span style={{ ...MONO, fontSize: 10.5, textAlign: "right", color: "var(--ink-3)" }}>
              {g.last_seen.slice(11, 16)}
            </span>
          </Link>
        ))}
      </div>

      {open && detail && (
        <div style={{ ...CARD, padding: "14px 16px" }}>
          <div style={{ ...MONO, fontSize: 11, color: "var(--ink-3)" }}>
            {detail.service_name}
            {detail.release ? ` · ${detail.release}` : ""} · {detail.ts.slice(0, 19)}
          </div>

          <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600 }}>
            {t("telemetry.frames")}
          </div>
          <div style={{ marginTop: 6 }}>
            {detail.frames.map((f, i) => (
              <div
                key={i}
                style={{
                  ...MONO,
                  fontSize: 11.5,
                  padding: "2px 0",
                  color: f.in_app ? "var(--ink)" : "var(--ink-3)",
                  fontWeight: f.in_app ? 600 : 400,
                }}
              >
                {f.function}{" "}
                <span style={{ fontWeight: 400 }}>
                  {f.file}:{f.line}
                </span>
              </div>
            ))}
            {detail.frames.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("telemetry.noFrames")}</div>
            )}
          </div>

          {detail.trace_id && (
            <Link
              href={`/app/telemetry?tab=traces&trace=${detail.trace_id}`}
              style={{
                ...MONO,
                display: "inline-block",
                marginTop: 10,
                color: "var(--brand)",
                textDecoration: "none",
              }}
            >
              {t("telemetry.openTrace")}
            </Link>
          )}

          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12.5, cursor: "pointer" }}>
              {t("telemetry.fullStack")}
            </summary>
            <pre
              style={{
                ...MONO,
                fontSize: 11,
                background: "var(--sunk)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "10px 12px",
                overflowX: "auto",
                marginTop: 8,
              }}
            >
              {detail.stacktrace}
            </pre>
          </details>

          <ExceptionActions tenantId={tenantId} fingerprint={open} mayEdit={mayEdit} />
        </div>
      )}
    </div>
  );
}
