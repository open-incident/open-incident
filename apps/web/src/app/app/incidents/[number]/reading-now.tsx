"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { avatarTone, initials } from "@/lib/avatar";

/**
 * "3 reading now" — the other members who have this post-mortem open, from
 * the presence beat of `/api/incidents/{id}/presence`. Nobody else: nothing.
 */
export function ReadingNow({ incidentId }: { incidentId: string }) {
  const t = useT();
  const [readers, setReaders] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/incidents/${incidentId}/presence`, { method: "POST" });
        if (!res.ok) return;
        const body = (await res.json()) as { readers: Array<{ id: string; name: string }> };
        if (alive) setReaders(body.readers);
      } catch {
        /* the strip simply shows nobody */
      }
    };
    void tick();
    const timer = setInterval(tick, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [incidentId]);
  if (readers.length === 0) return null;
  return (
    <div
      data-testid="pm-readers"
      style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 8 }}
    >
      {readers.slice(0, 5).map((r) => {
        const tone = avatarTone(r.name);
        return (
          <span
            key={r.id}
            title={r.name}
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: tone.bg,
              color: tone.ink,
              display: "grid",
              placeItems: "center",
              fontSize: 9,
              fontWeight: 700,
              border: "2px solid var(--panel)",
              marginLeft: -8,
              boxSizing: "border-box",
            }}
          >
            {initials(r.name)}
          </span>
        );
      })}
      <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: 4 }}>
        {t("incv2.pi.reading", { count: readers.length })}
      </span>
    </div>
  );
}
