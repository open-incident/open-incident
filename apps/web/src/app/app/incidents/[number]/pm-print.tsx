"use client";

import { useT } from "@/i18n/client";

export function PrintButton({ style }: { style?: React.CSSProperties }) {
  const t = useT();
  return (
    <button type="button" style={style} className="oi-hover" onClick={() => window.print()}>
      {t("postMortem.export.print")}
    </button>
  );
}
