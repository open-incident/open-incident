"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the server component every few seconds while a run is alive. */
export function AutoRefresh({ active, everyMs = 3_000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
