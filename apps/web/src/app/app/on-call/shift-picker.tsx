import Link from "next/link";
import { getT } from "@/i18n/server";
import { avatarTone, initials } from "@/lib/avatar";
import { createOverride, deleteOverride } from "./actions";

/**
 * The band under the week grid: one cell is selected, and one click hands that
 * shift to somebody else.
 *
 * It writes an override on the shift's own bounds — not on the day, not on the
 * rotation: the turn order is untouched, and the change is one row anybody can
 * read back or remove.
 */
export async function ShiftPicker({
  scheduleId,
  rotationId,
  startAt,
  endAt,
  overrideId,
  candidates,
  label,
}: {
  scheduleId: string;
  rotationId: string;
  startAt: string;
  endAt: string;
  overrideId: string | null;
  candidates: Array<{ id: string; name: string }>;
  label: string;
}) {
  const t = await getT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        data-testid="reassign"
        className="oi-rise-fast"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          border: "1px solid var(--brand-b)",
          background: "var(--brand-t)",
          borderRadius: 12,
          padding: "10px 14px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("oc2.now.whoTakes", { label })}</span>
        {candidates.map((m) => {
          const tone = avatarTone(m.name);
          return (
            <form key={m.id} action={createOverride}>
              <input type="hidden" name="scheduleId" value={scheduleId} />
              <input type="hidden" name="rotationId" value={rotationId} />
              <input type="hidden" name="memberId" value={m.id} />
              <input type="hidden" name="startAt" value={startAt} />
              <input type="hidden" name="endAt" value={endAt} />
              <input type="hidden" name="reason" value="override" />
              <button
                type="submit"
                data-testid="reassign-to"
                className="oi-hover-edge"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  padding: "4px 11px 4px 5px",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: tone.bg,
                    color: tone.ink,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 8,
                    fontWeight: 700,
                  }}
                >
                  {initials(m.name)}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {m.name.split(" ")[0] ?? m.name}
                </span>
              </button>
            </form>
          );
        })}
        <span style={{ flex: 1 }} />
        {overrideId && (
          <form action={deleteOverride}>
            <input type="hidden" name="id" value={overrideId} />
            <button
              type="submit"
              data-testid="override-remove"
              style={{
                border: 0,
                background: "transparent",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--dang)",
                cursor: "pointer",
              }}
            >
              {t("oc2.now.removeOverride")}
            </button>
          </form>
        )}
        <Link
          href="/app/on-call?tab=now"
          aria-label={t("common.close")}
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-3)",
            textDecoration: "none",
          }}
        >
          ✕
        </Link>
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("oc2.now.overrideNote")}</div>
    </div>
  );
}
