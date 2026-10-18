/**
 * The host: what the engine asks the product to do on its behalf.
 *
 * Writing inside an incident (resolving it, reopening it, a follow-up),
 * paging a person and sending a notification all go through the product's
 * own write paths — the ones the screens and the API use — so that a
 * resolution by Atlas fires the same announcements, webhooks, chat updates
 * and escalation cancellations as one by a person. Those paths live in the
 * web app. In the web process they are called directly; from the worker they
 * are reached through a signed internal route (/api/atlas/internal).
 */
import { getTenantById } from "@openincident/db";
import { INTERNAL_HEADER, signInternal } from "./sign";

export type HostOp =
  /** Resolve the incident as Atlas — with or without anybody having been paged. */
  | {
      op: "resolve";
      tenantId: string;
      incidentId: string;
      message: string;
      alone: boolean;
    }
  /** Back to active: an undone resolution, a "Reopen" from the review queue. */
  | { op: "reopen"; tenantId: string; incidentId: string; message: string; byName: string }
  | { op: "follow_up"; tenantId: string; incidentId: string; title: string }
  | { op: "cancel_follow_up"; tenantId: string; followUpId: string; restore?: boolean }
  /**
   * A person, now: the escalation held while Atlas tried is released, or —
   * when nothing was paging — the service's owner is paged. `reason` says why
   * in the page itself.
   */
  | {
      op: "page";
      tenantId: string;
      incidentId: string;
      reason: "acted" | "blocked" | "reopened" | "failed";
      note: string;
    }
  /** Push / summary to members, per their "When Atlas resolves on its own" choice. */
  | {
      op: "notify";
      tenantId: string;
      kind: "resolved" | "proposal";
      incidentId: string;
      actionId: string | null;
    }
  | { op: "summary"; tenantId: string; memberId: string };

export type HostResult = { ok: boolean; error?: string; data?: Record<string, unknown> };

export type AtlasHost = { run(op: HostOp): Promise<HostResult> };

/** The public host of a workspace, as the middleware resolves it. */
export async function tenantHost(tenantId: string): Promise<string | null> {
  const t = await getTenantById(tenantId);
  if (!t) return null;
  if (t.customDomain) return t.customDomain;
  return `${t.slug}.${process.env.BASE_DOMAIN ?? "localhost:3100"}`;
}

/** The workspace's public origin, for the links in messages. */
export async function tenantPublicOrigin(tenantId: string): Promise<string> {
  const host = await tenantHost(tenantId);
  const scheme = process.env.PUBLIC_SCHEME ?? "http";
  return host ? `${scheme}://${host}` : "";
}

/**
 * The worker's host: a signed POST to the web app. INTERNAL_WEB_ORIGIN is the
 * address the web process listens on from inside the deployment; without it,
 * the workspace's public origin.
 */
export function httpHost(): AtlasHost {
  return {
    async run(op) {
      const host = await tenantHost(op.tenantId);
      if (!host) return { ok: false, error: "workspace not found" };
      const scheme = process.env.PUBLIC_SCHEME ?? "http";
      const base = (process.env.INTERNAL_WEB_ORIGIN ?? `${scheme}://${host}`).replace(/\/$/, "");
      const body = JSON.stringify(op);
      try {
        const res = await fetch(`${base}/api/atlas/internal`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-host": host,
            [INTERNAL_HEADER]: signInternal(body),
          },
          body,
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json().catch(() => null)) as HostResult | null;
        if (!res.ok || !data)
          return { ok: false, error: data?.error ?? `web answered ${res.status}` };
        return data;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
