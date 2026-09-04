import type { Translate } from "./deps";

/** The honest state of an enterprise screen without its entitlement: nothing simulated. */
export function Unavailable({ t }: { t: Translate }) {
  return (
    <div
      data-testid="ee-unavailable"
      style={{
        padding: "18px 20px",
        border: "1.5px dashed var(--line)",
        borderRadius: 14,
        background: "var(--panel)",
        maxWidth: 560,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
        {t("ee.unavailable.title")}
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
        {t("ee.unavailable.body")}
      </div>
    </div>
  );
}
