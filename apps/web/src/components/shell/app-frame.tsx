"use client";

/**
 * The frame every responder screen renders inside: the rail on the left, a
 * 50 px header above the scroll area, the command palette over everything.
 *
 * It owns the three pieces of state that belong to the frame rather than to a
 * screen — whether the palette is open, whether a test page is in flight, and
 * the toast that says so. Screens own their own state and know nothing of it.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { Sidebar, type OnCallNow, type SidebarSection } from "./sidebar";
import { NavIcon } from "./nav-icons";
import { CommandPalette } from "./command-palette";

export type AppFrameProps = {
  workspaceName: string;
  workspaceAccent: string;
  member: { name: string; roleLabel: string; initials: string };
  sections: SidebarSection[];
  onCall: OnCallNow;
  canDeclare: boolean;
  canPageSelf: boolean;
  /** Really pages the reader, through the real path. Returns what to say. */
  pageMeAction: () => Promise<{ ok: boolean; message: string }>;
  children: React.ReactNode;
};

export function AppFrame({
  workspaceName,
  workspaceAccent,
  member,
  sections,
  onCall,
  canDeclare,
  canPageSelf,
  pageMeAction,
  children,
}: AppFrameProps) {
  const t = useT();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const declare = useCallback(() => {
    setPaletteOpen(false);
    router.push("/app/incidents?declare=1");
  }, [router]);

  const pageMe = useCallback(() => {
    setPaletteOpen(false);
    setTestMode(true);
    startTransition(async () => {
      const res = await pageMeAction();
      setToast(res.message);
      // The badge stays up while the page is plausibly still ringing, then
      // clears: it marks the run, it is not a permanent mode.
      setTimeout(() => setTestMode(false), 6000);
      router.refresh();
    });
  }, [pageMeAction, router]);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        background: "var(--canvas)",
        color: "var(--ink)",
        overflow: "hidden",
      }}
    >
      <Sidebar
        workspaceName={workspaceName}
        workspaceAccent={workspaceAccent}
        member={member}
        sections={sections}
        onCall={onCall}
        canDeclare={canDeclare}
        canPageSelf={canPageSelf}
        onDeclare={declare}
        onPageMe={pageMe}
      />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            height: 50,
            flex: "none",
            background: "var(--panel)",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 20px",
          }}
        >
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="oi-hover-edge"
            style={{
              flex: 1,
              minWidth: 0,
              maxWidth: 520,
              height: 34,
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "0 8px 0 12px",
              background: "var(--sunk)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              cursor: "pointer",
              color: "var(--ink-3)",
              fontSize: 13,
            }}
          >
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>
              <NavIcon id="search" size={14} />
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("palette.searchOrAsk")}
            </span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 5,
                background: "var(--panel)",
                border: "1px solid var(--line)",
                fontFamily: "var(--mono)",
                fontSize: 10.5,
              }}
            >
              ⌘K
            </span>
          </button>
          <span style={{ flex: 1 }} />
          {testMode && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                fontWeight: 700,
                color: "var(--viol)",
                background: "var(--viol-t)",
                borderRadius: 999,
                padding: "4px 11px",
              }}
            >
              <span
                style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--viol)" }}
              />
              {t("shell.testMode")}
            </span>
          )}
        </header>
        <main style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, overflow: "auto" }}>{children}</div>
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          sections={sections}
          canDeclare={canDeclare}
          canPageSelf={canPageSelf}
          onClose={() => setPaletteOpen(false)}
          onDeclare={declare}
          onPageMe={pageMe}
        />
      )}

      {toast && (
        <div
          className="oi-rise"
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 22,
            transform: "translateX(-50%)",
            background: "var(--ink)",
            color: "var(--panel)",
            borderRadius: 12,
            padding: "10px 16px",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: "min(720px, calc(100vw - 40px))",
            boxShadow: "var(--shadow-pop)",
            zIndex: 70,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--viol)",
              flex: "none",
            }}
          />
          {toast}
        </div>
      )}
    </div>
  );
}
