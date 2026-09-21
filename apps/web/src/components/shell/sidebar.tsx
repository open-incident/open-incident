"use client";

/**
 * The 228 px rail: where you go, and nothing else.
 *
 * It is a column rather than the 60 px strip of the first design because the
 * V2 nav carries nine sections and a badge on two of them — a strip would have
 * hidden both behind tooltips.
 *
 * Who is on call and who you are used to live at the bottom of it. They are
 * now in the header, on the right, with the bell: they are not navigation, and
 * a rail that mixes "where can I go" with "who is carrying the pager" makes
 * the reader scan the whole column to find either. The header is also where
 * every application puts an avatar, which is worth more than a house style.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";
import { ProductMark } from "./mark";
import { NavIcon, type NavIconId } from "./nav-icons";
import type { MessageKey } from "@/i18n/dictionaries/en";

export type SidebarSection = {
  id: NavIconId;
  href: string;
  labelKey: MessageKey;
  /** A count worth interrupting for: open incidents, firing alerts. */
  badge?: number;
  /** Said instead of a badge when the section exists but its module does not. */
  tag?: MessageKey;
};

export type OnCallNow = { name: string; scheduleName: string; until: string } | null;

export type SidebarProps = {
  workspaceName: string;
  workspaceAccent: string;
  sections: SidebarSection[];
  canDeclare: boolean;
  onDeclare: () => void;
};

const ROW: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 10px",
  borderRadius: 9,
  fontSize: 13.5,
  cursor: "pointer",
  textDecoration: "none",
};

/** A section is current when the path is it, or lives under it. */
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  workspaceName,
  workspaceAccent,
  sections,
  canDeclare,
  onDeclare,
}: SidebarProps) {
  const t = useT();
  const pathname = usePathname() ?? "";

  return (
    <aside
      style={{
        width: 228,
        flex: "none",
        background: "var(--panel)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        padding: "12px 10px",
        gap: 2,
        overflowY: "auto",
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px 12px" }}>
        <ProductMark size={22} />
        <span
          style={{
            fontFamily: "var(--title)",
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "-.01em",
          }}
        >
          Open<span style={{ color: "var(--brand)" }}>*</span>Incident
        </span>
      </div>

      <div
        className="oi-hover"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 9px",
          marginBottom: 8,
          border: "1px solid var(--line)",
          borderRadius: 10,
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            background: workspaceAccent,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          {workspaceName.slice(0, 1).toUpperCase()}
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
          }}
        >
          {workspaceName}
        </span>
      </div>

      {canDeclare && (
        <button
          type="button"
          onClick={onDeclare}
          className="oi-hover-brand-2"
          style={{
            height: 36,
            borderRadius: 10,
            background: "var(--brand)",
            color: "var(--on-brand)",
            border: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: 10,
          }}
        >
          {t("nav.declare")}
        </button>
      )}

      {sections.map((s) => {
        const on = isCurrent(pathname, s.href);
        const muted = Boolean(s.tag);
        return (
          <Link
            key={s.href}
            href={s.href}
            className="oi-hover"
            style={{
              ...ROW,
              background: on ? "var(--brand-t)" : "transparent",
              color: on ? "var(--brand)" : muted ? "var(--ink-3)" : "var(--ink-2)",
              fontWeight: on ? 600 : 500,
            }}
            aria-current={on ? "page" : undefined}
          >
            {on && (
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  top: 8,
                  bottom: 8,
                  width: 3,
                  borderRadius: 3,
                  background: "var(--brand)",
                }}
              />
            )}
            <span
              style={{ width: 18, height: 18, display: "grid", placeItems: "center", flex: "none" }}
            >
              <NavIcon id={s.id} />
            </span>
            {t(s.labelKey)}
            <span style={{ flex: 1 }} />
            {s.badge !== undefined && s.badge > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "1px 7px",
                  background: "var(--dang-t)",
                  color: "var(--dang)",
                }}
              >
                {s.badge}
              </span>
            )}
            {s.tag && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--ink-3)",
                  border: "1px solid var(--line)",
                  borderRadius: 5,
                  padding: "1px 5px",
                }}
              >
                {t(s.tag)}
              </span>
            )}
          </Link>
        );
      })}

      <div style={{ height: 1, background: "var(--line)", margin: "8px 6px" }} />

      {(
        [
          { href: "/app/guide", id: "guide" as const, key: "nav.guide" as MessageKey },
          { href: "/app/settings", id: "settings" as const, key: "nav.settings" as MessageKey },
        ] satisfies { href: string; id: NavIconId; key: MessageKey }[]
      ).map((x) => {
        const on = isCurrent(pathname, x.href);
        return (
          <Link
            key={x.href}
            href={x.href}
            className="oi-hover"
            style={{
              ...ROW,
              fontWeight: 500,
              color: on ? "var(--brand)" : "var(--ink-2)",
              background: on ? "var(--brand-t)" : "transparent",
            }}
            aria-current={on ? "page" : undefined}
          >
            <span style={{ width: 18, height: 18, display: "grid", placeItems: "center" }}>
              <NavIcon id={x.id} />
            </span>
            {t(x.key)}
          </Link>
        );
      })}
    </aside>
  );
}
