"use client";

import { useEffect } from "react";
import { useT } from "@/i18n/client";

/** "Export PDF": the page opens and hands itself to the print dialog, which saves the PDF. */
export function AutoPrint() {
  useEffect(() => {
    const id = setTimeout(() => window.print(), 400);
    return () => clearTimeout(id);
  }, []);
  return null;
}

export function PrintButton({ style }: { style?: React.CSSProperties }) {
  const t = useT();
  return (
    <button type="button" style={style} className="oi-hover" onClick={() => window.print()}>
      {t("postMortem.export.print")}
    </button>
  );
}
