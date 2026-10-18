"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import type { AtlasResult } from "./actions";
import { toastStyle } from "./ui";

/**
 * Runs an Atlas command and says what happened, the design's way: one line
 * at the bottom of the screen for a few seconds. The page re-renders from the
 * server on its own (the actions revalidate), so no state is kept here.
 */
export function useAtlasCommand() {
  const t = useT();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(id);
  }, [message]);
  const run = useCallback(
    (fn: () => Promise<AtlasResult>, after?: (r: AtlasResult) => void) =>
      start(async () => {
        try {
          const r = await fn();
          setMessage(r.message);
          after?.(r);
        } catch {
          setMessage(t("atlas.ui.refused"));
        }
      }),
    [t],
  );
  const toast = message ? (
    <div role="status" data-testid="atlas-toast" style={toastStyle()}>
      {message}
    </div>
  ) : null;
  return { run, pending, toast };
}
