"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The secondary navigation of the administration, as the V2 design draws it:
 * five groups, a 10.5 px uppercase label each, 13 px items, the current one in
 * brand ink on a brand tint.
 *
 * It is a client component for one reason: two items share a path and differ
 * only by a query string (`Incident types` and `Incident severities` are two
 * segments of the same screen), and a server layout never sees the query. The
 * groups themselves are built on the server, already filtered by permission —
 * nothing about who may see what is decided here.
 */
export type NavItem = {
  label: string;
  /** Absent for an item this instance cannot offer; `why` then says so. */
  href?: string;
  /** Query the href must carry to count as current, when the path is shared. */
  seg?: string;
  /** Set on an item whose path is shared and which is current only without `seg`. */
  bare?: boolean;
  /** Leaves the settings area — drawn with the ↗ mark. */
  external?: boolean;
  /** Why the item is not available here, and how to enable it. */
  why?: string;
  /** Short word beside a disabled item. */
  chip?: string;
  hint?: string;
};
export type NavGroup = { title: string; items: NavItem[] };

export function SettingsNav({ groups, label }: { groups: NavGroup[]; label: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const seg = search.get("seg");

  const isCurrent = (i: NavItem) => {
    if (!i.href || i.external) return false;
    const path = i.href.split("?")[0]!;
    if (!(pathname === path || pathname.startsWith(`${path}/`))) return false;
    if (i.seg) return seg === i.seg;
    if (i.bare) return !seg;
    return true;
  };

  return (
    <nav
      aria-label={label}
      style={{ display: "flex", flexDirection: "column", gap: 1, position: "sticky", top: 0 }}
    >
      {groups.map((g) => (
        <div key={g.title} style={{ display: "contents" }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              padding: "12px 10px 5px",
            }}
          >
            {g.title}
          </div>
          {g.items.map((i) => {
            const active = isCurrent(i);
            const base: React.CSSProperties = {
              padding: "6px 10px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              color: active ? "var(--brand)" : "var(--ink-2)",
              background: active ? "var(--brand-t)" : "transparent",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 6,
            };
            if (!i.href) {
              return (
                <span
                  key={i.label}
                  aria-disabled="true"
                  title={i.why}
                  style={{ ...base, color: "var(--ink-3)", cursor: "default" }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>{i.label}</span>
                  {i.chip && (
                    <span
                      style={{
                        padding: "1px 6px",
                        borderRadius: 5,
                        border: "1px solid var(--line)",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {i.chip}
                    </span>
                  )}
                </span>
              );
            }
            return (
              <Link
                key={i.href}
                href={i.href}
                title={i.hint}
                aria-current={active ? "page" : undefined}
                className={active ? undefined : "oi-hover"}
                style={base}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{i.label}</span>
                {i.external && (
                  <span aria-hidden style={{ fontSize: 10, color: "var(--ink-3)" }}>
                    ↗
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
