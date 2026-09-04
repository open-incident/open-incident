/**
 * Heartbeats — the dead-man's switch. A cron pings a URL; when the pings stop
 * for longer than the interval plus the grace, the product raises an alert
 * through the workspace's own managed alert source — posted to its public
 * ingest endpoint like any monitoring tool would, so routes, priorities,
 * grouping and escalation apply unchanged. The next ping resolves it.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@openincident/crypto";
import {
  alertSources,
  catalogEntries,
  getTenantById,
  heartbeats,
  registerApiKeyLookup,
  withTenant,
  type Tx,
} from "@openincident/db";
import { tenantOrigin } from "./notify";

export const HEARTBEAT_SOURCE_NAME = "Heartbeats";
export const MIN_INTERVAL_SECONDS = 10;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** The tenant's managed source for heartbeat alerts — created on first use, secret kept for the product's own posts. */
export async function ensureHeartbeatSource(
  tx: Tx,
  tenantId: string,
): Promise<{ id: string; secret: string }> {
  const [existing] = await tx
    .select()
    .from(alertSources)
    .where(
      and(
        eq(alertSources.tenantId, tenantId),
        eq(alertSources.managed, true),
        eq(alertSources.name, HEARTBEAT_SOURCE_NAME),
      ),
    );
  if (existing) {
    // The ingest endpoint finds the workspace through the directory lookup: keep it registered.
    await registerApiKeyLookup(`src:${existing.id}`, tenantId);
    const secret = decryptSecret(existing.encryptedSecret);
    if (secret) return { id: existing.id, secret };
    // A managed source without a readable secret gets a new one — the product is its only caller.
    const fresh = randomBytes(24).toString("hex");
    await tx
      .update(alertSources)
      .set({
        secretHash: hashSecret(fresh),
        encryptedSecret: encryptSecret(fresh),
      })
      .where(eq(alertSources.id, existing.id));
    await registerApiKeyLookup(`src:${existing.id}`, tenantId);
    return { id: existing.id, secret: fresh };
  }
  const secret = randomBytes(24).toString("hex");
  const [created] = await tx
    .insert(alertSources)
    .values({
      tenantId,
      kind: "http",
      name: HEARTBEAT_SOURCE_NAME,
      secretHash: hashSecret(secret),
      encryptedSecret: encryptSecret(secret),
      managed: true,
      active: true,
    })
    .returning({ id: alertSources.id });
  await registerApiKeyLookup(`src:${created!.id}`, tenantId);
  return { id: created!.id, secret };
}

export function newHeartbeatToken(): string {
  return randomBytes(16).toString("hex");
}

export function heartbeatPingUrl(origin: string, id: string, token: string): string {
  return `${origin}/api/heartbeats/${id}/${token}`;
}

/** Where the product posts to itself: the tenant's public origin, or an internal base with the tenant's Host. */
function ingestTarget(origin: string, sourceId: string): { url: string; host: string | null } {
  const internal = process.env.INTERNAL_WEB_ORIGIN?.replace(/\/$/, "");
  const path = `/api/ingest/alerts/${sourceId}`;
  if (internal) return { url: `${internal}${path}`, host: new URL(origin).host };
  return { url: `${origin}${path}`, host: null };
}

async function postHeartbeatAlert(
  origin: string,
  source: { id: string; secret: string },
  payload: Record<string, unknown>,
): Promise<boolean> {
  const target = ingestTarget(origin, source.id);
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-oi-secret": source.secret,
        // The tenant travels in x-forwarded-host, which the middleware reads first.
        ...(target.host ? { host: target.host, "x-forwarded-host": target.host } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error(`[heartbeats] ingest answered ${res.status} for ${target.url}`);
    return res.ok;
  } catch (err) {
    console.error("[heartbeats] ingest unreachable:", err instanceof Error ? err.message : err);
    return false;
  }
}

