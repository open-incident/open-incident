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
import {
  ListCard,
  ListItem,
  Note,
  SettingsPage,
  Stats,
  itemButtonStyle,
  pageActionStyle,
} from "@/components/settings/template";

function invoiceStatus(t: Translate, status: string): string {
  // The wording is ours; the state itself is the provider's, and an unknown
  // one is shown verbatim rather than mapped onto a reassuring label.
  if (status === "paid") return t("billing.invoicePaid");
  if (status === "open") return t("billing.invoiceOpen");
  if (status === "void" || status === "uncollectible") return t("billing.invoiceVoid");
  return status;
}

/**
 * Settings › Subscription (cloud edition, design V2): the plan, the seats,
 * the next invoice as figures; this month's usage against the plan's
 * ceilings; the public offers while there is no subscription; the invoice
 * history the control plane mirrors from the payment provider.
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

  const interval =
    subscription?.interval === "year"
      ? t("settingsV2.billing.yearly")
      : subscription?.interval === "month"
        ? t("settingsV2.billing.monthly")
        : undefined;
  const region = process.env.OI_DATA_REGION?.trim();

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.workspace")}
      title={t("settingsV2.entry.billing")}
      lead={t("settingsV2.billing.lead")}
      testId="settings-billing"
      actions={
        subscribed ? (
          <form action={goPortal}>
            <button
              type="submit"
              disabled={!canAct}
              title={title}
              className="oi-hover"
              style={pageActionStyle()}
            >
              {t("settingsV2.billing.console")}
            </button>
          </form>
        ) : undefined
      }
    >
      {notice && (
        <Note tone={notice.tone === "ok" ? "ok" : notice.tone === "dang" ? "dang" : undefined}>
          {notice.text}
        </Note>
      )}
      <Stats
        testId="billing-plan"
        items={[
          {
            label: t("settingsV2.billing.plan"),
            value: label ?? t("billing.subscriptionNone"),
            sub:
              tenant.status === "trial" && tenant.trialEndsAt
                ? t("settingsV2.billing.trial", { date: t.fmt.dateLong(tenant.trialEndsAt) })
                : interval,
          },
          {
            label: t("settingsV2.billing.seats"),
            value:
              subscription?.seats != null
                ? t("settingsV2.billing.seatsOf", { used: seats, total: subscription.seats })
                : ent.maxMembers != null
                  ? t("settingsV2.billing.seatsOf", { used: seats, total: ent.maxMembers })
                  : String(seats),
            sub: t("settingsV2.billing.seatsSub"),
          },
          {
            label: t("settingsV2.billing.next"),
            value: subscription?.currentPeriodEnd
              ? t.fmt.dateShort(new Date(subscription.currentPeriodEnd))
              : t("settingsV2.billing.none"),
            sub: subscribed
              ? t("settingsV2.billing.nextSub", { amount: t.fmt.amount(monthly) })
              : dueLine,
          },
          ...(region ? [{ label: t("settingsV2.billing.region"), value: region }] : []),
        ]}
      />
      <Stats
        testId="billing-usage"
        items={[
          {
            label: t("billing.quotaStatusPages"),
            value:
              ent.maxStatusPages != null
                ? `${usage.statusPages} / ${ent.maxStatusPages}`
                : `${usage.statusPages}`,
          },
          {
            label: t("billing.quotaIncidents"),
            value: t("billing.quotaIncidentsValue", { count: usage.incidents }),
          },
        ]}
      />
      {suspended && reason !== "unpaid" && (
        <form action={goRecheck}>
          <button type="submit" disabled={!canAct} title={title} style={pageActionStyle()}>
            {t("billing.recheckCta")}
          </button>
        </form>
      )}

      {!subscribed && (
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
      )}

      <ListCard title={t("settingsV2.billing.invoices")} testId="billing-invoices">
        {invoices.length === 0 ? (
          <ListItem title={t("settingsV2.billing.invoicesEmpty")} titleWeight={500} />
        ) : (
          invoices.map((inv, i) => (
            <ListItem
              key={inv.number ?? String(i)}
              title={
                inv.issuedAt
                  ? new Date(inv.issuedAt).toLocaleDateString(t.locale.tag, {
                      month: "long",
                      year: "numeric",
                    })
                  : (inv.number ?? "—")
              }
              sub={t("settingsV2.billing.invoiceSub", {
                amount: t.fmt.amount(inv.amountCents / 100),
                number: inv.number ?? "—",
              })}
              chips={[
                {
                  label: invoiceStatus(t, inv.status),
                  tone: inv.status === "paid" ? "ok" : "wait",
                },
              ]}
              button={
                inv.pdfUrl ? (
                  <a
                    href={inv.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="oi-hover"
                    style={itemButtonStyle()}
                  >
                    {t("billing.invoicePdf")}
                  </a>
                ) : undefined
              }
            />
          ))
        )}
      </ListCard>
    </SettingsPage>
  );
}
