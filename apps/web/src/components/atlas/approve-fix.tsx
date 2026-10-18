"use client";

import { atlasDecide } from "./actions";
import { useAtlasCommand } from "./toast";

/** "Approve the fix" — one tap on the proposal Atlas is waiting on. */
export function ApproveFix({ actionId, label }: { actionId: string; label: string }) {
  const { run, pending, toast } = useAtlasCommand();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        data-testid="atlas-approve-fix"
        onClick={() => run(() => atlasDecide(actionId, true))}
        style={{
          background: "none",
          border: 0,
          padding: 0,
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--viol)",
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
