"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the analysis tab current: the incident's event stream says when an
 * assessment lands (its timeline event), and while one is running the page
 * re-renders every few seconds so the status is never stale.
 */
export function InvestigationLive({
  incidentId,
  lastEventId,
  running,
  label,
}: {
  incidentId: string;
  lastEventId: string;
  running: boolean;
  label: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const source = new EventSource(
      `/api/incidents/${incidentId}/events?after=${encodeURIComponent(lastEventId)}`,
    );
    source.addEventListener("incident-event", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as { kind?: string };
        if (data.kind === "investigation") router.refresh();
      } catch {
        router.refresh();
      }
    });
    const timer = running ? window.setInterval(() => router.refresh(), 4000) : undefined;
    return () => {
      source.close();
      if (timer) window.clearInterval(timer);
    };
  }, [incidentId, lastEventId, running, router]);
  if (!running) return null;
  return (
    <span
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        fontWeight: 600,
        color: "var(--viol)",
      }}
    >
      <span
        className="oi-pulse"
        style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--viol)" }}
      />
      {label}
    </span>
  );
}
