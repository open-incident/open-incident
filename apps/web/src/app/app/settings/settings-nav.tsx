"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useT } from "@/i18n/client";

/**
 * The settings navigation (design V2): "Settings" — the overview — then
 * "Find a setting", then five groups of entries, one entry per screen.
 *
 * The search reads what a person would type: an entry's name, the line that
 * says where it stands, and its group — "okta", "expire", "slack" all land.
 * An enterprise screen the instance lacks wears "EE"; an entry whose state
 * wants a look carries a dot in that state's colour.
 *
 * The groups arrive built and filtered by permission on the server; nothing
 * about who may see what is decided here.
 */
export type NavEntry = {
  key: string;
  href: string;
  label: string;
  status: string;
  tone?: "wait" | "dang";
  locked?: boolean;
  paths: string[];
};
export type NavGroup = { key: string; title: string; entries: NavEntry[] };

export function SettingsNav({ groups, label }: { groups: NavGroup[]; label: string }) {
  const t = useT();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const home = pathname === "/app/settings";
  const query = q.trim().toLowerCase();
  const isCurrent = (e: NavEntry) =>
    e.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const shown = groups
    .map((g) => ({
      ...g,
      entries: g.entries.filter(
        (e) => !query || `${e.label} ${e.status} ${g.title}`.toLowerCase().includes(query),
      ),
    }))
    .filter((g) => g.entries.length > 0);

  return (
    <nav
      aria-label={label}
      data-testid="settings-nav"
      style={{
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        paddingTop: 2,
      }}
    >
      <Link
        href="/app/settings"
        aria-current={home ? "page" : undefined}
        className="oi-hover"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          borderRadius: 9,
          cursor: "pointer",
          background: home ? "var(--brand-t)" : "transparent",
          fontSize: 13.5,
          fontWeight: 600,
          color: home ? "var(--brand)" : "var(--ink)",
          textDecoration: "none",
        }}
      >
        {t("settingsV2.home")}
      </Link>
      <div style={{ position: "relative", margin: "6px 0 2px" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("settingsV2.nav.find")}
          aria-label={t("settingsV2.nav.find")}
          data-testid="settings-find"
          className="oi-field"
          style={{
            width: "100%",
            height: 32,
            border: "1px solid var(--line)",
            borderRadius: 9,
            padding: "0 10px 0 30px",
            fontSize: 12.5,
            background: "var(--panel)",
            outline: "none",
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 11,
            top: 10,
            width: 11,
            height: 11,
            border: "1.6px solid var(--ink-3)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />
      </div>
      {shown.map((g) => (
        <div key={g.key} style={{ display: "contents" }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              padding: "12px 10px 4px",
            }}
          >
            {g.title}
          </div>
          {g.entries.map((e) => {
            const on = isCurrent(e);
            return (
              <Link
                key={e.key}
                href={e.href}
                data-entry={e.key}
                aria-current={on ? "page" : undefined}
                className="oi-hover"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: on ? 600 : 400,
                  color: on ? "var(--brand)" : "var(--ink-2)",
                  background: on ? "var(--brand-t)" : "transparent",
                  textDecoration: "none",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.label}
                </span>
                {e.locked && (
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: ".06em",
                      color: "var(--ink-3)",
                      border: "1px solid var(--line)",
                      borderRadius: 5,
                      padding: "0 5px",
                    }}
                  >
                    {t("settingsV2.nav.ee")}
                  </span>
                )}
                {e.tone && (
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: e.tone === "dang" ? "var(--dang)" : "var(--wait)",
                      flex: "none",
                    }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      ))}
      {shown.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--ink-3)", padding: 10 }}>
          {t("settingsV2.nav.noMatch", { q: q.trim() })}
        </div>
      )}
    </nav>
  );
}
