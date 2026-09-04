/**
 * The SCIM endpoint's settings: a token per workspace, hashed at rest, shown
 * once. Authentication compares hashes in constant time.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MemberRole } from "@openincident/config";
import { scimSettings, withTenant } from "@openincident/db";

export type ScimSettingsRow = typeof scimSettings.$inferSelect;

export const SCIM_TOKEN_PATTERN = /^oi_scim_[a-f0-9]{48}$/;

export function hashScimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getScimSettings(tenantId: string): Promise<ScimSettingsRow | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(scimSettings).where(eq(scimSettings.tenantId, tenantId));
    return row ?? null;
  });
}

/** Creates the endpoint (or rotates its token); the plain token is returned once. */
export async function issueScimToken(
  tenantId: string,
  input: { defaultRole: MemberRole; sendInvites: boolean; actorMemberId: string | null },
): Promise<{ token: string; rotated: boolean }> {
  const token = `oi_scim_${randomBytes(24).toString("hex")}`;
  const tokenHash = hashScimToken(token);
  const tokenHint = `…${token.slice(-6)}`;
  const rotated = await withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: scimSettings.id })
      .from(scimSettings)
      .where(eq(scimSettings.tenantId, tenantId));
    if (existing) {
      await tx
        .update(scimSettings)
        .set({
          tokenHash,
          tokenHint,
          enabled: true,
          defaultRole: input.defaultRole,
          sendInvites: input.sendInvites,
          rotatedAt: new Date(),
        })
        .where(eq(scimSettings.id, existing.id));
      return true;
    }
    await tx.insert(scimSettings).values({
      tenantId,
      tokenHash,
      tokenHint,
      defaultRole: input.defaultRole,
      sendInvites: input.sendInvites,
      createdByMemberId: input.actorMemberId,
    });
    return false;
  });
  return { token, rotated };
}

export async function setScimEnabled(tenantId: string, enabled: boolean): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.update(scimSettings).set({ enabled }).where(eq(scimSettings.tenantId, tenantId)),
  );
}

export async function updateScimOptions(
  tenantId: string,
  input: { defaultRole: MemberRole; sendInvites: boolean },
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.update(scimSettings).set(input).where(eq(scimSettings.tenantId, tenantId)),
  );
}

/** Bearer token → settings, or null. Constant-time on the hash; the miss costs the same as a hit. */
export async function authenticateScim(
  tenantId: string,
  authorization: string | null,
): Promise<ScimSettingsRow | null> {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!SCIM_TOKEN_PATTERN.test(token)) return null;
  const settings = await getScimSettings(tenantId);
  if (!settings || !settings.enabled) return null;
  const a = Buffer.from(hashScimToken(token), "hex");
  const b = Buffer.from(settings.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await withTenant(tenantId, (tx) =>
    tx.update(scimSettings).set({ lastSeenAt: new Date() }).where(eq(scimSettings.id, settings.id)),
  );
  return settings;
}
