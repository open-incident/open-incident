import { getT } from "@/i18n/server";

/** The visible label every assistant output carries — a draft, labelled as such. */
export async function AiBadge({ text }: { text?: string } = {}) {
  const t = await getT();
  return (
    <span
      style={{
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: ".08em",
        color: "var(--viol)",
        background: "var(--viol-t)",
        borderRadius: 6,
        padding: "1px 6px",
        flex: "none",
      }}
    >
      {text ?? t("ai.badge")}
    </span>
  );
}
