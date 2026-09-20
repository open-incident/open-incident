import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { listServices } from "@/lib/services";
import { listSlos, type SloRow } from "@/lib/slos";
import { NewSlo } from "../slos/new-slo";
import type { MessageKey } from "@/i18n/dictionaries/en";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

/**
 * Service level objectives, as a tab of Telemetry rather than a page of its
 * own.
 *
 * They belong here because an objective is a ratio of two PromQL expressions
 * over the metrics next door: it is read beside the signals that measure it,
 * and a separate entry in the main navigation was one nobody visited until
 * something was already burning. It is also the honest grouping — without the
 * telemetry module there are no objectives to have, which the old page said in
 * a banner and this one says by not existing.
 *
 * Listed by how much budget is left, not by name and not by whether they are
 * alerting: the one with the least is what the next conversation is about,
 * whether or not it has woken anybody yet.
 */
export async function SlosTab({
  tenantId,
  mayEdit,
  error,
  why,
  openNew,
}: {
  tenantId: string;
  mayEdit: boolean;
  error?: string;
  why?: string;
  openNew?: boolean;
}) {
  const t = await getT();
  const data = await withTenant(tenantId, async (tx) => ({
    rows: await listSlos(tx, tenantId),
    services: await listServices(tx, tenantId),
  }));
  // An SLO that has never been read has no budget to sort on and goes last:
  // there is nothing to say about it yet.
  const rows = [...data.rows].sort(
    (a, b) => (a.lastBudgetLeft ?? Infinity) - (b.lastBudgetLeft ?? Infinity),
  );

  return (
    <div data-testid="slo-tab" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)", flex: 1 }}>{t("slo.tabHint")}</span>
        {mayEdit && <NewSlo services={data.services.map((s) => s.key)} initialOpen={!!openNew} />}
      </div>

      {error && (
        <div
          role="alert"
          data-testid="slo-error"
          style={{
            ...CARD,
            padding: "11px 14px",
            borderColor: "var(--dang)",
            background: "var(--dang-t)",
            color: "var(--dang)",
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          {error === "query" ? t("slo.errorQuery", { why: why ?? "" }) : t("slo.errorInvalid")}
        </div>
      )}

      {rows.length === 0 ? (
        <div
          style={{
            ...CARD,
            padding: "30px 22px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t("slo.emptyTitle")}</span>
          <span
            style={{
              fontSize: 12.5,
              color: "var(--ink-2)",
              lineHeight: 1.6,
              maxWidth: 560,
              margin: "0 auto",
            }}
          >
            {t("slo.emptyBody")}
          </span>
        </div>
      ) : (
        <div style={{ ...CARD, overflow: "hidden" }}>
          {rows.map((row, i) => (
            <SloLine key={row.id} row={row} first={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

async function SloLine({ row, first }: { row: SloRow; first: boolean }) {
  const t = await getT();
  const tone =
    row.burnState === "fast"
      ? "var(--dang)"
      : row.burnState === "slow"
        ? "var(--wait)"
        : row.lastBudgetLeft === null
          ? "var(--ink-3)"
          : "var(--ok)";
  const left = row.lastBudgetLeft;
  // Two different facts, so two different colours: the bar is how much budget
  // is left, the state on the right is how fast it is going. An objective can
  // be out of budget for the month and burning nothing at all today, and a
  // green bar beside "out of budget" is the reading nobody trusts twice.
  const budgetTone =
    left === null
      ? "var(--ink-3)"
      : left < 0
        ? "var(--dang)"
        : left < 0.25
          ? "var(--wait)"
          : "var(--ok)";
  // Clamped for the bar only — the figure beside it keeps the real value,
  // because "−40 %" is the number somebody needs to see.
  const bar = left === null ? 0 : Math.max(0, Math.min(1, left));

  return (
    <Link
      href={`/app/slos/${row.id}`}
      data-testid="slo-row"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 150px 160px",
        gap: 14,
        alignItems: "center",
        padding: "12px 16px",
        borderTop: first ? "none" : "1px solid var(--line-2)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>
          {row.name}
          {row.paused && (
            <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ink-3)", fontWeight: 400 }}>
              {t("slo.paused")}
            </span>
          )}
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
          {row.serviceKey ? `${row.serviceKey} · ` : ""}
          {t("slo.objectiveOver", {
            objective: row.objective,
            window:
              row.windowKind === "calendar"
                ? t("slo.thisMonth")
                : t("slo.nDays", { count: row.windowDays }),
          })}
        </span>
      </span>

      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ height: 6, borderRadius: 3, background: "var(--sunk)", overflow: "hidden" }}>
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${bar * 100}%`,
              background: budgetTone,
            }}
          />
        </span>
        <span
          style={{ fontSize: 11, color: left !== null && left < 0 ? budgetTone : "var(--ink-3)" }}
        >
          {left === null
            ? t("slo.notRead")
            : left < 0
              ? t("slo.budgetOver", { times: Math.round(-left * 10) / 10 + 1 })
              : t("slo.budgetLeft", { pct: Math.round(left * 1000) / 10 })}
        </span>
      </span>

      <span style={{ textAlign: "right" }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: tone }}>
          {t(`slo.state.${row.burnState}` as MessageKey)}
        </span>
        <span style={{ display: "block", fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
          {row.lastSli === null ? "—" : `${Math.round(row.lastSli * 1000) / 1000} %`}
        </span>
      </span>
    </Link>
  );
}
