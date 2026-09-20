import { exceptionGroups, withTenant, type ExceptionGroupStatus } from "@openincident/db";
import { and, eq } from "drizzle-orm";
import { getT } from "@/i18n/server";
import { setExceptionStatus } from "./actions";
import type { MessageKey } from "@/i18n/dictionaries/en";

const BUTTON: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12,
  cursor: "pointer",
};

/**
 * What a workspace has decided about this bug, and how to change it.
 *
 * These three states are not decoration: they are the escape hatch for the
 * regression alerts. A workspace with a noisy dependency has to be able to
 * make that one group quiet without switching off the feature that tells it
 * when something new breaks — so `ignored` and `snoozed` exist, and they must
 * be reachable, or the only way out is the global switch.
 *
 * `resolved` is the other direction: it is a claim that the bug is fixed, and
 * the value of making it is that the group coming back afterwards is then
 * *news* rather than one more line in a list.
 */
export async function ExceptionActions({
  tenantId,
  fingerprint,
  mayEdit,
}: {
  tenantId: string;
  fingerprint: string;
  mayEdit: boolean;
}) {
  const t = await getT();
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(exceptionGroups)
      .where(
        and(eq(exceptionGroups.tenantId, tenantId), eq(exceptionGroups.fingerprint, fingerprint)),
      ),
  );
  const status: ExceptionGroupStatus = row?.status ?? "open";
  const snoozeOver = row?.snoozedUntil && row.snoozedUntil <= new Date();
  const shown: ExceptionGroupStatus = status === "snoozed" && snoozeOver ? "open" : status;

  const tone =
    shown === "resolved"
      ? "var(--ok)"
      : shown === "ignored"
        ? "var(--ink-3)"
        : shown === "snoozed"
          ? "var(--wait)"
          : "var(--dang)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--line-2)",
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: tone }} data-testid="exception-status">
        {t(`exceptions.status.${shown}` as MessageKey)}
      </span>
      {shown === "snoozed" && row?.snoozedUntil && (
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {t("exceptions.snoozedUntil", { when: row.snoozedUntil.toISOString().slice(0, 16) })}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {mayEdit &&
        (
          [
            ["open", "exceptions.reopen"],
            ["resolved", "exceptions.resolve"],
            ["snoozed", "exceptions.snooze"],
            ["ignored", "exceptions.ignore"],
          ] as const
        )
          .filter(([next]) => next !== shown)
          .map(([next, label]) => (
            <form key={next} action={setExceptionStatus}>
              <input type="hidden" name="fingerprint" value={fingerprint} />
              <input type="hidden" name="status" value={next} />
              <button type="submit" className="oi-hover" style={BUTTON}>
                {t(label)}
              </button>
            </form>
          ))}
    </div>
  );
}
