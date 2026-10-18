"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@openincident/crypto";
import { docsTarget, testDocs, type DocsConfig } from "@openincident/docs";
import { integrationInstalls, withTenant } from "@openincident/db";
import {
  syncTrackerStatuses,
  testTracker,
  trackerTarget,
  type TrackerConfig,
} from "@openincident/trackers";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";

/**
 * The Connect and Manage dialogs of Settings › Integrations. Each answers the
 * dialog — an error stays in it, a success closes it with a sentence — where
 * the older actions in ./actions.ts redirect (kept for the screens that still
 * use them).
 *
 * Credentials are tested against the vendor before anything is stored, kept
 * encrypted at rest, and never sent back. Managing a connection may leave the
 * secret field empty: the stored one is decrypted, tested again with the new
 * settings, and kept.
 */

const PAGE = "/app/settings/integrations";

export type RowResult = { ok: boolean; message: string };

const NAMES: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  jira: "Jira",
  linear: "Linear",
  confluence: "Confluence",
  notion: "Notion",
  meet: "Google Meet",
  zoom: "Zoom",
};

const secretField = z.string().trim().max(400).optional();

const trackerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("github"),
    repo: z
      .string()
      .trim()
      .regex(/^[\w.-]+\/[\w.-]+$/),
    secret: secretField,
  }),
  z.object({
    kind: z.literal("gitlab"),
    project: z
      .string()
      .trim()
      .regex(/^[\w.-]+(\/[\w.-]+)+$|^\d+$/),
    secret: secretField,
  }),
  z.object({
    kind: z.literal("jira"),
    site: z
      .string()
      .trim()
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i),
    email: z.string().trim().email(),
    projectKey: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,9}$/),
    issueType: z.string().trim().max(60).optional(),
    secret: secretField,
  }),
  z.object({
    kind: z.literal("linear"),
    teamKey: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{1,8}$/),
    secret: secretField,
  }),
]);

const docsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("confluence"),
    site: z
      .string()
      .trim()
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i),
    email: z.string().trim().email(),
    spaceKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_~]{1,255}$/),
    parentPageId: z.string().trim().max(40).optional(),
    secret: secretField,
  }),
  z.object({
    kind: z.literal("notion"),
    parentPageId: z
      .string()
      .trim()
      .regex(/^[0-9a-f-]{32,36}$/i),
    secret: secretField,
  }),
]);

/** The secret to test with: the one typed, else the one already stored for this kind. */
async function secretFor(
  tenantId: string,
  kind: string,
  typed: string | undefined,
): Promise<{ secret: string | null; existing: boolean }> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        encryptedSecrets: integrationInstalls.encryptedSecrets,
        status: integrationInstalls.status,
      })
      .from(integrationInstalls)
      .where(
        and(
          eq(integrationInstalls.tenantId, tenantId),
          eq(integrationInstalls.kind, kind as "github"),
        ),
      ),
  );
  const existing = Boolean(row && row.status === "active");
  if (typed && typed.length >= 8) return { secret: typed, existing };
  if (typed) return { secret: null, existing };
  return { secret: existing ? decryptSecret(row?.encryptedSecrets) : null, existing };
}

async function store(
  tenantId: string,
  kind: string,
  values: {
    config: Record<string, unknown>;
    encryptedSecrets: string | null;
    externalName: string | null;
    installedByMemberId: string;
  },
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: integrationInstalls.id })
      .from(integrationInstalls)
      .where(
        and(
          eq(integrationInstalls.tenantId, tenantId),
          eq(integrationInstalls.kind, kind as "github"),
        ),
      );
    const set = { ...values, status: "active" as const, updatedAt: new Date() };
    if (existing)
      await tx.update(integrationInstalls).set(set).where(eq(integrationInstalls.id, existing.id));
    else await tx.insert(integrationInstalls).values({ tenantId, kind: kind as "github", ...set });
  });
}

/** GitHub, GitLab, Jira, Linear: tested, then stored. */
export async function connectTracker(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const raw = Object.fromEntries(formData.entries());
  const parsed = trackerSchema.safeParse({
    ...raw,
    issueType: raw.issueType || undefined,
    secret: raw.secret || undefined,
  });
  if (!parsed.success) return { ok: false, error: t("settings.integrations.trackerInvalid") };
  const { secret: typed, ...config } = parsed.data;
  const { secret, existing } = await secretFor(current.tenant.id, config.kind, typed);
  if (!secret) return { ok: false, error: t("settingsV2.int.secretMissing") };
  const test = await testTracker(config as TrackerConfig, secret);
  if (!test.ok)
    return {
      ok: false,
      error: `${t("settings.integrations.trackerTestFailed")} — ${test.error.slice(0, 160)}`,
    };
  await store(current.tenant.id, config.kind, {
    config: config as Record<string, unknown>,
    encryptedSecrets: encryptSecret(secret),
    externalName: test.detail,
    installedByMemberId: current.member.id,
  });
  await withTenant(current.tenant.id, (tx) =>
    recordAudit(tx, current, "config", "tracker.connected", {
      kind: config.kind,
      target: trackerTarget(config as TrackerConfig),
    }),
  );
  revalidatePath(PAGE);
  const name = NAMES[config.kind] ?? config.kind;
  return {
    ok: true,
    message: existing
      ? t("settingsV2.int.saved", { name })
      : t("settingsV2.int.connectedFlash", { name }),
  };
}

