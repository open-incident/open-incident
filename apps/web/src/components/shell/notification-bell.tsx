"use client";

/**
 * The bell in the header.
 *
 * A dot, and behind it the last twenty things that concerned the reader. It
 * never rings and never sends: what wakes someone up is the escalation policy,
 * and this is where they find out afterwards what happened. A line opens the
 * thing it is about and is marked read on the way; "mark all as read" clears
 * the dot without opening anything.
 *
 * The rows arrive from the server with the rest of the shell, so an ordinary
 * navigation refreshes them. There is no polling: a badge that costs a request
 * every ten seconds for news that can wait is a bad trade.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { NavIcon } from "./nav-icons";

export type BellRow = {
  id: string;
  kind: "paged" | "incident" | "follow_up" | "mention";
  title: string;
  body: string | null;
  url: string | null;
  count: number;
  read: boolean;
  at: string;
};

export type BellProps = {
  rows: BellRow[];
  unread: number;
  /** Marks one line, or every line when given nothing. */
  markReadAction: (id?: string) => Promise<void>;
};

const KIND_TONE: Record<BellRow["kind"], { ink: string; bg: string }> = {
  paged: { ink: "var(--dang)", bg: "var(--dang-t)" },
  incident: { ink: "var(--wait)", bg: "var(--wait-t)" },
  follow_up: { ink: "var(--brand)", bg: "var(--brand-t)" },
  mention: { ink: "var(--viol)", bg: "var(--viol-t)" },
};

// Written out rather than built from the kind: the dictionary keys are checked
// at compile time, and a key made of a template string is checked by nobody.
const KIND_LABEL = {
  paged: "bell.kind.paged",
  incident: "bell.kind.incident",
  follow_up: "bell.kind.followUp",
  mention: "bell.kind.mention",
} as const;

export function NotificationBell({ rows, unread, markReadAction }: BellProps) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markAll = () => {
    startTransition(async () => {
      await markReadAction();
      router.refresh();
    });
  };

  const openRow = (row: BellRow) => {
    setOpen(false);
    if (row.read) return;
    startTransition(async () => {
      await markReadAction(row.id);
      router.refresh();
    });
  };

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={t("bell.title")}
        aria-expanded={open}
        data-testid="bell"
        onClick={() => setOpen((v) => !v)}
        className="oi-hover"
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          display: "grid",
          placeItems: "center",
          position: "relative",
          background: "transparent",
          border: "none",
          color: "var(--ink-2)",
          cursor: "pointer",
        }}
      >
        <span style={{ width: 16, height: 16, display: "grid", placeItems: "center" }}>
          <NavIcon id="bell" size={16} />
        </span>
        {unread > 0 && (
          <span
            data-testid="bell-dot"
            style={{
              position: "absolute",
              top: 7,
              right: 8,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--dang)",
              border: "1.5px solid var(--panel)",
            }}
          />
        )}
      </button>

      {open && (
        <div
          className="oi-rise-fast"
          data-testid="bell-panel"
          style={{
            position: "absolute",
            top: 40,
            right: 0,
            width: 380,
            maxWidth: "calc(100vw - 32px)",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-pop)",
            overflow: "hidden",
            zIndex: 60,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "11px 14px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("bell.title")}</span>
            <span style={{ flex: 1 }} />
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                data-testid="bell-mark-all"
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--brand)",
                  cursor: "pointer",
                }}
              >
                {t("bell.markAll")}
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: "26px 18px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("bell.empty")}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>
                {t("bell.emptyHint")}
              </div>
            </div>
          ) : (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {rows.map((row) => {
                const tone = KIND_TONE[row.kind];
                const inner = (
                  <>
                    <span
                      style={{
                        flex: "none",
                        marginTop: 2,
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: row.read ? "var(--line)" : tone.ink,
                      }}
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            letterSpacing: ".06em",
                            textTransform: "uppercase",
                            color: tone.ink,
                            background: tone.bg,
                            borderRadius: 5,
                            padding: "1px 6px",
                          }}
                        >
                          {t(KIND_LABEL[row.kind])}
                        </span>
                        {row.count > 1 && (
                          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                            {t("bell.times", { count: row.count })}
                          </span>
                        )}
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{row.at}</span>
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 13,
                          fontWeight: row.read ? 400 : 600,
                          marginTop: 3,
                          lineHeight: 1.4,
                        }}
                      >
                        {row.title}
                      </span>
                      {row.body && (
                        <span
                          style={{
                            display: "block",
                            fontSize: 11.5,
                            color: "var(--ink-3)",
                            marginTop: 2,
                            lineHeight: 1.45,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.body}
                        </span>
                      )}
                    </span>
                  </>
                );
                const style: React.CSSProperties = {
                  display: "flex",
                  gap: 10,
                  padding: "11px 14px",
                  borderBottom: "1px solid var(--line-2)",
                  textAlign: "left",
                  width: "100%",
                  background: row.read ? "transparent" : "var(--sunk)",
                  color: "inherit",
                  textDecoration: "none",
                  border: "none",
                  borderBottomStyle: "solid",
                  cursor: "pointer",
                };
                return row.url ? (
                  <Link
                    key={row.id}
                    href={row.url}
                    data-testid="bell-row"
                    className="oi-hover"
                    style={style}
                    onClick={() => openRow(row)}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={row.id}
                    type="button"
                    data-testid="bell-row"
                    className="oi-hover"
                    style={style}
                    onClick={() => openRow(row)}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          )}

          <div
            style={{
              padding: "9px 14px",
              background: "var(--sunk)",
              fontSize: 11,
              color: "var(--ink-3)",
              lineHeight: 1.45,
            }}
          >
            {t("bell.note")}
          </div>
        </div>
      )}
    </div>
  );
}
