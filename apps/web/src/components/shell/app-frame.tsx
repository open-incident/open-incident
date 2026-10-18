"use client";

/**
 * The frame every responder screen renders inside: the rail on the left, a
 * 50 px header that holds only the search and the bell, the scroll area, and
 * the command palette over everything.
 *
 * It owns the three pieces of state that belong to the frame rather than to a
 * screen — whether the palette is open, whether a test page is in flight, and
 * the toast that says so. Screens own their own state and know nothing of it.
 *
 * It is rendered by the /app layout, which Next keeps mounted from one screen
 * to the next: a click in the rail swaps the content of `<main>` and nothing
 * else. Nothing here may key itself on the path — that is what used to replay
 * the whole frame on every click.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import {
  Sidebar,
  type OnCallNow,
  type RailMember,
  type RailWorkspace,
  type SidebarSection,
} from "./sidebar";
import { NavIcon } from "./nav-icons";
import { CommandPalette } from "./command-palette";
import { NotificationBell, type BellRow } from "./notification-bell";

export type AppFrameProps = {
  workspace: RailWorkspace;
  member: RailMember;
  sections: SidebarSection[];
  onCall: OnCallNow;
  canDeclare: boolean;
  canPageSelf: boolean;
  /** Really pages the reader, through the real path. Returns what to say. */
  pageMeAction: () => Promise<{ ok: boolean; message: string }>;
  bell: { rows: BellRow[]; unread: number };
  markBellReadAction: (id?: string) => Promise<void>;
  children: React.ReactNode;
};

/** Whether a key press belongs to a field the reader is typing in. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function AppFrame({
  workspace,
  member,
  sections,
  onCall,
  canDeclare,
  canPageSelf,
  pageMeAction,
  bell,
  markBellReadAction,
  children,
}: AppFrameProps) {
  const t = useT();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [paging, startPaging] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const declare = useCallback(() => {
    setPaletteOpen(false);
    router.push("/app/incidents?declare=1");
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        return;
      }
      // "D" declares, as the palette says — never while somebody is typing,
      // and never with a modifier (⌘D is the browser's bookmark).
      if (
        canDeclare &&
        !paletteOpen &&
        (e.key === "d" || e.key === "D") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !typing(e.target) &&
        !document.querySelector("[role=dialog]")
      ) {
        e.preventDefault();
        declare();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDeclare, paletteOpen, declare]);

  const pageMe = useCallback(() => {
    setPaletteOpen(false);
    setTestMode(true);
    startPaging(async () => {
      const res = await pageMeAction();
      setToast(res.message);
      // The badge stays up while the page is plausibly still ringing, then
      // clears: it marks the run, it is not a permanent mode.
      setTimeout(() => setTestMode(false), 6000);
      if (!res.ok) setTestMode(false);
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
        workspace={workspace}
        member={member}
        sections={sections}
        onCall={onCall}
        canDeclare={canDeclare}
        onDeclare={declare}
        canPageSelf={canPageSelf}
        paging={paging}
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
            data-testid="search-open"
            onClick={() => setPaletteOpen(true)}
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
              data-testid="test-mode"
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
          <NotificationBell
            rows={bell.rows}
            unread={bell.unread}
            markReadAction={markBellReadAction}
          />
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
        // Centred by the outer box, risen by the inner one: an animation that
        // moves `transform` would otherwise overwrite the centring.
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 22,
            transform: "translateX(-50%)",
            width: "max-content",
            maxWidth: "min(720px, calc(100vw - 40px))",
            zIndex: 70,
          }}
        >
          <div
            className="oi-rise"
            role="status"
            data-testid="toast"
            style={{
              background: "var(--ink)",
              color: "var(--panel)",
              borderRadius: 12,
              padding: "10px 16px",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "var(--shadow-pop)",
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
        </div>
      )}
    </div>
  );
}
