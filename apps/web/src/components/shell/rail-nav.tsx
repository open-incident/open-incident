"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";

/**
 * The 60 px rail of the design: 40×40 tiles, radius 11, 19 px strokes 1.9.
 * The active one sits on --brand-t in --brand; the others are --ink-3 and take
 * --sunk on hover. Sections that have no screen yet are drawn as the design
 * draws its future items — present, muted, labelled with the milestone — and
 * are not links: a tile that leads nowhere is the defect this product refuses.
 */
type Item = { key: string; href: string; label: string; soon?: string; icon: React.ReactNode };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="19" height="19" {...stroke} aria-hidden="true">
    <path d={d} />
  </svg>
);

export function RailNav() {
  const t = useT();
  const pathname = usePathname();
  const items: Item[] = [
    {
      key: "incidents",
      href: "/app/incidents",
      label: t("nav.incidents"),
      icon: svg("M13 2 3 14h9l-1 8 10-12h-9l1-8z"),
    },
    {
      key: "alerts",
      href: "/app/alerts",
      label: t("nav.alerts"),
      icon: svg("M22 12h-4l-3 9L9 3l-3 9H2"),
    },
    {
      key: "oncall",
      href: "/app/on-call",
      label: t("nav.onCall"),
      icon: svg(
        "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
      ),
    },
    {
      key: "status",
      href: "/app/status-pages",
      label: t("nav.statusPages"),
      icon: svg(
        "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10",
      ),
    },
    {
      key: "catalog",
      href: "/app/catalog",
      label: t("nav.catalog"),
      icon: svg(
        "M12 2C7.03 2 3 3.34 3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5c0-1.66-4.03-3-9-3M3 5c0 1.66 4.03 3 9 3s9-1.34 9-3M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3",
      ),
    },
    {
      key: "insights",
      href: "/app/insights",
      label: t("nav.insights"),
      icon: svg("M12 20V10M18 20V4M6 20v-4"),
    },
    {
      key: "docs",
      href: "/app/docs",
      label: t("nav.guide"),
      icon: svg(
        "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z",
      ),
    },
  ];
  const settings: Item = {
    key: "settings",
    href: "/app/settings",
    label: t("nav.settings"),
    icon: svg("M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"),
  };

  const tile = (item: Item) => {
    const active = pathname.startsWith(item.href);
    const style: React.CSSProperties = {
      width: 40,
      height: 40,
      borderRadius: 11,
      display: "grid",
      placeItems: "center",
      color: active ? "var(--brand)" : "var(--ink-3)",
      background: active ? "var(--brand-t)" : "transparent",
      position: "relative",
    };
    if (item.soon) {
      return (
        <span
          key={item.key}
          title={`${item.label} — ${item.soon}`}
          aria-disabled
          style={{ ...style, opacity: 0.55, cursor: "default" }}
        >
          {item.icon}
        </span>
      );
    }
    return (
      <Link
        key={item.key}
        href={item.href}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={active ? undefined : "oi-hover"}
        style={style}
      >
        {item.icon}
      </Link>
    );
  };

  return (
    <nav
      aria-label={t("nav.primary")}
      style={{
        width: 60,
        flex: "none",
        background: "var(--panel)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 0",
        gap: 6,
      }}
    >
      {items.map(tile)}
      <span style={{ flex: 1 }} />
      {tile(settings)}
    </nav>
  );
}
