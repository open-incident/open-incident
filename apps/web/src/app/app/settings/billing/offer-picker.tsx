"use client";
/**
 * Offer comparator: the public plans exactly as the control plane sells them
 * (names, prices, capabilities all come from the gateway; the product only
 * lays them out). Monthly/yearly toggle, seat stepper, total recomputed on the
 * client — checkout itself stays a server action.
 */
import { useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import type { Offer } from "@/lib/control-plane";

type Props = {
  offers: Offer[];
  /** Plan id of the workspace today, as the control plane names it. */
  currentPlanId: string | null;
  /** An active subscription changes plans in the portal, not through checkout. */
  subscribed: boolean;
  occupiedSeats: number;
  gatewayOk: boolean;
  checkout: (formData: FormData) => Promise<void>;
  portal: () => Promise<void>;
};

type OfferEntitlements = {
  maxMembers?: number | null;
  maxStatusPages?: number | null;
  aiAssist?: boolean;
  aiInvestigations?: boolean;
  sso?: boolean;
  customRoles?: boolean;
  auditLogAdvanced?: boolean;
  customerStatusPages?: boolean;
  customDomains?: boolean;
};

/** Rounded to the cent, in euros — fmt.amount puts the locale's separator. */
function euros(cents: number): number {
  return Math.round(cents) / 100;
}

function FeatureLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-baseline" style={{ gap: 7, fontSize: 12.5 }}>
      <span
        aria-hidden
        className="font-bold"
        style={{ color: ok ? "var(--brand)" : "var(--ink-3)", width: 12 }}
      >
        {ok ? "✓" : "—"}
      </span>
      <span style={{ color: ok ? "var(--ink-2)" : "var(--ink-3)" }}>{label}</span>
    </li>
  );
}

