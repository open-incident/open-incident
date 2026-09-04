/**
 * Governance: what the workspace allows, and the log of every call. The
 * assistant proposes, a human publishes — this file is where "proposes" is
 * permitted or refused, and remembered.
 */
import { and, desc, eq } from "drizzle-orm";
import {
  aiCalls,
  aiSettings,
  atlasDocuments,
  incidents,
  withTenant,
  type AiCapability,
  type Tx,
} from "@openincident/db";
import {
  aiConfigured,
  aiModel,
  aiProviderLabel,
  chatComplete,
  embed,
  embeddingsConfigured,
  type ChatMessage,
  type Completion,
} from "./provider";
import { cosine } from "./similarity";
import { redact } from "./redact";

export const AI_CAPABILITIES: AiCapability[] = [
  "declare_suggest",
  "summary",
  "related",
  "update_draft",
  "follow_ups",
  "post_mortem",
];

export type AiSettingsView = {
  enabled: boolean;
  capabilities: Partial<Record<AiCapability, boolean>>;
  sources: { catalog: boolean; incidents: boolean; changeEvents: boolean; docs: boolean };
  privateOptIn: boolean;
  provider: string | null;
};

export const DEFAULT_AI_SETTINGS: AiSettingsView = {
  enabled: true,
  capabilities: {},
  sources: { catalog: true, incidents: true, changeEvents: true, docs: false },
  privateOptIn: false,
  provider: null,
};

export async function getAiSettings(tx: Tx, tenantId: string): Promise<AiSettingsView> {
  const [row] = await tx.select().from(aiSettings).where(eq(aiSettings.tenantId, tenantId));
  if (!row) return DEFAULT_AI_SETTINGS;
  return {
    enabled: row.enabled,
    capabilities: row.capabilities,
    sources: row.sources,
    privateOptIn: row.privateOptIn,
    provider: row.provider,
  };
}

export type Allowance =
  { ok: true } | { ok: false; reason: "unconfigured" | "disabled" | "capability_off" };

/** Whether a capability may run right now: instance configured, workspace on, capability on. */
export async function capabilityAllowed(
  tx: Tx,
  tenantId: string,
  cap: AiCapability,
): Promise<Allowance> {
  if (!aiConfigured()) return { ok: false, reason: "unconfigured" };
  const s = await getAiSettings(tx, tenantId);
  if (!s.enabled) return { ok: false, reason: "disabled" };
  if (s.capabilities[cap] === false) return { ok: false, reason: "capability_off" };
  return { ok: true };
}

export type Actor = { kind: "member" | "system" | "api"; memberId: string | null; name: string };

/** Runs one capability: the call is logged whatever happens, with its cost and duration. */
export async function runCapability<T>(
  tenantId: string,
  cap: AiCapability | "embed",
  actor: Actor,
  incidentId: string | null,
  work: () => Promise<{ result: T; model: string; inputTokens: number; outputTokens: number }>,
): Promise<T> {
  const started = Date.now();
  try {
    const out = await work();
    await withTenant(tenantId, (tx) =>
      tx.insert(aiCalls).values({
        tenantId,
        capability: cap,
        provider: aiProviderLabel(),
        model: out.model,
        actorKind: actor.kind,
        actorMemberId: actor.memberId,
        actorName: actor.name,
        incidentId,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
        durationMs: Date.now() - started,
        status: "ok",
      }),
    ).catch(() => {});
    return out.result;
  } catch (err) {
    await withTenant(tenantId, (tx) =>
      tx.insert(aiCalls).values({
        tenantId,
        capability: cap,
        provider: aiProviderLabel(),
        model: aiModel(),
        actorKind: actor.kind,
        actorMemberId: actor.memberId,
        actorName: actor.name,
        incidentId,
        durationMs: Date.now() - started,
        status: "failed",
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      }),
    ).catch(() => {});
    throw err;
  }
}

/** A redacted chat completion with the product's standing rules. */
export async function ask(
  system: string,
  user: string,
  opts: { json?: boolean; maxTokens?: number } = {},
): Promise<Completion> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${system}\n\nRules: you draft, a human publishes. Never invent facts absent from the material; when something is unknown, say so. Keep the language of the material (French stays French). No preamble.`,
    },
    { role: "user", content: redact(user) },
  ];
  return chatComplete({ messages, json: opts.json, maxTokens: opts.maxTokens });
}

/** Stores (or refreshes) a knowledge document with its embedding when embeddings are available. */
export async function upsertAtlasDocument(
  tenantId: string,
  doc: {
    source: "incident" | "post_mortem" | "catalog" | "change_event" | "runbook";
    refId: string;
    title: string;
    summary: string;
  },
  actor: Actor,
): Promise<void> {
  let embedding: number[] | null = null;
  let model: string | null = null;
  if (embeddingsConfigured()) {
    try {
      const r = await runCapability(tenantId, "embed", actor, null, async () => {
        const e = await embed([redact(`${doc.title}\n${doc.summary}`)]);
        return { result: e, model: e.model, inputTokens: e.tokens, outputTokens: 0 };
      });
      embedding = r.vectors[0] ?? null;
      model = r.model;
    } catch {
      embedding = null;
    }
  }
  await withTenant(tenantId, (tx) =>
    tx
      .insert(atlasDocuments)
      .values({
        tenantId,
        source: doc.source,
        refId: doc.refId,
        title: doc.title,
        summary: doc.summary,
        embedding,
        model,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [atlasDocuments.tenantId, atlasDocuments.source, atlasDocuments.refId],
        set: { title: doc.title, summary: doc.summary, embedding, model, updatedAt: new Date() },
      }),
  );
}

/** The closest documents to a text, by embedding when both sides have one. */
export async function similarDocuments(
  tenantId: string,
  text: string,
  opts: {
    source: "incident" | "post_mortem" | "catalog" | "change_event" | "runbook";
    excludeRefId?: string;
    limit?: number;
  },
  actor: Actor,
): Promise<Array<{ refId: string; title: string; summary: string; score: number }>> {
  if (!embeddingsConfigured()) return [];
  const q = await runCapability(tenantId, "embed", actor, null, async () => {
    const e = await embed([redact(text)]);
    return { result: e.vectors[0] ?? [], model: e.model, inputTokens: e.tokens, outputTokens: 0 };
  });
  if (q.length === 0) return [];
  const docs = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(atlasDocuments)
      .where(and(eq(atlasDocuments.tenantId, tenantId), eq(atlasDocuments.source, opts.source)))
      .orderBy(desc(atlasDocuments.updatedAt))
      .limit(2000),
  );
  return docs
    .filter((d) => d.embedding && d.refId !== opts.excludeRefId)
    .map((d) => ({
      refId: d.refId,
      title: d.title,
      summary: d.summary,
      score: cosine(q, d.embedding!),
    }))
    .filter((d) => d.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 3);
}

/** Recent calls, for the governance screen. */
export async function recentAiCalls(tx: Tx, tenantId: string, limit = 50) {
  const rows = await tx
    .select({ call: aiCalls, incidentNumber: incidents.number })
    .from(aiCalls)
    .leftJoin(incidents, eq(incidents.id, aiCalls.incidentId))
    .where(eq(aiCalls.tenantId, tenantId))
    .orderBy(desc(aiCalls.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.call, incidentNumber: r.incidentNumber }));
}
