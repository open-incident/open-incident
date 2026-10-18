"use client";

import { atlasToggleUndo } from "./actions";
import { useAtlasCommand } from "./toast";

/** Undo / Redo of one Atlas action: a link in a timeline row or a review card. */
export function UndoButton({
  actionId,
  undone,
  label,
  variant,
}: {
  actionId: string;
  undone: boolean;
  label: string;
  variant: "link" | "review";
}) {
  const { run, pending, toast } = useAtlasCommand();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        data-testid={undone ? "atlas-redo" : "atlas-undo"}
        onClick={() => run(() => atlasToggleUndo(actionId))}
        style={{
          background: "none",
          border: 0,
          padding: 0,
          fontFamily: "inherit",
          fontSize: variant === "link" ? 11 : 11.5,
          fontWeight: 600,
          color: undone ? "var(--brand)" : variant === "link" ? "var(--ink-3)" : "var(--ink-2)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </button>
      {toast}
    </>
  );
}
