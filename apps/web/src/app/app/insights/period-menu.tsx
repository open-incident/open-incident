"use client";

/**
 * "Last 90 days ▾" — the period, and the CSV of the tab being read.
 *
 * The export sits in the same menu as the period because it exports exactly
 * that: the rows behind the figures on screen, for the window chosen.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/i18n/client";

const ITEM: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  fontWeight: 500,
  color: "var(--ink)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

export function PeriodMenu({
  tab,
  days,
  exportable,
}: {
  tab: string;
  days: number;
  exportable: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        data-testid="insights-period"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="oi-hover-edge"
        style={{
          height: 32,
          padding: "0 12px",
          border: "1px solid var(--line)",
          borderRadius: 9,
          background: "var(--panel)",
          display: "flex",
          alignItems: "center",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          color: "var(--ink)",
        }}
      >
        {`${t("insights.periodLast", { count: days })} ▾`}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 210,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            boxShadow: "var(--shadow-pop)",
            padding: 5,
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            gap: 1,
            animation: "oi-rise .16s ease backwards",
          }}
        >
          {[30, 90, 365].map((d) => (
            <Link
              key={d}
              role="menuitemradio"
              aria-checked={days === d}
              data-testid={`insights-period-${d}`}
              href={`/app/insights?tab=${tab}&days=${d}`}
              onClick={() => setOpen(false)}
              className="oi-hover"
              style={{ ...ITEM, fontWeight: days === d ? 600 : 500 }}
            >
              <span style={{ flex: 1 }}>{t("insights.periodLast", { count: d })}</span>
              {days === d && <span style={{ color: "var(--brand)", fontSize: 12 }}>✓</span>}
            </Link>
          ))}
          {exportable && (
            <>
              <div style={{ height: 1, background: "var(--line-2)", margin: "4px 2px" }} />
              <a
                role="menuitem"
                data-testid="insights-export"
                href={`/api/insights/export?tab=${tab}&days=${days}`}
                onClick={() => setOpen(false)}
                className="oi-hover"
                style={ITEM}
              >
                ↓ {t("insights.exportTab")}
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