/** Confluence, Notion: tested, then stored. */
export async function connectDocs(_prev: DialogResult, formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const raw = Object.fromEntries(formData.entries());
  const parsed = docsSchema.safeParse({
    ...raw,
    parentPageId: raw.parentPageId || undefined,
    secret: raw.secret || undefined,
  });
  if (!parsed.success) return { ok: false, error: t("settings.integrations.docsInvalid") };
  const { secret: typed, ...config } = parsed.data;
  const { secret, existing } = await secretFor(current.tenant.id, config.kind, typed);
  if (!secret) return { ok: false, error: t("settingsV2.int.secretMissing") };
  const test = await testDocs(config as DocsConfig, secret);
  if (!test.ok)
    return {
      ok: false,
      error: `${t("settings.integrations.trackerTestFailed")} — ${test.error.slice(0, 160)}`,
    };
  await store(current.tenant.id, config.kind, {
    config: config as Record<string, unknown>,
    encryptedSecrets: encryptSecret(secret),
    externalName: test.detail,
    installedByMemberId: current.member.id,
  });
  await withTenant(current.tenant.id, (tx) =>
    recordAudit(tx, current, "config", "docs.connected", {
      kind: config.kind,
      target: docsTarget(config as DocsConfig),
    }),
  );
  revalidatePath(PAGE);
  const name = NAMES[config.kind] ?? config.kind;
  return {
    ok: true,
    message: existing
      ? t("settingsV2.int.saved", { name })
      : t("settingsV2.int.connectedFlash", { name }),
  };
}

/**
 * Google Meet, Zoom: a link template attached to every new incident. One
 * war-room provider at a time — saving one switches the other off.
 */
export async function connectBridge(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = z
    .object({ kind: z.enum(["meet", "zoom"]), template: z.string().trim().url().max(300) })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.int.bridgeInvalid") };
  const { kind, template } = parsed.data;
  if (!/^https:\/\//.test(template)) return { ok: false, error: t("settingsV2.int.bridgeInvalid") };
  const existed = await withTenant(current.tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(integrationInstalls)
      .where(eq(integrationInstalls.tenantId, current.tenant.id));
    for (const r of rows)
      if ((r.kind === "meet" || r.kind === "zoom") && r.kind !== kind && r.status === "active")
        await tx
          .update(integrationInstalls)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(eq(integrationInstalls.id, r.id));
    const existing = rows.find((r) => r.kind === kind);
    if (existing)
      await tx
        .update(integrationInstalls)
        .set({
          config: { template },
          status: "active",
          installedByMemberId: current.member.id,
          updatedAt: new Date(),
        })
        .where(eq(integrationInstalls.id, existing.id));
    else
      await tx.insert(integrationInstalls).values({
        tenantId: current.tenant.id,
        kind,
        config: { template },
        status: "active",
        installedByMemberId: current.member.id,
      });
    await recordAudit(tx, current, "config", "bridge.configured", { kind, template });
    return existing?.status === "active";
  });
  revalidatePath(PAGE);
  const name = NAMES[kind]!;
  return {
    ok: true,
    message: existed
      ? t("settingsV2.int.saved", { name })
      : t("settingsV2.int.connectedFlash", { name }),
  };
}

/** Disconnect: the secret is dropped, the row kept revoked — linked issues and pages stay. */
export async function disconnectIntegration(kind: string): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const k = z
    .enum(["github", "gitlab", "jira", "linear", "confluence", "notion", "meet", "zoom"])
    .parse(kind);
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(integrationInstalls)
      .set({ status: "revoked", encryptedSecrets: null, updatedAt: new Date() })
      .where(
        and(eq(integrationInstalls.tenantId, current.tenant.id), eq(integrationInstalls.kind, k)),
      );
    const action =
      k === "meet" || k === "zoom"
        ? "bridge.removed"
        : k === "confluence" || k === "notion"
          ? "docs.disconnected"
          : "tracker.disconnected";
    await recordAudit(tx, current, "config", action, { kind: k });
  });
  revalidatePath(PAGE);
  return { ok: true, message: t("settingsV2.int.disconnected", { name: NAMES[k]! }) };
}

/** "Sync now": the pass the worker runs every five minutes, on demand. */
export async function syncTrackers(): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const r = await syncTrackerStatuses(current.tenant.id);
  revalidatePath(PAGE);
  revalidatePath("/app/incidents");
  return {
    ok: r.errors === 0,
    message: t("settings.integrations.trackerSynced", {
      checked: r.checked,
      completed: r.completed,
    }),
  };
}
