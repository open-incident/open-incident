import Link from "next/link";
import { getT } from "@/i18n/server";
import type { AtlasNote } from "@/lib/telemetry-board";

/**
 * What Atlas established from telemetry about an open incident, and where it
 * read it. Drawn only when an investigation made such a finding — never
 * composed here.
 */
export async function AtlasBanner({ note, tinted = false }: { note: AtlasNote; tinted?: boolean }) {
  const t = await getT();
  return (
    <div
      data-testid="telemetry-atlas"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: tinted ? "var(--brand-t)" : "var(--panel)",
        border: `1px solid ${tinted ? "var(--brand-b)" : "var(--line)"}`,
        borderRadius: 12,
        padding: "10px 14px",
        fontSize: 12.5,
        color: "var(--ink-2)",
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: "var(--viol)" }}>✦</span>
      <span style={{ flex: 1, minWidth: 240 }}>
        {note.statement}{" "}
        <Link
          href={`/app/incidents/${note.incident}?tab=atlas`}
          style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}
        >
          INC-{note.incident}
        </Link>
      </span>
      <span
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          border: `1px solid ${tinted ? "var(--brand-b)" : "var(--line)"}`,
          borderRadius: 6,
          padding: "2px 7px",
          whiteSpace: "nowrap",
        }}
      >
        {t("tel2.atlasFrom", { source: note.source })}
      </span>
    </div>
  );
}
