"use client";

/**
 * ⌘K — go anywhere, do the two things worth a shortcut, or ask.
 *
 * Every row is reachable from the keyboard, as the footer promises: ↑↓ move
 * the highlight, ↵ runs it, esc closes. Typing narrows "Go to" to the sections
 * whose name matches; a query that matches none keeps the whole list.
 *
 * The Atlas card appears once the query is long enough to be a question. Atlas
 * does not answer free questions yet, and the card says so rather than
 * promising an answer: ↵ on it runs the search the box does today — the
 * incidents whose title or reference matches.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { NavIcon } from "./nav-icons";
import type { SidebarSection } from "./sidebar";

type Row = { key: string; run: () => void };

export function CommandPalette({
  sections,
  canDeclare,
  canPageSelf,
  onClose,
  onDeclare,
  onPageMe,
}: {
  sections: SidebarSection[];
  canDeclare: boolean;
  canPageSelf: boolean;
  onClose: () => void;
  onDeclare: () => void;
  onPageMe: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const needle = q.trim();
  const asking = needle.length > 2;
  const matches = useMemo(() => {
    const n = needle.toLowerCase();
    if (!n) return sections;
    return sections.filter((s) => t(s.labelKey).toLowerCase().includes(n));
  }, [needle, sections, t]);
  const shown = matches.length > 0 ? matches : sections;

  const actions: Row[] = [
    ...(canDeclare ? [{ key: "declare", run: onDeclare }] : []),
    ...(canPageSelf ? [{ key: "pageMe", run: onPageMe }] : []),
  ];
  const goTo: Row[] = shown.map((s) => ({
    key: s.href,
    run: () => {
      onClose();
      router.push(s.href);
    },
  }));
  const rows = [...actions, ...goTo];
  const search = () => {
    onClose();
    router.push(`/app/incidents?q=${encodeURIComponent(needle)}`);
  };

  // Nothing is highlighted until the keyboard or the mouse asks for it: the
  // palette opens as the design draws it. -1 is the Atlas card.
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => setActive(null), [needle]);

  const move = (delta: number) => {
    const min = asking ? -1 : 0;
    const max = rows.length - 1;
    setActive((a) => {
      if (a === null) return delta > 0 ? (asking && matches.length === 0 ? -1 : 0) : max;
      return Math.min(max, Math.max(min, a + delta));
    });
  };

  const enter = () => {
    if (active === -1) return search();
    if (active !== null) return rows[active]?.run();
    // ↵ with nothing highlighted: the section the query names, else the search.
    if (needle && matches.length > 0) return goTo[0]?.run();
    if (asking) search();
  };

  const hl = (i: number): React.CSSProperties =>
    i === active ? { background: "var(--sunk)" } : {};

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim-palette)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="oi-rise-fast"
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.open")}
        data-testid="palette"
        style={{
          width: 580,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--panel)",
          borderRadius: "var(--radius-modal)",
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
          <span
            style={{
              width: 16,
              height: 16,
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
            }}
          >
            <NavIcon id="search" size={16} />
          </span>
          <input
            ref={inputRef}
            value={q}
            data-testid="palette-input"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                enter();
              }
            }}
            placeholder={t("palette.askPlaceholder")}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 14.5,
              background: "transparent",
            }}
          />
        </div>
        <div style={{ padding: 8, display: "flex", flexDirection: "column" }}>
          {asking && (
            <div
              role="button"
              tabIndex={-1}
              data-testid="palette-atlas"
              onClick={search}
              onMouseEnter={() => setActive(-1)}
              style={{
                margin: "4px 4px 8px",
                border: "1px solid var(--viol)",
                background: "var(--viol-t)",
                borderRadius: 12,
                padding: "11px 13px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                cursor: "pointer",
                boxShadow: active === -1 ? "0 0 0 3px var(--viol-t)" : undefined,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--viol)",
                }}
              >
                ✦ {t("atlas.name")}
                <span
                  style={{
                    fontWeight: 600,
                    background: "var(--panel)",
                    borderRadius: 5,
                    padding: "1px 6px",
                  }}
                >
                  {t("sh.k.atlasNotYet")}
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                {t("sh.k.atlasSearch", { q: needle })}
              </div>
            </div>
          )}

          {actions.length > 0 && (
            <>
              <div style={GROUP}>{t("palette.actions")}</div>
              {canDeclare && (
                <button
                  type="button"
                  onClick={onDeclare}
                  onMouseEnter={() => setActive(0)}
                  className="oi-hover"
                  style={{ ...ACTION, ...hl(0) }}
                >
                  <span style={{ ...DOT, background: "var(--dang)" }} />
                  {t("palette.declare")}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
                    D
                  </span>
                </button>
              )}
              {canPageSelf && (
                <button
                  type="button"
                  onClick={onPageMe}
                  onMouseEnter={() => setActive(canDeclare ? 1 : 0)}
                  className="oi-hover"
                  style={{ ...ACTION, ...hl(canDeclare ? 1 : 0) }}
                >
                  <span style={{ ...DOT, background: "var(--brand)" }} />
                  {t("palette.pageMeTest")}
                </button>
              )}
            </>
          )}

          <div style={{ ...GROUP, padding: "10px 12px 4px" }}>{t("palette.goTo")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            {shown.map((s, i) => {
              const at = actions.length + i;
              return (
                <button
                  key={s.href}
                  type="button"
                  onClick={goTo[i]!.run}
                  onMouseEnter={() => setActive(at)}
                  className="oi-hover"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "8px 12px",
                    borderRadius: 9,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    background: "transparent",
                    border: 0,
                    color: "inherit",
                    textAlign: "left",
                    ...hl(at),
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      display: "grid",
                      placeItems: "center",
                      color: "var(--ink-3)",
                    }}
                  >
                    <NavIcon id={s.id} size={14} />
                  </span>
                  {t(s.labelKey)}
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              borderTop: "1px solid var(--line)",
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

const GROUP: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  padding: "8px 12px 4px",
};

const ACTION: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 12px",
  borderRadius: 9,
  fontSize: 13.5,
  fontWeight: 500,
  cursor: "pointer",
  background: "transparent",
  border: 0,
  color: "inherit",
  textAlign: "left",
  width: "100%",
};

const DOT: React.CSSProperties = { width: 7, height: 7, borderRadius: "50%", flex: "none" };
