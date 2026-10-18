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
const ATLAS_TOAST = "oi:atlas-toast";

/**
 * Runs an Atlas command and says what happened, the design's way: one line
 * at the bottom of the screen for a few seconds. The line lives in the app
 * frame (AtlasToaster), not in the card that asked: a verdict or an undo
 * revalidates the page, and the card it came from is often gone by then.
 */
export function useAtlasCommand() {
  const t = useT();
  const [pending, start] = useTransition();
  const say = (message: string) =>
    window.dispatchEvent(new CustomEvent(ATLAS_TOAST, { detail: message }));
  const run = useCallback(
    (fn: () => Promise<AtlasResult>, after?: (r: AtlasResult) => void) =>
      start(async () => {
        try {
          const r = await fn();
          say(r.message);
          after?.(r);
        } catch {
          say(t("atlas.ui.refused"));
        }
      }),
    [t],
  );
  return { run, pending, toast: null };
}

/** Mounted once in the app frame. */
export function AtlasToaster() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMessage((e as CustomEvent<string>).detail);
    window.addEventListener(ATLAS_TOAST, on);
    return () => window.removeEventListener(ATLAS_TOAST, on);
  }, []);
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(id);
  }, [message]);
  return message ? (
    <div role="status" data-testid="atlas-toast" style={toastStyle()}>
      {message}
    </div>
  ) : null;
}
