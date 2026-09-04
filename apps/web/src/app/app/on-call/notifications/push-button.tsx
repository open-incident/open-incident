"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { addWebPushMethod } from "./actions";

/** Enables web push on this browser: registers the service worker, subscribes, stores the subscription as a method. */
export function PushButton({ vapidPublicKey }: { vapidPublicKey: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "busy" | "done" | "denied" | "unsupported">("idle");
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      (!("serviceWorker" in navigator) || !("PushManager" in window))
    )
      setState("unsupported");
  }, []);
  const enable = async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return;
      }
      const key = Uint8Array.from(atob(vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      );
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      const r = await addWebPushMethod(
        JSON.stringify(sub),
        navigator.userAgent.includes("Mac")
          ? "Mac"
          : navigator.userAgent.includes("Windows")
            ? "Windows"
            : "browser",
      );
      setState(r.ok ? "done" : "idle");
    } catch {
      setState("idle");
    }
  };
  if (state === "unsupported")
    return (
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("notif.pushUnsupported")}</span>
    );
  if (state === "done")
    return (
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ok)" }}>
        {t("notif.pushEnabled")}
      </span>
    );
  if (state === "denied")
    return <span style={{ fontSize: 12, color: "var(--dang)" }}>{t("notif.pushDenied")}</span>;
  return (
    <button
      type="button"
      onClick={enable}
      disabled={state === "busy"}
      style={{
        height: 28,
        padding: "0 11px",
        border: "1px solid var(--brand-b)",
        borderRadius: 8,
        background: "var(--panel)",
        color: "var(--brand)",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {t("notif.enablePush")}
    </button>
  );
}
