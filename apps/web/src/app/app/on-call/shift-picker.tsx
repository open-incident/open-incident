import Link from "next/link";
import { getT } from "@/i18n/server";
import { avatarTone, initials } from "@/lib/avatar";
import { createOverride, deleteOverride } from "./actions";

/**
 * The band under the grid: one cell is selected, and one click hands that
 * shift to somebody else.
 *
 * It writes an override on the slot's own bounds — the rotation's window on
 * that date, from now on when the slot is under way — not on the whole turn a
 * weekly rotation would span: the turn order is untouched, and the change is
 * one row anybody can read back or remove from this same band.
 */
export async function ShiftPicker({
  scheduleId,
  rotationId,
  startAt,
  endAt,
  overrides,
  candidates,
  label,
  closeHref,
  returnTo,
  ended,
}: {
  scheduleId: string;
  rotationId: string;
  startAt: string;
  endAt: string;
  /** The overrides touching the slot; `partial` when one covers only part of it. */
  overrides: Array<{ id: string; partial: boolean; from: string; to: string }>;
  candidates: Array<{ id: string; name: string }>;
  label: string;
  closeHref: string;
  returnTo: string;
  /** The slot is over: it can be read, not handed over any more. */
  ended: boolean;
}) {
  const t = await getT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        data-testid="reassign"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          border: "1px solid var(--brand-b)",
          background: "var(--brand-t)",
          borderRadius: 12,
          padding: "10px 14px",
          flexWrap: "wrap",
          animation: "oi-rise .15s ease backwards",
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("oc2.now.whoTakes", { label })}</span>
        {!ended &&
          candidates.map((m) => {
            const tone = avatarTone(m.name);
            return (
              <form key={m.id} action={createOverride}>
                <input type="hidden" name="scheduleId" value={scheduleId} />
                <input type="hidden" name="rotationId" value={rotationId} />
                <input type="hidden" name="memberId" value={m.id} />
                <input type="hidden" name="startAt" value={startAt} />
                <input type="hidden" name="endAt" value={endAt} />
                <input type="hidden" name="reason" value="override" />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button
                  type="submit"
                  data-testid="reassign-to"
                  className="oi-hover-chip"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    borderRadius: 999,
                    padding: "4px 11px 4px 5px",
                    cursor: "pointer",
                    color: "var(--ink)",
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
        {overrides.map((o) => (
          <form key={o.id} action={deleteOverride}>
            <input type="hidden" name="id" value={o.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
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
                padding: 0,
              }}
            >
              {o.partial
                ? t("ocv2.now.removePartial", { from: o.from, to: o.to })
                : t("oc2.now.removeOverride")}
            </button>
          </form>
        ))}
        <Link
          href={closeHref}
          scroll={false}
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
      <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
        {ended ? t("ocv2.now.slotEnded") : t("oc2.now.overrideNote")}
      </div>
    </div>
  );
}
