import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@openincident/db";
import { FAST_BURN, SLOW_BURN, hoursLeft } from "@openincident/telemetry";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { getSlo } from "@/lib/slos";
import { deleteSlo, toggleSloPause } from "../actions";
import type { MessageKey } from "@/i18n/dictionaries/en";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const EYEBROW: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--ink-3)",
};
const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };
const GHOST: React.CSSProperties = {
  height: 32,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  fontSize: 12.5,
  cursor: "pointer",
};

/**
 * One objective: what is left of its budget, how fast it is going, and the two
 * expressions it is computed from.
 *
 * The two burn rates are shown side by side with their thresholds, because the
 * question somebody has in front of this screen is "why did this page me" or
 * "why did it not", and both are answered by seeing which of the two numbers
 * crossed which line.
 */
export default async function SloPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  const found = await withTenant(tenant.id, (tx) => getSlo(tx, tenant.id, id));
  if (!found) notFound();
  const { slo, serviceKey } = found;
  const mayEdit = canRespond(member);

  const tone =
    slo.burnState === "fast"
      ? "var(--dang)"
      : slo.burnState === "slow"
        ? "var(--wait)"
        : "var(--ok)";
  const left = slo.lastBudgetLeft;
  const burn = slo.burnState === "fast" ? slo.lastFastBurn : slo.lastSlowBurn;
  const remaining = left !== null && burn !== null ? hoursLeft(left, burn, slo.windowDays) : null;

  return (
    <div
      className="oi-rise"
      style={{
        maxWidth: 1000,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <Link href="/app/telemetry?tab=slos" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
        ‹ {t("slo.title")}
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: tone }} data-testid="slo-state">
              {t(`slo.state.${slo.burnState}` as MessageKey)}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {serviceKey ? `${serviceKey} · ` : ""}
              {t("slo.objectiveOver", {
                objective: slo.objective,
                window:
                  slo.windowKind === "calendar"
                    ? t("slo.thisMonth")
                    : t("slo.nDays", { count: slo.windowDays }),
              })}
            </span>
          </div>
          <h1
            style={{
              margin: "4px 0 0",
              fontFamily: "var(--title)",
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            {slo.name}
          </h1>
          {slo.description && (
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-2)" }}>
              {slo.description}
            </p>
          )}
        </div>
        <span style={{ flex: 1 }} />
        {mayEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            <form action={toggleSloPause}>
              <input type="hidden" name="id" value={slo.id} />
              <button type="submit" className="oi-hover" style={GHOST}>
                {slo.paused ? t("monitors.resume") : t("monitors.pause")}
              </button>
            </form>
            <form action={deleteSlo}>
              <input type="hidden" name="id" value={slo.id} />
              <button
                type="submit"
                data-testid="slo-delete"
                className="oi-hover-dang"
                style={{ ...GHOST, color: "var(--dang)" }}
              >
                {t("monitors.delete")}
              </button>
            </form>
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 1,
          background: "var(--line)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {[
          {
            l: t("slo.kpiSli"),
            v: slo.lastSli === null ? "—" : `${Math.round(slo.lastSli * 1000) / 1000} %`,
            ink: "var(--ink)",
          },
          {
            // Past zero this stops being a remainder and becomes an overrun;
            // "−1465 %" is a number nobody reads as anything.
            l: left !== null && left < 0 ? t("slo.kpiOverrun") : t("slo.kpiBudget"),
            v:
              left === null
                ? "—"
                : left < 0
                  ? `${Math.round(-left * 10) / 10 + 1}×`
                  : `${Math.round(left * 1000) / 10} %`,
            ink: left !== null && left <= 0 ? "var(--dang)" : "var(--ink)",
          },
          {
            l: t("slo.kpiBurn"),
            v: burn === null ? "—" : `${Math.round(burn * 10) / 10}×`,
            ink: tone,
          },
          {
            // A dash here would be read as "we do not know". There are two
            // reasons this has no answer and they are opposite ones: the
            // budget is gone, or nothing is burning.
            l: t("slo.kpiLeft"),
            v:
              remaining !== null
                ? formatHours(remaining)
                : left !== null && left <= 0
                  ? t("slo.alreadySpent")
                  : left === null
                    ? "—"
                    : t("slo.notBurning"),
            ink: left !== null && left <= 0 ? "var(--dang)" : "var(--ink)",
          },
        ].map((k) => (
          <div key={k.l} style={{ background: "var(--panel)", padding: "12px 14px" }}>
            <div style={EYEBROW}>{k.l}</div>
            <div
              style={{
                fontSize: k.v.length > 8 ? 14 : 19,
                fontWeight: 600,
                color: k.ink,
                marginTop: 3,
              }}
            >
              {k.v}
            </div>
          </div>
        ))}
      </div>

      {slo.lastDetail && (
        <div style={{ ...CARD, gap: 6 }}>
          <div style={EYEBROW}>{t("slo.reading")}</div>
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>{slo.lastDetail}</div>
          {slo.lastEvaluatedAt && (
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {t("slo.readAt", { when: t.fmt.dateTime(slo.lastEvaluatedAt, t.timeZone) })}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {(
          [
            ["fast", slo.lastFastBurn, FAST_BURN, 60, 5],
            ["slow", slo.lastSlowBurn, SLOW_BURN, 360, 30],
          ] as const
        ).map(([kind, value, threshold, long, short]) => (
          <div key={kind} style={CARD}>
            <div style={EYEBROW}>{t(`slo.burn.${kind}` as MessageKey)}</div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                color:
                  value !== null && value >= threshold
                    ? kind === "fast"
                      ? "var(--dang)"
                      : "var(--wait)"
                    : "var(--ink)",
              }}
            >
              {value === null ? "—" : `${Math.round(value * 10) / 10}×`}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {t("slo.burnExplain", { threshold, long: minutes(long), short: minutes(short) })}
            </div>
          </div>
        ))}
      </div>

      <div style={CARD}>
        <div style={EYEBROW}>{t("slo.indicator")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("slo.fieldGood")}</div>
            <div style={{ ...MONO, wordBreak: "break-word" }}>{slo.goodQuery}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("slo.fieldTotal")}</div>
            <div style={{ ...MONO, wordBreak: "break-word" }}>{slo.totalQuery}</div>
          </div>
        </div>
        <Link
          href={`/app/telemetry?tab=sql`}
          style={{ fontSize: 11.5, color: "var(--brand)", textDecoration: "none" }}
        >
          {t("slo.openConsole")}
        </Link>
      </div>
    </div>
  );
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

function minutes(m: number): string {
  return m >= 60 ? `${m / 60} h` : `${m} min`;
}
