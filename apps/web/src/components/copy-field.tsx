"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";

/** A read-only value with a Copy button — URLs and tokens people paste elsewhere. */
export function CopyField({ value, testId }: { value: string; testId?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div data-testid={testId} style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="oi-field"
        style={{
          flex: 1,
          minWidth: 0,
          height: 30,
          padding: "0 10px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--sunk)",
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: "var(--ink-2)",
          outline: "none",
        }}
      />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
        className="oi-hover"
        style={{
          height: 30,
          padding: "0 11px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          flex: "none",
        }}
      >
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
  );
}
