"use server";

/**
 * Settings → Subscription & invoices. The product knows neither plan nor
 * payment provider: it asks its control plane for a session URL and redirects
 * to it. Changing the subscription is an owner's act.
 */
import { redirect } from "next/navigation";
import { isSelfHosted } from "@openincident/config";
import { requireManager } from "@/lib/session";
import { checkoutUrl, portalUrl, recheckSuspension } from "@/lib/control-plane";
import { occupiedSeats } from "./seats";

async function requireOwner() {
  if (isSelfHosted()) redirect("/app/settings");
  const current = await requireManager();
  if (current.member.role !== "owner") redirect("/app/settings/billing?error=owner");
  return current;
}

/**
 * Offer picker: subscription session for the chosen plan, interval and seat
 * count. Never fewer seats than are occupied: the checkout would succeed and
 * the workspace would be over its own subscription on arrival.
 */
export async function goCheckout(formData?: FormData) {
  const { tenant } = await requireOwner();
  const planId = formData?.get("planId")?.toString() || undefined;
  const rawInterval = formData?.get("interval")?.toString();
  const interval = rawInterval === "year" ? "year" : rawInterval === "month" ? "month" : undefined;
  const askedSeats = Number(formData?.get("seats"));
  const occupied = Math.max(1, await occupiedSeats(tenant.id));
  const seats =
    Number.isFinite(askedSeats) && askedSeats > 0
      ? Math.max(Math.floor(askedSeats), occupied)
      : occupied;
  const url = await checkoutUrl({ tenantSlug: tenant.slug, seats, planId, interval });
  if (!url) redirect("/app/settings/billing?error=gateway");
  redirect(url);
}

/** Payment method, seats, invoices, cancellation: the provider's customer portal. */
export async function goPortal() {
  const { tenant } = await requireOwner();
  const url = await portalUrl(tenant.slug);
  if (!url) redirect("/app/settings/billing?error=gateway");
  redirect(url);
}

/**
 * "Re-check now" on a paused workspace: the control plane looks for a live
 * subscription and lifts the pause on the spot when it finds one.
 */
export async function goRecheck() {
  const { tenant } = await requireOwner();
  const res = await recheckSuspension(tenant.slug);
  if (!res) redirect("/app/settings/billing?error=gateway");
  if (res.outcome === "reactivated" || res.outcome === "not_suspended") {
    redirect("/app/settings/billing?recheck=ok");
  }
  if (res.outcome === "no_subscription") redirect("/app/settings/billing?recheck=none");
  // Unpaid or unverified: a re-check changes nothing; the screen already says
  // what lifts the pause from the workspace's own state.
  redirect("/app/settings/billing");
}
