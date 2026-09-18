"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { rotateSecret } from "../../settings/alert-sources/actions";
import { SecretDialog } from "./secret-dialog";

/**
 * "Receiving" or "waiting for the first alert" — read off the source's real
 * `lastAlertAt`. While it is waiting the page re-reads itself every few
 * seconds, so the first alert lands on screen without anyone pressing reload.
 */
export function FirstAlert({
  waiting,
  label,
  ink,
}: {
  waiting: boolean;
  label: string;
  ink: string;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 15 * 60_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [waiting, router]);
  return (
    <span
      data-testid="source-waiting"
      data-state={waiting ? "waiting" : "received"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        color: ink,
      }}
    >
      <span
        className={waiting ? "oi-pulse" : undefined}
        style={{ width: 6, height: 6, borderRadius: "50%", background: ink }}
      />
      {label}
    </span>
  );
}

/** A new secret, shown once — the old one stops working the moment this returns. */
export function RotateSecret({ id, name }: { id: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [state, action, pending] = useActionState(rotateSecret, {});
  const [dismissed, setDismissed] = useState(false);
  const shown = Boolean(state.secret && state.endpoint) && !dismissed;
  return (
    <>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={pending}
          className="oi-hover"
          style={{
            height: 32,
            padding: "0 13px",
            border: "1px solid var(--line)",
            borderRadius: 9,
            background: "var(--panel)",
            display: "flex",
            alignItems: "center",
            fontSize: 12.5,
            cursor: "pointer",
            color: "inherit",
          }}
        >
          {t("alt2.source.rotate")}
        </button>
      </form>
      {shown && (
        <SecretDialog
          name={state.name ?? name}
          endpoint={state.endpoint!}
          secret={state.secret!}
          doneLabel={t("alt2.secret.added", { name: state.name ?? name })}
          onDone={() => {
            setDismissed(true);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
