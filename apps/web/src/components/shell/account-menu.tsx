"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { authClient } from "@/lib/auth-client";

export type RailMember = {
  name: string;
  /** "Owner", "Responder"… — already in the reader's language. */
  roleLabel: string;
  /** The first team they belong to, when they belong to one. */
  teamName: string | null;
  initials: string;
};

/**
 * The reader, at the very foot of the rail: initials, name, role and team —
 * and, on a click, their account and the way out.
 *
 * Signing out ends the session server-side (the cookie alone is not the
 * session), then lands on the sign-in page. A member signed in through single
 * sign-on has no password to fall back on, so this is their only way out.
 * The menu opens upwards: below the foot of the rail there is nothing.
 */
export function AccountMenu({ member }: { member: RailMember }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  const signOut = async () => {
    setLeaving(true);
    try {
      await authClient.signOut();
    } finally {
      // Whatever the API answered, the sign-in page is where to find out:
      // a session that still holds lands back in the app from there.
      router.push("/login");
      router.refresh();
    }
  };

  const item: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    fontSize: 13,
    color: "var(--ink)",
    background: "transparent",
    border: 0,
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
  };

  const sub = member.teamName ? `${member.roleLabel} · ${member.teamName}` : member.roleLabel;

  return (
    <div ref={root} style={{ position: "relative", flex: "none" }}>
      <button
        type="button"
        data-testid="account-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          width: "100%",
          padding: "10px 8px 2px",
          background: "transparent",
          border: 0,
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--brand-t)",
            color: "var(--brand)",
            display: "grid",
            placeItems: "center",
            fontSize: 10.5,
            fontWeight: 700,
            flex: "none",
            boxShadow: open ? "0 0 0 1px var(--brand)" : undefined,
          }}
        >
          {member.initials}
        </span>
        <span style={{ lineHeight: 1.2, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 12.5,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {member.name}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 11,
              color: "var(--ink-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sub}
          </span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          data-testid="account-menu"
          className="oi-rise-fast"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "calc(100% + 6px)",
            padding: 6,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            boxShadow: "var(--shadow-pop)",
            zIndex: 40,
          }}
        >
          <Link
            href="/app/account"
            role="menuitem"
            className="oi-hover"
            data-testid="account-menu-account"
            onClick={() => setOpen(false)}
            style={item}
          >
            {t("nav.account")}
          </Link>
          <button
            type="button"
            role="menuitem"
            className="oi-hover"
            data-testid="sign-out"
            disabled={leaving}
            onClick={signOut}
            style={{ ...item, color: "var(--dang)", opacity: leaving ? 0.6 : 1 }}
          >
            {t("nav.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
