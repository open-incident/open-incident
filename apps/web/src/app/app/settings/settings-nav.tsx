"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The secondary navigation of the administration: four groups, a 10.5 px
 * uppercase label each, 13 px items, the current one in brand ink on a brand
 * tint.
 *
 * An entry stands for one screen, or for a family of screens the entry's own
 * tabs then separate — `paths` lists every path that counts as current. The
 * groups are built on the server, already filtered by permission; nothing
 * about who may see what is decided here.
 */
export type NavItem = {
  href: string;
  label: string;
  /** Every path this entry is current for; the href's own path when absent. */
  paths?: string[];
};
export type NavGroup = { title: string; items: NavItem[] };

export function SettingsNav({ groups, label }: { groups: NavGroup[]; label: string }) {
  const pathname = usePathname();
  const isCurrent = (i: NavItem) =>
    (i.paths ?? [i.href.split("?")[0]!]).some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );

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
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={active ? undefined : "oi-hover"}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? "var(--brand)" : "var(--ink-2)",
                  background: active ? "var(--brand-t)" : "transparent",
                  textDecoration: "none",
                  display: "block",
                }}
              >
                {i.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
