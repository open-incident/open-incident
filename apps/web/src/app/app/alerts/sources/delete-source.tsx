"use client";

import { useT } from "@/i18n/client";
import { deleteSource } from "@/app/app/settings/alert-sources/actions";

/**
 * Deleting a source, under Advanced with the other gestures that change what
 * the source is rather than what it does. It is the one gesture here that
 * takes history with it — alerts cascade — so it asks first, and says how
 * many.
 */
export function DeleteSource({
  id,
  name,
  alertCount,
}: {
  id: string;
  name: string;
  alertCount: number;
}) {
  const t = useT();
  return (
    <form action={deleteSource} style={{ display: "contents" }}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        data-testid="source-delete"
        className="oi-hover-dang"
        onClick={(e) => {
          if (!window.confirm(t("alt2.source.deleteConfirm", { name, count: alertCount })))
            e.preventDefault();
        }}
        style={{
          height: 30,
          padding: "0 11px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          color: "var(--dang)",
        }}
      >
        {t("alt2.source.delete")}
      </button>
    </form>
  );
}
