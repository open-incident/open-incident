"use client";

import { useT } from "@/i18n/client";
import { atlasReview } from "./actions";
import { useAtlasCommand } from "./toast";

const base: React.CSSProperties = {
  height: 30,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  color: "var(--ink)",
};

/** Looks right (On target) · Not quite (Miss) · Reopen — the three verdicts of a card. */
export function ReviewActions({
  investigationId,
  number,
}: {
  investigationId: string;
  number: number;
}) {
  const t = useT();
  const { run, pending, toast } = useAtlasCommand();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        data-testid="atlas-review-reopen"
        className="oi-hover-dang"
        onClick={() => run(() => atlasReview(investigationId, "reopen", number))}
        style={{ ...base, color: "var(--dang)" }}
      >
        {t("atlas.ui.review.reopen")}
      </button>
      <button
        type="button"
        disabled={pending}
        data-testid="atlas-review-miss"
        className="oi-hover"
        onClick={() => run(() => atlasReview(investigationId, "miss", number))}
        style={base}
      >
        {t("atlas.ui.review.miss")}
      </button>
      <button
        type="button"
        disabled={pending}
        data-testid="atlas-review-ok"
        className="oi-hover-brand-2"
        onClick={() => run(() => atlasReview(investigationId, "ok", number))}
        style={{
          ...base,
          padding: "0 13px",
          border: 0,
          background: "var(--brand)",
          color: "#fff",
        }}
      >
        {t("atlas.ui.review.ok")}
      </button>
      {toast}
    </>
  );
}
