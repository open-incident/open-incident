"use client";

/**
 * The trace filters as chips — `service:payments-worker`, `status:error`,
 * `duration > 2s` — each removable, and "+ filter" to add one. They are the
 * address (`service`, `status`, `min`), so a filtered list is a link.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";

const CHIP: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11.5,
  borderRadius: 6,
  padding: "3px 8px",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
  border: "1px solid transparent",
};

export function TraceFilters({
  service,
  status,
  min,
  services,
  countLine,
}: {
  service: string | null;
  status: string | null;
  min: number | null;
  services: string[];
  countLine: string;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "traces");
    next.delete("trace");
    next.delete("span");
    if (value === null) next.delete(key);
    else next.set(key, value);
    setOpen(false);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div
      style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
      data-testid="trace-filters"
    >
      {service && (
        <span
          role="button"
          tabIndex={0}
          title={t("tel2.removeFilter")}
          onClick={() => set("service", null)}
          data-testid="trace-chip-service"
          style={{
            ...CHIP,
            background: "var(--brand-t)",
            color: "var(--brand)",
            borderColor: "var(--brand-b)",
          }}
        >
          service:{service} <span aria-hidden>×</span>
        </span>
      )}
      {status === "error" && (
        <span
          role="button"
          tabIndex={0}
          title={t("tel2.removeFilter")}
          onClick={() => set("status", null)}
          data-testid="trace-chip-status"
          style={{ ...CHIP, background: "var(--sunk)" }}
        >
          status:error <span aria-hidden>×</span>
        </span>
      )}
      {min !== null && (
        <span
          role="button"
          tabIndex={0}
          title={t("tel2.removeFilter")}
          onClick={() => set("min", null)}
          data-testid="trace-chip-duration"
          style={{ ...CHIP, background: "var(--sunk)" }}
        >
          duration &gt; {min}s <span aria-hidden>×</span>
        </span>
      )}
      <div ref={ref} style={{ position: "relative" }}>
        <span
          role="button"
          tabIndex={0}
          onClick={() => setOpen((v) => !v)}
          data-testid="trace-add-filter"
          style={{
            fontSize: 12,
            color: "var(--brand)",
            fontWeight: 600,
            cursor: "pointer",
            padding: "3px 4px",
          }}
        >
          {t("tel2.addFilter")}
        </span>
        {open && (
          <div
            role="menu"
            style={{
              position: "absolute",
              left: 0,
              top: 26,
              zIndex: 30,
              minWidth: 220,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              boxShadow: "var(--shadow-pop)",
              padding: 4,
              display: "flex",
              flexDirection: "column",
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {status !== "error" && (
              <MenuItem onClick={() => set("status", "error")}>status:error</MenuItem>
            )}
            {[1, 2, 5].map((s) => (
              <MenuItem key={s} onClick={() => set("min", String(s))}>
                duration &gt; {s}s
              </MenuItem>
            ))}
            {services
              .filter((s) => s !== service)
              .map((s) => (
                <MenuItem key={s} onClick={() => set("service", s)}>
                  service:{s}
                </MenuItem>
              ))}
          </div>
        )}
      </div>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: "var(--ink-3)" }} data-testid="trace-count">
        {countLine}
      </span>
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="oi-hover"
      style={{
        textAlign: "left",
        padding: "7px 10px",
        borderRadius: 7,
        border: 0,
        background: "transparent",
        fontFamily: "var(--mono)",
        fontSize: 12,
        cursor: "pointer",
        color: "var(--ink)",
      }}
    >
      {children}
    </button>
  );
}
