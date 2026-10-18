"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { sourceHeard } from "../../settings/alert-sources/actions";

/** Where each tool takes a webhook URL — the end of "Paste this URL in Datadog → …". */
const WHERE: Record<string, string> = {
  datadog: "alst.secret.where.datadog",
  prometheus: "alst.secret.where.prometheus",
  grafana: "alst.secret.where.grafana",
  sentry: "alst.secret.where.sentry",
  cloudwatch: "alst.secret.where.cloudwatch",
  uptime_kuma: "alst.secret.where.uptime_kuma",
};

/**
 * The secret, shown once.
 *
 * It is never stored in a readable form, so this dialog is the only moment it
 * exists on a screen: it carries the whole URL the tool is given, a copy
 * button, and — for a new source — a line that watches for the tool's first
 * alert and says so when it lands.
 */
export function SecretDialog({
  name,
  kind,
  endpoint,
  secret,
  watchSourceId,
  doneLabel,
  onDone,
}: {
  name: string;
  kind: string;
  endpoint: string;
  secret: string;
  /** A new source: the dialog polls until its first alert arrives. */
  watchSourceId?: string;
  doneLabel: string;
  onDone: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [heard, setHeard] = useState<{ title: string | null } | null>(null);
  const url = `${endpoint}?secret=${secret}`;

  useEffect(() => {
    if (!watchSourceId || heard) return;
    let stop = false;
    const tick = async () => {
      const r = await sourceHeard(watchSourceId).catch(() => null);
      if (!stop && r?.received) setHeard({ title: r.title });
    };
    const timer = window.setInterval(tick, 3000);
    const end = window.setTimeout(() => window.clearInterval(timer), 15 * 60_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
      window.clearTimeout(end);
    };
  }, [watchSourceId, heard]);

  const where = WHERE[kind];
  const [before, after] = where
    ? t.parts("alst.secret.text", "once", {
        name,
        where: t(where as "alst.secret.where.datadog"),
      })
    : t.parts("alst.secret.textHttp", "once");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
        zIndex: 50,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="source-created"
        style={{
          width: 560,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--panel)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          textAlign: "left",
          animation: "oi-rise .16s ease backwards",
        }}
      >
        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: "var(--ok-t)",
                color: "var(--ok)",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
              }}
            >
              ✓
            </span>
            <span style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>
              {t("alt2.secret.title", { name })}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
            {before}
            <strong style={{ color: "var(--wait)" }}>{t("alst.secret.once")}</strong>
            {after}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <code
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                background: "var(--sunk)",
                border: "1px solid var(--brand-b)",
                borderRadius: 8,
                padding: "9px 11px",
                wordBreak: "break-all",
                lineHeight: 1.5,
              }}
            >
              <span data-testid="source-endpoint">{endpoint}</span>?secret=
              <span data-testid="source-secret">{secret}</span>
            </code>
            <button
              type="button"
              data-testid="source-copy"
              onClick={() => {
                navigator.clipboard?.writeText(url).catch(() => {});
                setCopied(true);
              }}
              className="oi-hover-brand-2"
              style={{
                height: 38,
                padding: "0 14px",
                borderRadius: 8,
                border: 0,
                background: "var(--brand)",
                color: "var(--on-brand)",
                display: "flex",
                alignItems: "center",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                flex: "none",
              }}
            >
              {copied ? t("alst.secret.copied") : t("common.copy")}
            </button>
          </div>
          {watchSourceId && (
            <div
              data-testid="source-first-alert"
              data-state={heard ? "received" : "waiting"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                background: heard ? "var(--ok-t)" : "var(--viol-t)",
                borderRadius: 10,
                padding: "10px 13px",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: heard ? "var(--ok)" : "var(--viol)",
                  flex: "none",
                  animation: heard ? undefined : "oi-pulse 2s infinite",
                }}
              />
              {heard
                ? t("alst.secret.heard", { name, title: heard.title ?? "—" })
                : t("alt2.secret.waiting", { name })}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "14px 22px",
            borderTop: "1px solid var(--line)",
            background: "var(--sunk)",
          }}
        >
          <span style={{ flex: 1 }} />
          <button
            type="button"
            data-testid="source-configure"
            onClick={onDone}
            className="oi-hover-brand-2"
            style={{
              height: 34,
              padding: "0 16px",
              borderRadius: 9,
              border: 0,
              background: "var(--brand)",
              color: "var(--on-brand)",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {doneLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
