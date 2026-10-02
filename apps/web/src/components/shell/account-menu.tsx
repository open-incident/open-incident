"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { authClient } from "@/lib/auth-client";

/**
 * The reader's own corner of the header: who they are, the way to their
 * account, and the way out.
 *
 * The product had no way out at all — the dictionary carried "Sign out" and
 * nothing rendered it. A member signed in through single sign-on, who has no
 * password to fall back on, could only close the tab. Signing out ends the
 * session server-side (the cookie alone is not the session), then lands on
 * the sign-in page.
 */
export function AccountMenu({
  name,
  roleLabel,
  initials,
}: {
  name: string;
  roleLabel: string;
  initials: string;
}) {
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
    padding: "8px 12px",
    fontSize: 13,
    color: "var(--ink)",
    background: "transparent",
    border: 0,
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
  };

  return (
    <div ref={root} style={{ position: "relative", flex: "none" }}>
      <button
        type="button"
        data-testid="account-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${name} · ${roleLabel}`}
        onClick={() => setOpen((v) => !v)}
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
          border: `1px solid ${open ? "var(--brand)" : "transparent"}`,
          cursor: "pointer",
        }}
      >
        {initials}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="account-menu"
          style={{
            position: "absolute",
            right: 0,
            top: 38,
            minWidth: 220,
            padding: 6,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            boxShadow: "var(--shadow-card-hover)",
            zIndex: 40,
          }}
        >
          <div style={{ padding: "8px 12px 10px", borderBottom: "1px solid var(--line-2)" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{roleLabel}</div>
          </div>
          <Link
            href="/app/account"
            role="menuitem"
            className="oi-hover"
            data-testid="account-menu-account"
            onClick={() => setOpen(false)}
            style={{ ...item, marginTop: 6 }}
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
