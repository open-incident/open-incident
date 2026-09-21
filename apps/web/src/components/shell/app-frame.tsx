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
import Link from "next/link";
import { Sidebar, type OnCallNow, type SidebarSection } from "./sidebar";
import { NavIcon } from "./nav-icons";
import { CommandPalette } from "./command-palette";
import { NotificationBell, type BellRow } from "./notification-bell";

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
  bell: { rows: BellRow[]; unread: number };
  markBellReadAction: (id?: string) => Promise<void>;
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
  bell,
  markBellReadAction,
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
        sections={sections}
        canDeclare={canDeclare}
        onDeclare={declare}
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
          {/*
            Who carries the pager, in the header rather than at the foot of the
            rail. It is live state, not navigation, and it belongs beside the
            bell — the corner a reader already watches. Compact on purpose: the
            schedule and the hour are on the chip's title, because a header is
            50 px tall and the name is what somebody needs at a glance.
          */}
          <Link
            href="/app/on-call"
            data-testid="oncall-chip"
            className="oi-hover-edge"
            title={
              onCall
                ? t("nav.onCallUntil", { schedule: onCall.scheduleName, until: onCall.until })
                : t("nav.onCallNobodyHint")
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 30,
              padding: "0 10px",
              borderRadius: 9,
              border: "1px solid var(--line)",
              background: "var(--sunk)",
              textDecoration: "none",
              color: "inherit",
              fontSize: 12.5,
              maxWidth: 260,
            }}
          >
            <span
              className={onCall ? "oi-pulse" : undefined}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: onCall ? "var(--dang)" : "var(--ink-3)",
                flex: "none",
              }}
            />
            <span
              style={{
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {onCall ? onCall.name : t("nav.onCallNobody")}
            </span>
            {onCall && (
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {onCall.until}
              </span>
            )}
          </Link>
          {canPageSelf && (
            <button
              type="button"
              onClick={pageMe}
              className="oi-hover-edge"
              style={{
                height: 30,
                padding: "0 10px",
                border: "1px solid var(--line)",
                borderRadius: 9,
                background: "var(--panel)",
                color: "inherit",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t("nav.pageMe")}
            </button>
          )}
          <NotificationBell
            rows={bell.rows}
            unread={bell.unread}
            markReadAction={markBellReadAction}
          />
          {/* And the reader, where every application puts them. */}
          <Link
            href="/app/account"
            data-testid="account-chip"
            title={`${member.name} · ${member.roleLabel}`}
            style={{
              display: "grid",
              placeItems: "center",
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "var(--brand-t)",
              color: "var(--brand)",
              fontSize: 11,
              fontWeight: 700,
              textDecoration: "none",
              flex: "none",
            }}
          >
            {member.initials}
          </Link>
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
