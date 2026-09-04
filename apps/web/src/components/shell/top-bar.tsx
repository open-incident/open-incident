"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/avatar";
import { ProductMark, Wordmark } from "./mark";
import { CommandPalette } from "./command-palette";

export type ShellMember = {
  name: string;
  email: string;
  role: string;
  canRespond: boolean;
  isManager: boolean;
};

/**
 * The 56 px top bar of the design: mark + wordmark, the breadcrumb (mono slug /
 * section / current), the ⌘K search in the middle (max 560), the one primary
 * action of the product on the right, then the member's avatar.
 *
 * The design also draws a bell with a badge. There is no notification feed yet,
 * so there is no bell: a control with nothing behind it is the defect this
 * product refuses, not a placeholder to fill later.
 */
export function TopBar({
  slug,
  member,
  crumbs,
}: {
  slug: string;
  member: ShellMember;
  crumbs: Array<{ label: string; href?: string; mono?: boolean }>;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        height: 56,
        flex: "none",
        padding: "0 16px",
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <Link
        href="/app/incidents"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          color: "inherit",
          textDecoration: "none",
        }}
      >
        <ProductMark />
        <Wordmark />
      </Link>

      <nav
        aria-label={t("nav.breadcrumb")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13.5,
          color: "var(--ink-3)",
          flex: "none",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{slug}</span>
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "contents" }}>
            <span>/</span>
            {c.href ? (
              <Link
                href={c.href}
                style={{ color: "var(--brand-2)", fontWeight: 500, textDecoration: "none" }}
              >
                {c.label}
              </Link>
            ) : (
              <span
                style={{
                  fontFamily: c.mono ? "var(--font-mono)" : undefined,
                  fontSize: c.mono ? 12.5 : 12.5,
                  color: "var(--ink-2)",
                }}
              >
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="oi-hover-edge"
        aria-label={t("palette.open")}
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: 560,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 36,
          padding: "0 8px 0 12px",
          background: "var(--sunk)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13.5,
            color: "var(--ink-3)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {t("palette.placeholder")}
        </span>
        <span className="oi-kbd">⌘K</span>
      </button>

      {member.canRespond && (
        <Link
          href="/app/incidents/new"
          data-testid="declare-open"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 36,
            padding: "0 14px",
            borderRadius: 9,
            background: "var(--brand)",
            color: "#fff",
            fontSize: 13.5,
            fontWeight: 600,
            whiteSpace: "nowrap",
            textDecoration: "none",
          }}
        >
          {t("incidents.declareCta")}
        </Link>
      )}

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 14,
          color: "var(--ink-3)",
        }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={member.name}
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "var(--brand-t)",
            color: "var(--brand)",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 700,
            border: "1px solid var(--brand-b)",
            cursor: "pointer",
          }}
        >
          {initials(member.name)}
        </button>
        {menuOpen && (
          <>
            <div
              onClick={() => setMenuOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 40 }}
            />
            <div
              role="menu"
              className="oi-rise-fast"
              style={{
                position: "absolute",
                top: 38,
                right: 0,
                zIndex: 50,
                width: 240,
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "var(--shadow-card-hover)",
                padding: 6,
              }}
            >
              <div
                style={{
                  padding: "8px 10px 10px",
                  borderBottom: "1px solid var(--line-2)",
                  marginBottom: 4,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  {member.name}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {member.email}
                </div>
              </div>
              <Link
                href="/app/account"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="oi-hover"
                style={{
                  display: "block",
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "var(--ink)",
                  textDecoration: "none",
                }}
              >
                {t("nav.account")}
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  await authClient.signOut();
                  router.push("/login");
                  router.refresh();
                }}
                className="oi-hover"
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "var(--ink)",
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                }}
              >
                {t("nav.signOut")}
              </button>
            </div>
          </>
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        canRespond={member.canRespond}
        isManager={member.isManager}
        currentPath={pathname}
      />
    </header>
  );
}
