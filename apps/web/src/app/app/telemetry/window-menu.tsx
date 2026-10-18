"use client";

/**
 * "Last 1 hour ▾" — the window every tab but Metrics reads (Metrics has its
 * own range bar). A choice rewrites `range` in the address and drops a zoom;
 * everything else in the address stays.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";

const KEYS = ["15m", "1h", "6h", "24h", "7d"] as const;

export function WindowMenu({
  range,
  zoomed,
  labels,
}: {
  range: string;
  zoomed: { from: number; to: number } | null;
  labels: Record<(typeof KEYS)[number], string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const choose = (k: string) => {
    const next = new URLSearchParams(params.toString());
    if (k === "1h") next.delete("range");
    else next.set("range", k);
    next.delete("from");
    next.delete("to");
    setOpen(false);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const t = useT();
  const fmt = (at: number) => t.fmt.time(new Date(at), t.timeZone);
  const label = zoomed
    ? `${fmt(zoomed.from)} – ${fmt(zoomed.to)}`
    : (labels[range as (typeof KEYS)[number]] ?? labels["1h"]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="oi-hover"
        data-testid="telemetry-window"
        aria-expanded={open}
        style={{
          height: 32,
          padding: "0 12px",
          border: "1px solid var(--line)",
          borderRadius: 9,
          background: "var(--panel)",
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          color: "inherit",
        }}
      >
        {label} <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: 36,
            zIndex: 30,
            minWidth: 170,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            boxShadow: "var(--shadow-pop)",
            padding: 4,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              data-testid={`telemetry-range-${k}`}
              onClick={() => choose(k)}
              className="oi-hover"
              style={{
                textAlign: "left",
                padding: "7px 10px",
                borderRadius: 7,
                border: 0,
                background: !zoomed && k === range ? "var(--brand-t)" : "transparent",
                color: !zoomed && k === range ? "var(--brand)" : "var(--ink)",
                fontSize: 12.5,
                fontWeight: !zoomed && k === range ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {labels[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
