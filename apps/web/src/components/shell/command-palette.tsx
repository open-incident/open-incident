"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";

type Entry = {
  key: string;
  label: string;
  hint?: string;
  dot?: string;
  href: string;
  group: "actions" | "goto";
};

/**
 * ⌘K — the design's palette: 560 px, radius 16, a search row, an "Actions"
 * group with coloured dots and a two-column "Go to" grid, the key legend in the
 * footer. Opens on ⌘K / Ctrl+K, closes on Escape or a click outside.
 *
 * Only real destinations are listed: the sections that have no screen yet are
 * not offered here either.
 */
export function CommandPalette({
  open,
  onOpenChange,
  canRespond,
  isManager,
  currentPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRespond: boolean;
  isManager: boolean;
  currentPath: string;
}) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === "Escape" && open) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const incidentMatch = currentPath.match(/^\/app\/incidents\/(\d+)/);
  const entries = useMemo<Entry[]>(() => {
    const actions: Entry[] = [];
    if (canRespond)
      actions.push({
        key: "declare",
        label: t("palette.declare"),
        hint: "D",
        dot: "var(--dang)",
        href: "/app/incidents/new",
        group: "actions",
      });
    if (canRespond && incidentMatch) {
      actions.push({
        key: "update",
        label: t("palette.update", { number: `INC-${incidentMatch[1]}` }),
        dot: "var(--brand)",
        href: `${currentPath}?update=1`,
        group: "actions",
      });
    }
    const goto: Entry[] = [
      { key: "incidents", label: t("nav.incidents"), href: "/app/incidents", group: "goto" },
      {
        key: "triage",
        label: t("incidents.views.triage"),
        href: "/app/incidents?view=triage",
        group: "goto",
      },
      {
        key: "followups",
        label: t("incidents.views.followUps"),
        href: "/app/incidents?view=follow-ups",
        group: "goto",
      },
      { key: "catalog", label: t("nav.catalog"), href: "/app/catalog", group: "goto" },
      { key: "account", label: t("nav.account"), href: "/app/account", group: "goto" },
    ];
    if (isManager)
      goto.push({
        key: "settings",
        label: t("nav.settings"),
        href: "/app/settings/general",
        group: "goto",
      });
    const q = query.trim().toLowerCase();
    const all = [...actions, ...goto];
    return q ? all.filter((e) => e.label.toLowerCase().includes(q)) : all;
  }, [canRespond, isManager, incidentMatch, currentPath, query, t]);

  useEffect(() => setCursor(0), [query]);

  if (!open) return null;

  const go = (entry: Entry) => {
    onOpenChange(false);
    router.push(entry.href);
  };
  const actions = entries.filter((e) => e.group === "actions");
  const goto = entries.filter((e) => e.group === "goto");
  const row = (entry: Entry, index: number, grid: boolean) => (
    <button
      key={entry.key}
      type="button"
      role="option"
      aria-selected={cursor === index}
      onMouseEnter={() => setCursor(index)}
      onClick={() => go(entry)}
      className="oi-hover"
      style={{
        display: "flex",
        alignItems: "center",
        gap: grid ? 9 : 10,
        padding: grid ? "8px 12px" : "9px 12px",
        borderRadius: 8,
        fontSize: grid ? 13 : 13.5,
        fontWeight: 500,
        color: "var(--ink)",
        background: cursor === index ? "var(--sunk)" : "transparent",
        border: 0,
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {entry.dot && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: entry.dot }} />
      )}
      <span style={{ flex: 1 }}>{entry.label}</span>
      {entry.hint && (
        <span className="oi-kbd" style={{ background: "var(--sunk)", border: 0 }}>
          {entry.hint}
        </span>
      )}
    </button>
  );

  return (
    <div
      onClick={() => onOpenChange(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,12,14,.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "13vh",
        zIndex: 70,
      }}
    >
      <div
        role="dialog"
        aria-label={t("palette.open")}
        onClick={(e) => e.stopPropagation()}
        className="oi-rise-fast"
        style={{
          width: 560,
          maxWidth: "94vw",
          background: "var(--panel)",
          borderRadius: 16,
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(entries.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter") {
                const entry = entries[cursor];
                if (entry) go(entry);
              }
            }}
            placeholder={t("palette.inputPlaceholder")}
            aria-label={t("palette.inputPlaceholder")}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 14,
              background: "transparent",
            }}
          />
          <span className="oi-kbd" style={{ background: "var(--sunk)", border: 0 }}>
            esc
          </span>
        </div>
        <div role="listbox" style={{ padding: 8, display: "flex", flexDirection: "column" }}>
          {actions.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  padding: "8px 12px 4px",
                }}
              >
                {t("palette.actions")}
              </div>
              {actions.map((e) => row(e, entries.indexOf(e), false))}
            </>
          )}
          {goto.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  padding: "10px 12px 4px",
                }}
              >
                {t("palette.goTo")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                {goto.map((e) => row(e, entries.indexOf(e), true))}
              </div>
            </>
          )}
          {entries.length === 0 && (
            <div style={{ padding: "14px 12px", fontSize: 13, color: "var(--ink-3)" }}>
              {t("palette.empty")}
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              borderTop: "1px solid var(--line-2)",
              marginTop: 8,
              padding: "9px 12px",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            <span>{t("palette.keyNavigate")}</span>
            <span>{t("palette.keyOpen")}</span>
            <span>{t("palette.keyClose")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
