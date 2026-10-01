"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The second level of a section: a segmented control drawn under the title,
 * one tab per screen of a family that shares a menu entry (General & brand
 * and Working hours; Members and the enterprise access screens; Types,
 * severities and fields; Monitors and Heartbeats).
 *
 * A client component for the same reason the settings navigation is one: two
 * tabs may share a path and differ only by a query string, which a server
 * component never sees.
 */
export type SegmentTab = {
  href: string;
  label: string;
  /** Query the href must carry to count as current, when the path is shared. */
  seg?: string;
  /** Set on a tab whose path is shared and which is current only without `seg`. */
  bare?: boolean;
  /** Other paths this tab stands for — screens folded under it. */
  also?: string[];
  testId?: string;
};

export function isCurrentTab(tab: SegmentTab, pathname: string, seg: string | null): boolean {
  const matches = (href: string) => {
    const path = href.split("?")[0]!;
    return pathname === path || pathname.startsWith(`${path}/`);
  };
  if (tab.also?.some(matches)) return true;
  if (!matches(tab.href)) return false;
  if (tab.seg) return seg === tab.seg;
  if (tab.bare) return !seg;
  return true;
}

export function SegmentTabs({ tabs, label }: { tabs: SegmentTab[]; label: string }) {
  const pathname = usePathname();
  const seg = useSearchParams().get("seg");
  return (
    <nav
      aria-label={label}
      role="tablist"
      style={{
        display: "inline-flex",
        gap: 2,
        background: "var(--sunk)",
        borderRadius: 10,
        padding: 3,
        alignSelf: "flex-start",
      }}
    >
      {tabs.map((tab) => {
        const on = isCurrentTab(tab, pathname, seg);
        return (
          <Link
            key={tab.href}
            role="tab"
            aria-selected={on}
            data-testid={tab.testId}
            href={tab.href}
            style={{
              height: 28,
              padding: "0 14px",
              borderRadius: 8,
              background: on ? "var(--panel)" : "transparent",
              color: on ? "var(--ink)" : "var(--ink-3)",
              boxShadow: on ? "var(--shadow-card)" : "none",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
