"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Subscribes to the incident's event stream. When a new event lands, the
 * server component re-renders — the timeline table IS the source of the live
 * view, there is no second one. The badge tells the truth: green while the
 * stream is open, grey when it is not.
 */
export function LiveTimeline({
  incidentId,
  lastEventId,
  label,
}: {
  incidentId: string;
  lastEventId: string;
  label: string;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(
      `/api/incidents/${incidentId}/events?after=${encodeURIComponent(lastEventId)}`,
    );
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("incident-event", () => router.refresh());
    return () => source.close();
  }, [incidentId, lastEventId, router]);

  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        fontWeight: 600,
        color: connected ? "var(--ok)" : "var(--ink-3)",
      }}
      aria-live="polite"
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: connected ? "var(--ok)" : "var(--ink-3)",
        }}
      />
      {label}
    </span>
  );
}
