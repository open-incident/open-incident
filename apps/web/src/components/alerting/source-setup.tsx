"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { rotateSecret } from "@/app/app/settings/alert-sources/actions";

const mono: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 10px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const btn: React.CSSProperties = {
  height: 30,
  padding: "0 11px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
};

/**
 * Connecting the tool: the endpoint, the secret (shown once, at creation or
 * after a rotation), the steps for this kind of tool, a command that sends a
 * first alert — and a live line that waits for it, refreshing until it lands.
 */
export function SourceSetup({
  sourceId,
  kindLabel,
  endpoint,
  secret,
  steps,
  curl,
  hasAlerts,
}: {
  sourceId: string;
  /** The tool's name as shown to people. */
  kindLabel: string;
  endpoint: string;
  /** The secret, only right after it was created — never stored readable. */
  secret: string | null;
  steps: string[];
  curl: string;
  hasAlerts: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [state, action, pending] = useActionState(rotateSecret, {});
  const shown = state.secret ?? secret;
  const copy = (what: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  // Waiting for the first alert: the page re-reads every few seconds until one arrives.
  useEffect(() => {
    if (hasAlerts) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 15 * 60_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [hasAlerts, router]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span
          style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", width: 70, flex: "none" }}
        >
          {t("settings.sources.endpoint")}
        </span>
        <code style={mono} data-testid="source-endpoint">
          {endpoint}
        </code>
        <button type="button" onClick={() => copy("endpoint", endpoint)} style={btn}>
          {copied === "endpoint" ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span
          style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", width: 70, flex: "none" }}
        >
          {t("settings.sources.secret")}
        </span>
        {shown ? (
          <>
            <code style={{ ...mono, borderColor: "var(--brand-b)" }} data-testid="source-secret">
              {shown}
            </code>
            <button type="button" onClick={() => copy("secret", shown)} style={btn}>
              {copied === "secret" ? t("common.copied") : t("common.copy")}
            </button>
          </>
        ) : (
          <>
            <span
              style={{
                ...mono,
                color: "var(--ink-3)",
                fontStyle: "italic",
                fontFamily: "inherit",
                fontSize: 12,
              }}
            >
              {t("settings.sources.secretHidden")}
            </span>
            <form
              action={action}
              onSubmit={(e) => {
                if (!window.confirm(t("settings.sources.rotateConfirm"))) e.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={sourceId} />
              <button type="submit" disabled={pending} style={btn}>
                {t("settings.sources.rotate")}
              </button>
            </form>
          </>
        )}
      </div>
      {shown && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--wait)", fontWeight: 600 }}>
          {t("settings.sources.secretOnce")}
        </p>
      )}
      <ol
        style={{
          margin: "4px 0 0",
          paddingLeft: 20,
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--ink-2)",
        }}
      >
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <details>
        <summary
          style={{ fontSize: 12.5, color: "var(--brand)", fontWeight: 600, cursor: "pointer" }}
        >
          {t("settings.sources.curl")}
        </summary>
        <pre
          style={{
            margin: "6px 0 0",
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--deep, #111)",
            color: "#e8eef5",
            fontSize: 11.5,
            overflow: "auto",
          }}
        >
          {curl}
        </pre>
      </details>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12.5,
          fontWeight: 600,
          color: hasAlerts ? "var(--ok)" : "var(--wait)",
        }}
        data-testid="source-waiting"
        data-state={hasAlerts ? "received" : "waiting"}
      >
        <span
          className={hasAlerts ? undefined : "oi-pulse"}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: hasAlerts ? "var(--ok)" : "var(--wait)",
          }}
        />
        {hasAlerts
          ? t("settings.sources.received")
          : t("settings.sources.waiting", { kind: kindLabel })}
      </div>
    </div>
  );
}
