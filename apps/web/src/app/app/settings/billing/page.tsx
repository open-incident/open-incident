import { notFound } from "next/navigation";
import { and, count, eq, gte } from "drizzle-orm";
import { isSelfHosted } from "@openincident/config";
import { incidents, statusPages, withTenant } from "@openincident/db";
import { getT, type Translate } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { entitlementsFor } from "@/lib/entitlements";
import {
  fetchInvoices,
  fetchOffers,
  fetchSubscription,
  gatewayConfigured,
} from "@/lib/control-plane";
import { goCheckout, goPortal, goRecheck } from "./actions";
import { occupiedSeats } from "./seats";
import { OfferPicker } from "./offer-picker";

const INVOICE_GRID = "150px minmax(160px,1fr) 130px 130px 90px";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 14,
  padding: 18,
  boxShadow: "var(--shadow-card)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const button = (tone: "primary" | "plain"): React.CSSProperties => ({
  height: 36,
  padding: "0 14px",
  borderRadius: 9,
  border: tone === "primary" ? 0 : "1px solid var(--line)",
  background: tone === "primary" ? "var(--brand)" : "var(--panel)",
  color: tone === "primary" ? "#fff" : "var(--ink)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

/** Usage row: label + value + 7 px gauge (orange above 85%). */
function QuotaRow({ label, value, pct }: { label: string; value: string; pct: number }) {
  const warn = pct > 85;
  return (
    <div className="flex flex-col" style={{ gap: 5 }}>
      <div className="flex justify-between" style={{ fontSize: 12.5 }}>
        <span style={{ color: "var(--ink-2)" }}>{label}</span>
        <span
          className="font-semibold tabular-nums"
          style={{ color: warn ? "var(--wait)" : "var(--ink)" }}
        >
          {value}
        </span>
      </div>
      <div
        className="overflow-hidden"
        style={{ height: 7, borderRadius: 4, background: "var(--sunk)" }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.max(0, pct))}%`,
            borderRadius: 4,
            background: warn ? "var(--wait)" : "var(--brand)",
          }}
        />
      </div>
    </div>
  );
}

function Notice({ tone, text }: { tone: "ok" | "dang" | "muted"; text: string }) {
  return (
    <p
      role="status"
      style={{
        margin: 0,
        fontSize: 13,
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid",
        background:
          tone === "ok" ? "var(--ok-t)" : tone === "dang" ? "var(--dang-t)" : "var(--sunk)",
        borderColor:
          tone === "ok" ? "var(--brand-b)" : tone === "dang" ? "var(--dang)" : "var(--line)",
        color: tone === "ok" ? "var(--ok)" : tone === "dang" ? "var(--dang)" : "var(--ink-2)",
      }}
    >
      {text}
    </p>
  );
}

function invoiceStatus(t: Translate, status: string): string {
  // The wording is ours; the state itself is the provider's, and an unknown
  // one is shown verbatim rather than mapped onto a reassuring label.
  if (status === "paid") return t("billing.invoicePaid");
  if (status === "open") return t("billing.invoiceOpen");
  if (status === "void" || status === "uncollectible") return t("billing.invoiceVoid");
  return status;
}

/**
 * Settings → Subscription & invoices (cloud edition): plan card, this month's
 * usage against the plan's ceilings, the public offers as the control plane
 * sells them, and the invoice history it mirrors from the payment provider.
 * Nothing here is invented by the product: without a control plane the screen
 * says so and offers nothing.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; error?: string; recheck?: string }>;
}) {
  // A self-hosted instance has no subscription to show: the screen does not exist.
  if (isSelfHosted()) notFound();
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { checkout, error, recheck } = await searchParams;
  const ent = entitlementsFor(tenant);
  const gateway = gatewayConfigured();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [seats, usage, subscription, offers, invoices] = await Promise.all([
    occupiedSeats(tenant.id),
    withTenant(tenant.id, async (tx) => {
      const [[inc], [pages]] = await Promise.all([
        tx
          .select({ n: count() })
          .from(incidents)
          .where(and(eq(incidents.tenantId, tenant.id), gte(incidents.createdAt, monthStart))),
        tx.select({ n: count() }).from(statusPages).where(eq(statusPages.tenantId, tenant.id)),
      ]);
      return { incidents: inc?.n ?? 0, statusPages: pages?.n ?? 0 };
    }),
    fetchSubscription(tenant.slug),
    fetchOffers(),
    fetchInvoices(tenant.slug),
  ]);

  const suspended = tenant.status === "suspended";
  const reason = subscription?.suspendedReason ?? tenant.suspendedReason;
  const subscribed = subscription?.seats != null;
  const seatPrice = (subscription?.seatPriceCents ?? 0) / 100;
  const monthly = seatPrice * (subscription?.seats ?? 0);

  // The screen is where the owner lands to act: it must SAY what just
  // happened (checkout return, gateway failure) and what state the workspace
  // is in (trial deadline, pause and its cause).
  const notice: { tone: "ok" | "dang" | "muted"; text: string } | null =
    checkout === "success"
      ? { tone: "ok", text: t("billing.checkoutSuccess") }
      : checkout === "cancelled"
        ? { tone: "muted", text: t("billing.checkoutCancelled") }
        : recheck === "ok"
          ? { tone: "ok", text: t("billing.recheckOk") }
          : recheck === "none"
            ? { tone: "dang", text: t("billing.recheckNoSubscription") }
            : error === "gateway"
              ? { tone: "dang", text: t("billing.gatewayError") }
              : error === "owner"
                ? { tone: "dang", text: t("billing.ownerOnly") }
                : !gateway
                  ? { tone: "muted", text: t("billing.unavailable") }
                  : suspended
                    ? {
                        tone: "dang",
                        text:
                          reason === "unpaid"
                            ? t("billing.suspendedUnpaid")
                            : t("billing.suspendedNoSubscription"),
                      }
                    : null;

  const label = subscription?.planName ?? tenant.planName;
  const seatLine =
    subscribed && subscription
      ? t("billing.seatPricing", {
          count: subscription.seats ?? 0,
          price: t.fmt.amount(seatPrice),
        })
      : tenant.status === "trial"
        ? t("billing.trialSeats")
        : t("billing.noSeats", { count: seats });
  const dueLine =
    tenant.status === "trial" && tenant.trialEndsAt
      ? t("billing.trialUntil", { date: t.fmt.dateLong(tenant.trialEndsAt) })
      : subscription?.dunningDeadline
        ? t("billing.dunningDeadline", {
            date: t.fmt.dateLong(new Date(subscription.dunningDeadline)),
          })
        : subscription?.currentPeriodEnd
          ? t(subscription.cancelAtPeriodEnd ? "billing.endsOn" : "billing.nextDue", {
              date: t.fmt.dateLong(new Date(subscription.currentPeriodEnd)),
            })
          : t("billing.noDue");
  const owner = member.role === "owner";
  const canAct = gateway && owner;
  const title = canAct
    ? undefined
    : gateway
      ? t("billing.ownerOnly")
      : t("billing.requiresControlPlane");

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 980 }}
    >
      <div>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("billing.title")}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink-2)", maxWidth: 720 }}>
          {t("billing.lead")}
        </p>
      </div>
      {notice && <Notice tone={notice.tone} text={notice.text} />}

      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}
      >
        {/* Plan card */}
        <div
          data-testid="billing-plan"
          style={{ ...card, borderColor: "var(--brand-b)", background: "var(--brand-t)" }}
        >
          <div className="flex items-baseline" style={{ gap: 9, flexWrap: "wrap" }}>
            <span
              className="font-bold"
              style={{ fontSize: 18, letterSpacing: "-0.02em", color: "var(--ink)" }}
            >
              {label ?? t("billing.subscriptionNone")}
            </span>
            {tenant.status === "trial" && (
              <span
                className="rounded-full font-bold"
                style={{
                  padding: "2px 9px",
                  fontSize: 11.5,
                  background: "var(--panel)",
                  color: "var(--brand)",
                }}
              >
                {t("billing.trialBadge")}
              </span>
            )}
            {subscription?.cancelAtPeriodEnd && (
              <span
                className="rounded-full font-bold"
                style={{
                  padding: "2px 9px",
                  fontSize: 11.5,
                  background: "var(--panel)",
                  color: "var(--wait)",
                }}
              >
                {t("billing.cancelScheduledBadge")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-baseline" style={{ gap: 6 }}>
            <span
              className="whitespace-nowrap font-bold tabular-nums"
              style={{ fontSize: 30, letterSpacing: "-0.03em", color: "var(--ink)" }}
            >
              {t("billing.priceMonthly", { amount: t.fmt.amount(monthly) })}
            </span>
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{seatLine}</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>{dueLine}</p>
          <div className="flex flex-wrap" style={{ gap: 8, marginTop: 2 }}>
            {subscribed ? (
              <form action={goPortal}>
                <button disabled={!canAct} title={title} style={button("primary")}>
                  {t("billing.manageSubscription")}
                </button>
              </form>
            ) : (
              <a
                href="#offers"
                style={{
                  ...button("primary"),
                  display: "grid",
                  placeItems: "center",
                  textDecoration: "none",
                }}
              >
                {t("billing.changeSubscription")}
              </a>
            )}
            {suspended && reason !== "unpaid" && (
              <form action={goRecheck}>
                <button disabled={!canAct} title={title} style={button("plain")}>
                  {t("billing.recheckCta")}
                </button>
              </form>
            )}
          </div>
        </div>
        {/* Usage */}
        <div style={card} data-testid="billing-usage">
          <p className="font-semibold" style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>
            {t("billing.usageTitle")}
          </p>
          <QuotaRow
            label={t("billing.quotaSeats")}
            value={ent.maxMembers != null ? `${seats} / ${ent.maxMembers}` : `${seats}`}
            pct={ent.maxMembers != null && ent.maxMembers > 0 ? (seats / ent.maxMembers) * 100 : 0}
          />
          <QuotaRow
            label={t("billing.quotaStatusPages")}
            value={
              ent.maxStatusPages != null
                ? `${usage.statusPages} / ${ent.maxStatusPages}`
                : `${usage.statusPages}`
            }
            pct={
              ent.maxStatusPages != null && ent.maxStatusPages > 0
                ? (usage.statusPages / ent.maxStatusPages) * 100
                : 0
            }
          />
          <QuotaRow
            label={t("billing.quotaIncidents")}
            value={t("billing.quotaIncidentsValue", { count: usage.incidents })}
            pct={0}
          />
        </div>
      </div>

      <div id="offers">
        <OfferPicker
          offers={offers}
          currentPlanId={subscription?.planId ?? null}
          subscribed={subscribed}
          occupiedSeats={seats}
          gatewayOk={canAct}
          checkout={goCheckout}
          portal={goPortal}
        />
      </div>

      {/* Invoice history */}
      <div className="flex flex-col" style={{ gap: 11 }}>
        <p className="font-semibold" style={{ margin: 0, fontSize: 14.5, color: "var(--ink)" }}>
          {t("billing.invoicesTitle")}
        </p>
        <div
          className="overflow-x-auto border"
          style={{ borderRadius: 12, background: "var(--panel)", borderColor: "var(--line)" }}
        >
          <div style={{ minWidth: 680 }}>
            <div
              className="grid items-center border-b"
              style={{
                gridTemplateColumns: INVOICE_GRID,
                height: 40,
                padding: "0 14px",
                background: "var(--canvas)",
                borderColor: "var(--line)",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: ".09em",
                color: "var(--ink-3)",
              }}
            >
              <span>{t("billing.colNumber")}</span>
              <span>{t("billing.colDate")}</span>
              <span className="text-right">{t("billing.colAmount")}</span>
              <span className="text-right">{t("billing.colStatus")}</span>
              <span />
            </div>
            {invoices.length === 0 ? (
              <p style={{ margin: 0, padding: "18px 14px", fontSize: 13, color: "var(--ink-2)" }}>
                {t("billing.invoicesEmpty")}
              </p>
            ) : (
              invoices.map((inv, i) => (
                <div
                  key={inv.number ?? String(i)}
                  className="grid items-center border-b"
                  style={{
                    gridTemplateColumns: INVOICE_GRID,
                    minHeight: 44,
                    padding: "0 14px",
                    borderColor: "var(--line-2)",
                    fontSize: 13,
                  }}
                >
                  <span className="font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                    {inv.number ?? "—"}
                  </span>
                  <span style={{ color: "var(--ink-2)" }}>
                    {inv.issuedAt ? t.fmt.dateLong(new Date(inv.issuedAt)) : "—"}
                  </span>
                  <span className="text-right tabular-nums" style={{ color: "var(--ink)" }}>
                    {t.fmt.amount(inv.amountCents / 100)} €
                  </span>
                  <span
                    className="text-right font-semibold"
                    style={{ color: inv.status === "paid" ? "var(--ok)" : "var(--wait)" }}
                  >
                    {invoiceStatus(t, inv.status)}
                  </span>
                  <span className="text-right">
                    {inv.pdfUrl && (
                      <a
                        href={inv.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="oi-link"
                        style={{ fontSize: 12.5 }}
                      >
                        {t("billing.invoicePdf")}
                      </a>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
