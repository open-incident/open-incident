"use client";

/**
 * The Logs tab's two controls: the query box (Enter searches) and the live
 * tail, which reads the window again every five seconds while it is on.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";

export function LogsBar({ q, suffix, live }: { q: string; suffix: string; live: boolean }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(q);
  useEffect(() => setValue(q), [q]);

  const go = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "logs");
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // The box is the whole query: a service it no longer names is dropped.
          go({ q: value.trim() || null, service: null });
        }}
        style={{
          flex: 1,
          height: 36,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 12px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          fontFamily: "var(--mono)",
          fontSize: 12.5,
          color: "var(--ink-2)",
        }}
        className="oi-field"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("tel2.logsPlaceholder")}
          aria-label={t("tel2.logsPlaceholder")}
          data-testid="logs-query"
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: "none",
            background: "transparent",
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            color: "var(--ink-2)",
            padding: 0,
          }}
        />
        <span style={{ color: "var(--ink-3)", whiteSpace: "nowrap" }}>{suffix}</span>
      </form>
      <button
        type="button"
        onClick={() => go({ live: live ? "0" : null })}
        aria-pressed={live}
        data-testid="logs-live"
        style={{
          height: 36,
          padding: "0 13px",
          border: `1px solid ${live ? "var(--ok)" : "var(--line)"}`,
          borderRadius: 10,
          background: live ? "var(--ok-t)" : "var(--panel)",
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: 12.5,
          fontWeight: 600,
          color: live ? "var(--ok)" : "var(--ink-3)",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: live ? "var(--ok)" : "var(--ink-3)",
            animation: live ? "oi-pulse 2s infinite" : "none",
          }}
        />
        {live ? t("tel2.liveTail") : t("tel2.paused")}
      </button>
    </div>
  );
}

/** Reads the page again every five seconds, while the tab is visible. */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => clearInterval(iv);
  }, [router]);
  return null;
}