export function OfferPicker({
  offers,
  currentPlanId,
  subscribed,
  occupiedSeats,
  gatewayOk,
  checkout,
  portal,
}: Props) {
  const t = useT();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [seats, setSeats] = useState(() => Math.max(1, occupiedSeats));
  // The yearly discount is derived from the prices, never hard-coded: the
  // control plane may change its mind and this label must follow.
  const savePct = useMemo(() => {
    const paid = offers.find((o) => o.monthlyPriceCents > 0);
    if (!paid) return 0;
    return Math.round((1 - paid.yearlyPriceCents / (paid.monthlyPriceCents * 12)) * 100);
  }, [offers]);
  if (offers.length === 0) return null;

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div className="flex flex-wrap items-center justify-between" style={{ gap: 10 }}>
        <p className="font-semibold" style={{ fontSize: 14.5, color: "var(--ink)", margin: 0 }}>
          {t("billing.offersTitle")}
        </p>
        <div
          className="flex items-center border"
          style={{
            borderRadius: 8,
            padding: 3,
            gap: 2,
            background: "var(--sunk)",
            borderColor: "var(--line)",
          }}
        >
          {(["month", "year"] as const).map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              className="font-semibold"
              style={{
                height: 26,
                padding: "0 12px",
                borderRadius: 6,
                fontSize: 12.5,
                background: interval === iv ? "var(--panel)" : "transparent",
                color: interval === iv ? "var(--ink)" : "var(--ink-2)",
                boxShadow: interval === iv ? "0 1px 2px rgba(0,0,0,0.08)" : undefined,
              }}
            >
              {iv === "month" ? t("billing.offersMonthly") : t("billing.offersYearly")}
              {iv === "year" && savePct > 0 && (
                <span style={{ marginLeft: 5, color: "var(--brand)" }}>
                  {t("billing.offersYearlySave", { percent: savePct })}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}
      >
        {offers.map((offer) => {
          const ent = offer.entitlements as OfferEntitlements;
          const paid = offer.monthlyPriceCents > 0;
          const current = offer.id === currentPlanId;
          // Every seat is billed at the unit price: no allowance, no tier.
          const billable = paid ? Math.max(seats, offer.includedSeats) : 0;
          const perSeatCents =
            interval === "year" ? offer.yearlyPriceCents / 12 : offer.monthlyPriceCents;
          const totalMonthlyCents = billable * perSeatCents;
          return (
            <div
              key={offer.id}
              className="flex flex-col border"
              style={{
                borderRadius: 14,
                padding: 18,
                gap: 12,
                borderColor: current ? "var(--brand-b)" : "var(--line)",
                background: current ? "var(--brand-t)" : "var(--panel)",
              }}
            >
              <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
                <span className="font-bold" style={{ fontSize: 16, color: "var(--ink)" }}>
                  {offer.name}
                </span>
                {current && (
                  <span
                    className="rounded-full font-bold"
                    style={{
                      padding: "2px 9px",
                      fontSize: 11,
                      background: "var(--panel)",
                      color: "var(--brand)",
                    }}
                  >
                    {t("billing.offersCurrentPlan")}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-baseline" style={{ gap: 6 }}>
                <span
                  className="whitespace-nowrap font-bold tabular-nums"
                  style={{ fontSize: 26, letterSpacing: "-0.03em", color: "var(--ink)" }}
                >
                  {t("billing.priceMonthly", { amount: t.fmt.amount(euros(totalMonthlyCents)) })}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                  {paid && interval === "year"
                    ? t("billing.offersPerMonthYearly")
                    : t("billing.offersPerMonth")}
                </span>
              </div>
              {paid && (
                <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: 0 }}>
                  {t("billing.offersSeatsRule", { price: t.fmt.amount(euros(perSeatCents)) })}
                </p>
              )}
              {paid && (
                <div className="flex items-center" style={{ gap: 9 }}>
                  <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                    {t("billing.offersSeats")}
                  </span>
                  <div
                    className="flex items-center border"
                    style={{
                      borderRadius: 7,
                      borderColor: "var(--line)",
                      background: "var(--panel)",
                    }}
                  >
                    <button
                      type="button"
                      aria-label={t("billing.offersSeatsFewer")}
                      onClick={() => setSeats((s) => Math.max(Math.max(1, occupiedSeats), s - 1))}
                      className="grid place-items-center font-bold"
                      style={{ width: 28, height: 28, fontSize: 15, color: "var(--ink-2)" }}
                    >
                      −
                    </button>
                    <span
                      className="text-center font-bold tabular-nums"
                      style={{ minWidth: 34, fontSize: 13.5, color: "var(--ink)" }}
                    >
                      {t.fmt.number(seats)}
                    </span>
                    <button
                      type="button"
                      aria-label={t("billing.offersSeatsMore")}
                      onClick={() => setSeats((s) => Math.min(500, s + 1))}
                      className="grid place-items-center font-bold"
                      style={{ width: 28, height: 28, fontSize: 15, color: "var(--ink-2)" }}
                    >
                      +
                    </button>
                  </div>
                  {occupiedSeats > 0 && (
                    <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                      {t("billing.offersSeatsOccupied", { count: occupiedSeats })}
                    </span>
                  )}
                </div>
              )}
              <ul
                className="flex flex-col"
                style={{ gap: 6, marginTop: 2, padding: 0, listStyle: "none" }}
              >
                <FeatureLine
                  ok
                  label={
                    ent.maxMembers != null
                      ? t("billing.offersFeatMembers", { count: ent.maxMembers })
                      : t("billing.offersFeatMembersUnlimited")
                  }
                />
                <FeatureLine
                  ok
                  label={
                    ent.maxStatusPages != null
                      ? t("billing.offersFeatStatusPages", { count: ent.maxStatusPages })
                      : t("billing.offersFeatStatusPagesUnlimited")
                  }
                />
                <FeatureLine ok label={t("billing.offersFeatOnCall")} />
                <FeatureLine ok={Boolean(ent.aiAssist)} label={t("billing.offersFeatAiAssist")} />
                <FeatureLine
                  ok={Boolean(ent.aiInvestigations)}
                  label={t("billing.offersFeatAiInvestigations")}
                />
                <FeatureLine
                  ok={Boolean(ent.customDomains)}
                  label={t("billing.offersFeatCustomDomains")}
                />
                <FeatureLine ok={Boolean(ent.sso)} label={t("billing.offersFeatSso")} />
                <FeatureLine
                  ok={Boolean(ent.customRoles)}
                  label={t("billing.offersFeatCustomRoles")}
                />
                <FeatureLine
                  ok={Boolean(ent.auditLogAdvanced)}
                  label={t("billing.offersFeatAudit")}
                />
                <FeatureLine
                  ok={Boolean(ent.customerStatusPages)}
                  label={t("billing.offersFeatCustomerPages")}
                />
              </ul>
              {paid &&
                (subscribed ? (
                  /* An active subscription is edited in the customer portal —
                     a second checkout would stack a second subscription. */
                  <form action={portal} style={{ marginTop: "auto" }}>
                    <button
                      disabled={!gatewayOk}
                      className="grid w-full place-items-center border font-semibold disabled:opacity-50"
                      style={{
                        height: 34,
                        borderRadius: 9,
                        fontSize: 13,
                        borderColor: "var(--brand-b)",
                        background: "var(--panel)",
                        color: "var(--ink-2)",
                      }}
                    >
                      {t("billing.offersManageInPortal")}
                    </button>
                  </form>
                ) : (
                  <form action={checkout} style={{ marginTop: "auto" }}>
                    <input type="hidden" name="planId" value={offer.id} />
                    <input type="hidden" name="interval" value={interval} />
                    <input type="hidden" name="seats" value={seats} />
                    <button
                      disabled={!gatewayOk}
                      className="grid w-full place-items-center font-semibold disabled:opacity-50"
                      style={{
                        color: "#fff",
                        height: 34,
                        borderRadius: 9,
                        fontSize: 13,
                        background: "var(--brand)",
                      }}
                    >
                      {t("billing.offersChoose", { plan: offer.name })}
                    </button>
                  </form>
                ))}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: 0 }}>
        {t("billing.offersEnterprise")}
      </p>
    </div>
  );
}
