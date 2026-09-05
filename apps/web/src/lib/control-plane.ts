/**
 * Control plane client — the product talks to no payment provider and carries
 * none of its keys: it asks its control plane for what to show and for a
 * session URL, and redirects the user there. Inert without CLOUD_GATEWAY_URL,
 * that is, in every self-hosted install: the screen then says so.
 */
export function gatewayConfigured(): boolean {
  return Boolean(process.env.CLOUD_GATEWAY_URL && process.env.CLOUD_GATEWAY_SECRET);
}

async function call<T>(path: string, body: unknown): Promise<T | null> {
  if (!gatewayConfigured()) return null;
  try {
    const res = await fetch(`${process.env.CLOUD_GATEWAY_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.CLOUD_GATEWAY_SECRET}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[gateway] ${path} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[gateway] ${path} unreachable:`, err);
    return null;
  }
}

/**
 * Subscription session: the product passes the workspace and the owner's
 * choice (plan id as named by the control plane, billing interval, seats) —
 * what those cost belongs to the control plane.
 */
export async function checkoutUrl(input: {
  tenantSlug: string;
  seats: number;
  planId?: string;
  interval?: "month" | "year";
}): Promise<string | null> {
  const res = await call<{ url: string }>("/api/gateway/checkout-session", input);
  return res?.url ?? null;
}

/** Payment method, seats, invoices, cancellation: the provider's customer portal. */
export async function portalUrl(tenantSlug: string): Promise<string | null> {
  const res = await call<{ url: string }>("/api/gateway/portal-session", { tenantSlug });
  return res?.url ?? null;
}

/** One public plan as the control plane sells it. The product invents none of it. */
export type Offer = {
  id: string;
  name: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  includedSeats: number;
  currency: string;
  entitlements: Record<string, unknown>;
};

/** The public catalog. Empty without a control plane — the screen then shows no offers. */
export async function fetchOffers(): Promise<Offer[]> {
  const res = await call<{ offers: Offer[] }>("/api/gateway/offers", {});
  return res?.offers ?? [];
}

/** The workspace's subscription as the control plane knows it. */
export type Subscription = {
  planId: string | null;
  planName: string | null;
  status: string;
  trialEndsAt: string | null;
  suspendedReason: string | null;
  seats: number | null;
  interval: "month" | "year" | null;
  seatPriceCents: number | null;
  currency: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  dunningDeadline: string | null;
};

export async function fetchSubscription(tenantSlug: string): Promise<Subscription | null> {
  const res = await call<{ subscription: Subscription | null }>("/api/gateway/subscription", {
    tenantSlug,
  });
  return res?.subscription ?? null;
}

/** One invoice as the control plane mirrors it from the payment provider. */
export type Invoice = {
  number: string | null;
  amountCents: number;
  currency: string;
  status: string;
  issuedAt: string | null;
  paidAt: string | null;
  pdfUrl: string | null;
};

export async function fetchInvoices(tenantSlug: string): Promise<Invoice[]> {
  const res = await call<{ invoices: Invoice[] }>("/api/gateway/invoices", { tenantSlug });
  return res?.invoices ?? [];
}

export type Recheck = {
  outcome:
    "reactivated" | "not_suspended" | "unpaid" | "unverified" | "no_subscription" | "unknown";
  seats?: number;
};

/** "Re-check now" on a paused workspace: the control plane recounts and answers. */
export async function recheckSuspension(tenantSlug: string): Promise<Recheck | null> {
  return call<Recheck>("/api/gateway/recheck", { tenantSlug });
}
