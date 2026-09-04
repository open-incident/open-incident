import { useEffect } from "react";

/** Closes a dialog on Escape wherever the focus sits — the trigger button is gone once the sheet opens. */
export function useEscape(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, onClose]);
}
