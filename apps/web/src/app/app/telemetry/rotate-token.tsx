"use client";

/**
 * "Rotate token": revokes the keys collectors hold and issues one new key,
 * shown here once — copied now, or rotated again.
 */

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { rotateWorkspaceKey } from "./actions";

export function RotateToken({ allowed }: { allowed: boolean }) {
  const t = useT();
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!allowed) {
    return <span style={{ color: "var(--ink-3)" }}>{t("tel2.rotateManager")}</span>;
  }
  if (key) {
    return (
      <span
        style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}
        data-testid="rotated-key"
      >
        <span style={{ color: "var(--ok)", fontWeight: 600 }}>{t("tel2.rotated")}</span>
        <code
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            background: "var(--sunk)",
            borderRadius: 8,
            padding: "8px 10px",
            wordBreak: "break-all",
            userSelect: "all",
          }}
        >
          {key}
        </code>
      </span>
    );
  }
  return (
    <>
      {confirming ? (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{t("tel2.rotateConfirm")}</span>
          <button
            type="button"
            disabled={pending}
            data-testid="rotate-confirm"
            onClick={() =>
              start(async () => {
                const out = await rotateWorkspaceKey();
                if ("key" in out) setKey(out.key);
                else setError(out.error);
              })
            }
            style={{
              border: 0,
              background: "none",
              color: "var(--dang)",
              fontWeight: 600,
              cursor: "pointer",
              padding: 0,
              fontSize: 12.5,
            }}
          >
            {pending ? "…" : t("tel2.rotateYes")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            style={{
              border: 0,
              background: "none",
              color: "var(--ink-3)",
              cursor: "pointer",
              padding: 0,
              fontSize: 12.5,
            }}
          >
            {t("common.cancel")}
          </button>
        </span>
      ) : (
        <button
          type="button"
          data-testid="rotate-token"
          onClick={() => setConfirming(true)}
          style={{
            border: 0,
            background: "none",
            color: "var(--brand)",
            fontWeight: 600,
            cursor: "pointer",
            padding: 0,
            fontSize: 12.5,
          }}
        >
          {t("tel2.rotate")}
        </button>
      )}
      {error && (
        <span style={{ color: "var(--dang)", marginLeft: 8 }}>{t("tel2.rotateManager")}</span>
      )}
    </>
  );
}
