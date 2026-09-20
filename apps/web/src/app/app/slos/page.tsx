import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { listServices } from "@/lib/services";
import { listSlos, type SloRow } from "@/lib/slos";
import { telemetryInstalled } from "@/lib/telemetry";
import { NewSlo } from "./new-slo";
import type { MessageKey } from "@/i18n/dictionaries/en";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

/**
 * Service level objectives, listed by how much of their budget is left.
 *
 * Not by name, and not by whether they are alerting. The budget is the thing
 * a person is here to see, and the one with the least of it is the one the
 * next conversation is about — whether or not it is burning fast enough to
 * have woken anybody.
 */
export default async function SlosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; why?: string; new?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const mayEdit = canRespond(member);

  const data = await withTenant(tenant.id, async (tx) => ({
    rows: await listSlos(tx, tenant.id),
    services: await listServices(tx, tenant.id),
  }));
  // Least budget first; an SLO that has never been read has no budget to sort
  // on and goes last, because there is nothing to say about it yet.
  const rows = [...data.rows].sort(
    (a, b) => (a.lastBudgetLeft ?? Infinity) - (b.lastBudgetLeft ?? Infinity),
  );

  return (
    <div
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("slo.title")}
        </h1>
        <span style={{ flex: 1 }} />
        {mayEdit && telemetryInstalled() && (
          <NewSlo services={data.services.map((s) => s.key)} initialOpen={!!q.new} />
        )}
      </div>

      {!telemetryInstalled() && (
        <div
          style={{
            ...CARD,
            padding: "12px 14px",
            borderColor: "var(--wait)",
            background: "var(--wait-t)",
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          {t("slo.noTelemetry")}
        </div>
      )}

      {q.error && (
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
          {q.error === "query" ? t("slo.errorQuery", { why: q.why ?? "" }) : t("slo.errorInvalid")}
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
  // Clamped for the bar only — the figure beside it keeps the real value,
  // because "−40 %" is the number somebody needs to see.
  const bar = left === null ? 0 : Math.max(0, Math.min(1, left));

  return (
    <Link
      href={`/app/slos/${row.id}`}
      data-testid="slo-row"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 150px 120px",
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
            style={{ display: "block", height: "100%", width: `${bar * 100}%`, background: tone }}
          />
        </span>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
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