function alertPayload(
  hb: {
    id: string;
    name: string;
    description: string | null;
    intervalSeconds: number;
    graceSeconds: number;
  },
  serviceName: string | null,
  status: "firing" | "resolved",
  origin: string,
) {
  return {
    title: status === "firing" ? `Heartbeat missed — ${hb.name}` : `Heartbeat back — ${hb.name}`,
    description:
      status === "firing"
        ? `No ping for more than ${hb.intervalSeconds + hb.graceSeconds} s (interval ${hb.intervalSeconds} s, grace ${hb.graceSeconds} s).${hb.description ? ` ${hb.description}` : ""}`
        : "The heartbeat pinged again.",
    status,
    dedup_key: `heartbeat:${hb.id}`,
    service: serviceName ?? undefined,
    url: `${origin}/app/settings/heartbeats`,
    heartbeat: hb.id,
  };
}

/**
 * Records a ping. Unknown id or wrong token: false, nothing happens. A ping on a
 * heartbeat that was down resolves its alert.
 */
export async function recordHeartbeatPing(
  tenantId: string,
  id: string,
  token: string,
): Promise<boolean> {
  const state = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ hb: heartbeats, serviceName: catalogEntries.name })
      .from(heartbeats)
      .leftJoin(catalogEntries, eq(catalogEntries.id, heartbeats.serviceEntryId))
      .where(and(eq(heartbeats.tenantId, tenantId), eq(heartbeats.id, id)));
    if (!row) return null;
    const stored = decryptSecret(row.hb.encryptedToken) ?? "";
    const a = Buffer.from(stored);
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (!row.hb.active) return { accepted: true, wasDown: false, row };
    await tx
      .update(heartbeats)
      .set({ lastPingAt: new Date(), status: "up", updatedAt: new Date() })
      .where(eq(heartbeats.id, id));
    const source = row.hb.status === "down" ? await ensureHeartbeatSource(tx, tenantId) : null;
    return { accepted: true, wasDown: row.hb.status === "down", row, source };
  });
  if (!state) return false;
  if (state.wasDown && state.source) {
    const tenant = await getTenantById(tenantId);
    if (tenant) {
      const origin = tenantOrigin(tenant.slug, tenant.customDomain);
      await postHeartbeatAlert(
        origin,
        state.source,
        alertPayload(state.row.hb, state.row.serviceName, "resolved", origin),
      );
    }
  }
  return true;
}

/** The sweep: every active heartbeat that pinged once and is now late becomes down, with its alert. */
export async function sweepHeartbeats(tenantIds: string[], now = new Date()): Promise<number> {
  let missed = 0;
  for (const tenantId of tenantIds) {
    const late = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ hb: heartbeats, serviceName: catalogEntries.name })
        .from(heartbeats)
        .leftJoin(catalogEntries, eq(catalogEntries.id, heartbeats.serviceEntryId))
        .where(
          and(
            eq(heartbeats.tenantId, tenantId),
            eq(heartbeats.active, true),
            ne(heartbeats.status, "down"),
            isNotNull(heartbeats.lastPingAt),
          ),
        );
      const due = rows.filter(
        (r) =>
          r.hb.lastPingAt!.getTime() + (r.hb.intervalSeconds + r.hb.graceSeconds) * 1000 <
          now.getTime(),
      );
      if (due.length === 0) return null;
      for (const r of due)
        await tx
          .update(heartbeats)
          .set({ status: "down", lastMissedAt: now, updatedAt: now })
          .where(eq(heartbeats.id, r.hb.id));
      const source = await ensureHeartbeatSource(tx, tenantId);
      return { due, source };
    });
    if (!late) continue;
    const tenant = await getTenantById(tenantId);
    if (!tenant) continue;
    const origin = tenantOrigin(tenant.slug, tenant.customDomain);
    for (const r of late.due) {
      if (
        await postHeartbeatAlert(
          origin,
          late.source,
          alertPayload(r.hb, r.serviceName, "firing", origin),
        )
      )
        missed++;
    }
  }
  return missed;
}
