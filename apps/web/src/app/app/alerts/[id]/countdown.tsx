"use client";

import { useEffect, useState } from "react";

/** The live "next level in m:ss" of the escalation card. Renders 0:00 once the deadline passed. */
export function Countdown({ until }: { until: string }) {
  const target = new Date(until).getTime();
  const [left, setLeft] = useState(() => Math.max(0, target - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, target - Date.now())), 1000);
    return () => clearInterval(id);
  }, [target]);
  const s = Math.floor(left / 1000);
  return (
    <span
      data-testid="escalation-countdown"
      style={{ fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--dang)" }}
    >
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}
