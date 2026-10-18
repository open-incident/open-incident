"use client";

/**
 * The workspace chip under the product name: its initial on its accent, its
 * name, and — for those who may change it — a caret that opens what there is
 * to do about the workspace itself.
 *
 * A workspace lives at its own address, so there is no list of other
 * workspaces to switch to from here: the menu says where this one lives and
 * leads to its settings. A member who cannot open the settings gets the chip
 * without a caret, rather than a menu with nothing in it.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";

export type RailWorkspace = {
  name: string;
  accent: string;
  /** The address the workspace answers on, as the browser shows it. */
  host: string;
  /** Where its settings are, when the reader may open them. */
  settingsHref: string | null;
};

export function WorkspaceMenu({ workspace }: { workspace: RailWorkspace }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const hasMenu = Boolean(workspace.settingsHref);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const chip = (
    <>
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          background: workspace.accent,
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontSize: 10.5,
          fontWeight: 700,
          flex: "none",
        }}
      >
        {workspace.name.slice(0, 1).toUpperCase()}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "left",
        }}
      >
        {workspace.name}
      </span>
      {hasMenu && <span style={{ fontSize: 9, opacity: 0.5, flex: "none" }}>▾</span>}
    </>
  );

  const box: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 9px",
    border: "1px solid var(--line)",
    borderRadius: 10,
    width: "100%",
    background: "transparent",
    color: "inherit",
    font: "inherit",
  };

  return (
    <div ref={root} style={{ position: "relative", marginBottom: 8, flex: "none" }}>
      {hasMenu ? (
        <button
          type="button"
          data-testid="workspace-chip"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="oi-hover"
          style={{ ...box, cursor: "pointer" }}
        >
          {chip}
        </button>
      ) : (
        <div data-testid="workspace-chip" style={box}>
          {chip}
        </div>
      )}
      {open && workspace.settingsHref && (
        <div
          role="menu"
          data-testid="workspace-menu"
          className="oi-rise-fast"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "calc(100% + 6px)",
            padding: 6,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            boxShadow: "var(--shadow-pop)",
            zIndex: 40,
          }}
        >
          <div style={{ padding: "6px 10px 9px", borderBottom: "1px solid var(--line-2)" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{workspace.name}</div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--ink-3)",
                fontFamily: "var(--mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {workspace.host}
            </div>
          </div>
          <Link
            href={workspace.settingsHref}
            role="menuitem"
            className="oi-hover"
            onClick={() => setOpen(false)}
            style={{
              display: "block",
              marginTop: 6,
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 13,
              color: "var(--ink)",
              textDecoration: "none",
            }}
          >
            {t("sh.workspaceSettings")}
          </Link>
        </div>
      )}
    </div>
  );
}
