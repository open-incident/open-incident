"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";

/** Copies the document as markdown — the clipboard is the fastest export there is. */
export function PmCopy({ markdown, style }: { markdown: string; style?: React.CSSProperties }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      style={style}
      className="oi-hover"
      onClick={() => {
        void navigator.clipboard.writeText(markdown).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? t("common.copied") : t("postMortem.export.copy")}
    </button>
  );
}
