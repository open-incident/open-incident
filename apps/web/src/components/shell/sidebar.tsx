"use client";

/**
 * The 228 px rail, as the V2 design draws it: the product, the workspace,
 * "Declare incident", the nine sections with their badges, Guide and Settings
 * — and, pinned to its foot, who carries the pager right now with the
 * "Page me" that proves the chain, then the reader themselves.
 *
 * Who is on call sits in the rail rather than the header because it is read
 * at the same glance as the badges above it: something is burning, and this
 * is who is answering. `marginTop: auto` on the card is what keeps it at the
 * foot of the column at any height, including the one where the sections
 * already fill it.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";
import { ProductMark } from "./mark";
import { NavIcon, type NavIconId } from "./nav-icons";
import { WorkspaceMenu, type RailWorkspace } from "./workspace-menu";
import { AccountMenu, type RailMember } from "./account-menu";
import type { MessageKey } from "@/i18n/dictionaries/en";

export type { RailWorkspace, RailMember };

export type SidebarSection = {
  id: NavIconId;
  href: string;
  labelKey: MessageKey;
  /** A count worth interrupting for: open incidents, firing alerts. */
  badge?: number;
  /** Said instead of a badge when the section exists but its module does not. */
  tag?: MessageKey;
};

/** The person the rail names, the schedule they cover and when their shift ends. */
export type OnCallNow = { firstName: string; scheduleName: string; until: string } | null;

export type SidebarProps = {
  workspace: RailWorkspace;
  member: RailMember;
  sections: SidebarSection[];
  onCall: OnCallNow;
  canDeclare: boolean;
  onDeclare: () => void;
  canPageSelf: boolean;
  paging: boolean;
  onPageMe: () => void;
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
  workspace,
  member,
  sections,
  onCall,
  canDeclare,
  onDeclare,
  canPageSelf,
  paging,
  onPageMe,
}: SidebarProps) {
  const t = useT();
  const pathname = usePathname() ?? "";
  // The guide is one entry with two addresses: the getting-started page the
  // rail opens, and the chapters it leads to.
  const guideOn = isCurrent(pathname, "/app/guide") || isCurrent(pathname, "/app/docs");
  const settingsOn = isCurrent(pathname, "/app/settings");

  return (
    <aside
      data-testid="rail"
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

      <WorkspaceMenu workspace={workspace} />

      {canDeclare && (
        <button
          type="button"
          onClick={onDeclare}
          data-testid="rail-declare"
          className="oi-hover-brand-2"
          style={{
            height: 36,
            flex: "none",
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
                data-testid={`rail-badge-${s.id}`}
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

      <div style={{ height: 1, flex: "none", background: "var(--line)", margin: "8px 6px" }} />

      <Link
        href="/app/guide"
        className="oi-hover"
        aria-current={guideOn ? "page" : undefined}
        style={{
          ...ROW,
          fontWeight: 500,
          color: "var(--ink-2)",
          background: guideOn ? "var(--brand-t)" : "transparent",
        }}
      >
        <span style={{ width: 18, height: 18, display: "grid", placeItems: "center" }}>
          <NavIcon id="guide" />
        </span>
        {t("nav.guide")}
      </Link>
      <Link
        href="/app/settings"
        className="oi-hover"
        aria-current={settingsOn ? "page" : undefined}
        style={{
          ...ROW,
          fontWeight: 500,
          color: "var(--ink-2)",
          background: settingsOn ? "var(--brand-t)" : "transparent",
        }}
      >
        <span style={{ width: 18, height: 18, display: "grid", placeItems: "center" }}>
          <NavIcon id="settings" />
        </span>
        {t("nav.settings")}
      </Link>

      <div
        data-testid="oncall-card"
        style={{
          marginTop: "auto",
          flex: "none",
          background: "var(--sunk)",
          borderRadius: 12,
          padding: "11px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <Link
          href="/app/on-call"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            color: "inherit",
            textDecoration: "none",
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12.5,
              fontWeight: 600,
              minWidth: 0,
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
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {onCall ? t("nav.onCallNow", { name: onCall.firstName }) : t("nav.onCallNobody")}
            </span>
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: "var(--ink-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {onCall
              ? t("nav.onCallUntil", { schedule: onCall.scheduleName, until: onCall.until })
              : t("nav.onCallNobodyHint")}
          </span>
        </Link>
        {canPageSelf && (
          <button
            type="button"
            onClick={onPageMe}
            disabled={paging}
            data-testid="page-me"
            className="oi-hover-edge"
            style={{
              marginTop: 6,
              height: 28,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--panel)",
              color: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 600,
              cursor: paging ? "default" : "pointer",
              opacity: paging ? 0.6 : 1,
            }}
          >
            {t("nav.pageMe")}
          </button>
        )}
      </div>

      <AccountMenu member={member} />
    </aside>
  );
}
