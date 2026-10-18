"use client";

import { useTransition } from "react";
import { flash } from "@/components/settings/controls";
import { pageActionStyle } from "@/components/settings/template";
import { previewRules } from "./actions";

/**
 * "Preview on the last 50 alerts": the rules as they stand, replayed on the
 * alerts that arrived — the answer in a toast. Nothing is sent.
 */
export function PreviewButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      data-testid="rules-preview"
      disabled={pending}
      onClick={() => start(async () => flash(await previewRules()))}
      className="oi-hover"
      style={{ ...pageActionStyle(false), opacity: pending ? 0.7 : 1 }}
    >
      {label}
    </button>
  );
}
