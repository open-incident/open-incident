/**
 * The assistant's capabilities, one function each. Every one: checks the
 * governance (instance configured, workspace on, capability on), builds a
 * dossier from the incident's own rows, asks with redaction, logs the call,
 * and returns a DRAFT — a human publishes. Nothing here writes what a person
 * would read as fact without the AI label.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import {
  ask,
  capabilityAllowed,
  cosine,
  embeddingsConfigured,
  parseJson,
  runCapability,
  runbookExcerpts,
  type Actor,
  upsertAtlasDocument,
} from "@openincident/ai";
import {
  atlasDocuments,
  catalogEntries,
  changeEvents,
  followUpPriorities,
  followUps,
  incidentEvents,
  incidents,
  postMortems,
  severities,
  withTenant,
  type AiCapability,
  type Tx,
} from "@openincident/db";

export type AiRefusal = "unconfigured" | "disabled" | "capability_off" | "failed";
export type AiOutcome<T> = { ok: true; value: T } | { ok: false; reason: AiRefusal };

const DAY = 86_400_000;

/** Whether a capability may run for this workspace right now. */
export async function aiAllowance(tenantId: string, cap: AiCapability): Promise<AiOutcome<true>> {
  const a = await withTenant(tenantId, (tx) => capabilityAllowed(tx, tenantId, cap));
  return a.ok ? { ok: true, value: true } : { ok: false, reason: a.reason };
}

/** Change events around an incident: its service (or all), from 24 h before declaration to resolution. */
export async function recentChanges(
  tx: Tx,
  tenantId: string,
  inc: { serviceEntryId: string | null; declaredAt: Date; resolvedAt: Date | null },
  limit = 5,
) {
  const from = new Date(inc.declaredAt.getTime() - DAY);
  const to = inc.resolvedAt ?? new Date();
  const rows = await tx
    .select({ ev: changeEvents, serviceName: catalogEntries.name })
    .from(changeEvents)
    .leftJoin(catalogEntries, eq(catalogEntries.id, changeEvents.serviceEntryId))
    .where(
      and(
        eq(changeEvents.tenantId, tenantId),
        gte(changeEvents.occurredAt, from),
        lte(changeEvents.occurredAt, to),
        inc.serviceEntryId
          ? sql`(${changeEvents.serviceEntryId} = ${inc.serviceEntryId} or ${changeEvents.serviceEntryId} is null)`
          : sql`true`,
      ),
    )
    .orderBy(desc(changeEvents.occurredAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.ev, serviceName: r.serviceName }));
}

type Dossier = {
  id: string;
  number: number;
  name: string;
  visibility: string;
  serviceEntryId: string | null;
  declaredAt: Date;
  resolvedAt: Date | null;
  text: string;
};

/** The incident as text: header, summary, timeline, follow-ups, recent changes. */
async function dossier(tx: Tx, tenantId: string, number: number): Promise<Dossier | null> {
  const [row] = await tx
    .select({ inc: incidents, sevName: severities.name, serviceName: catalogEntries.name })
    .from(incidents)
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .leftJoin(catalogEntries, eq(catalogEntries.id, incidents.serviceEntryId))
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
  if (!row) return null;
  const inc = row.inc;
  const events = await tx
    .select()
    .from(incidentEvents)
    .where(eq(incidentEvents.incidentId, inc.id))
    .orderBy(asc(incidentEvents.occurredAt))
    .limit(200);
  const fus = await tx
    .select({ f: followUps, priority: followUpPriorities.name })
    .from(followUps)
    .leftJoin(followUpPriorities, eq(followUpPriorities.id, followUps.priorityId))
    .where(eq(followUps.incidentId, inc.id));
  const changes = await recentChanges(tx, tenantId, inc, 8);
  const runbooks = await runbookExcerpts(tx, tenantId, inc.serviceEntryId);
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  const lines: string[] = [
    `INC-${inc.number} — ${inc.name}`,
    `Severity: ${row.sevName ?? "—"} · Service: ${row.serviceName ?? "—"} · Phase: ${inc.phase} · Declared: ${fmt(inc.declaredAt)}${inc.resolvedAt ? ` · Resolved: ${fmt(inc.resolvedAt)}` : ""}`,
    inc.summary ? `Summary: ${inc.summary}` : "",
    "",
    "Timeline:",
    ...events.map((e) => {
      const p = e.payload as Record<string, unknown>;
      const detail = [p.message, p.note, p.title, p.status, p.severity, p.to, p.role, p.name]
        .filter((v) => typeof v === "string" && v.length > 0)
        .join(" — ");
      return `- ${fmt(e.occurredAt)} ${e.kind}${e.actorName ? ` (${e.actorName})` : ""}${detail ? `: ${detail}` : ""}`;
    }),
    "",
    fus.length ? "Follow-ups:" : "",
    ...fus.map((f) => `- [${f.priority ?? "—"}] ${f.f.title} (${f.f.status})`),
    "",
    runbooks.length ? "Runbooks of the affected service (documentation the workspace allows):" : "",
    ...runbooks,
    "",
    changes.length ? "Recent changes (24 h before → resolution):" : "",
    ...changes.map(
      (c) =>
        `- ${fmt(c.occurredAt)} ${c.kind} ${c.title}${c.serviceName ? ` [${c.serviceName}]` : ""}${c.actorName ? ` by ${c.actorName}` : ""}`,
    ),
  ];
  return {
    id: inc.id,
    number: inc.number,
    name: inc.name,
    visibility: inc.visibility,
    serviceEntryId: inc.serviceEntryId,
    declaredAt: inc.declaredAt,
    resolvedAt: inc.resolvedAt,
    text: lines
      .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
      .join("\n")
      .slice(0, 24_000),
  };
}

async function guarded<T>(
  tenantId: string,
  cap: AiCapability,
  work: () => Promise<T>,
): Promise<AiOutcome<T>> {
  const a = await aiAllowance(tenantId, cap);
  if (!a.ok) return a;
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[ai] ${cap} failed:`, err);
    return { ok: false, reason: "failed" };
  }
}

/** Declaration: a sharper title and a two-line summary from what the responder typed. */
export async function suggestDeclaration(
  tenantId: string,
  actor: Actor,
  input: { name: string; summary: string; serviceName: string | null },
): Promise<AiOutcome<{ title: string; summary: string }>> {
  return guarded(tenantId, "declare_suggest", () =>
    runCapability(tenantId, "declare_suggest", actor, null, async () => {
      const c = await ask(
        'TASK: declare. You help an on-call responder declare an incident. Answer with a JSON object {"title": string, "summary": string}: a title under 80 characters naming the symptom and the affected service, and a factual summary of at most two sentences. Never add a cause you were not given.',
        `Draft title: ${input.name}\nDraft summary: ${input.summary || "(none)"}\nAffected service: ${input.serviceName ?? "(unknown)"}`,
        { json: true, maxTokens: 300 },
      );
      const parsed = parseJson<{ title?: string; summary?: string }>(c.text);
      const result = {
        title: (parsed?.title ?? input.name).trim().slice(0, 200),
        summary: (parsed?.summary ?? input.summary).trim().slice(0, 1000),
      };
      return { result, model: c.model, inputTokens: c.inputTokens, outputTokens: c.outputTokens };
    }),
  );
}

/** The timeline in one paragraph, stored as the incident's AI summary and fed to the knowledge layer. */
export async function generateIncidentSummary(
  tenantId: string,
  actor: Actor,
  number: number,
): Promise<AiOutcome<string>> {
  return guarded(tenantId, "summary", async () => {
    const d = await withTenant(tenantId, (tx) => dossier(tx, tenantId, number));
    if (!d) throw new Error("incident_not_found");
    const text = await runCapability(tenantId, "summary", actor, d.id, async () => {
      const c = await ask(
        "TASK: summary. Summarise this incident's timeline for someone joining now: what broke, for whom, what has been done, where it stands. One paragraph, at most five sentences, plain prose, no headings.",
        d.text,
        { maxTokens: 400 },
      );
      return {
        result: c.text,
        model: c.model,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
      };
    });
    await withTenant(tenantId, (tx) =>
      tx
        .update(incidents)
        .set({ aiSummary: text, aiSummaryAt: new Date() })
        .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, d.id))),
    );
    await indexIncident(tenantId, d, text, actor);
    return text;
  });
}

/** Private incidents feed the knowledge layer only with the workspace's explicit opt-in. */
async function indexIncident(tenantId: string, d: Dossier, summary: string, actor: Actor) {
  if (d.visibility === "private") {
    const { getAiSettings } = await import("@openincident/ai");
    const s = await withTenant(tenantId, (tx) => getAiSettings(tx, tenantId));
    if (!s.privateOptIn) return;
  }
  await upsertAtlasDocument(
    tenantId,
    { source: "incident", refId: d.id, title: `INC-${d.number} — ${d.name}`, summary },
    actor,
  ).catch((err) => console.error("[ai] index incident failed:", err));
}

/** A change event enters the knowledge layer as soon as it is recorded. */
export async function indexChangeEvent(tenantId: string, id: string): Promise<void> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(changeEvents)
      .where(and(eq(changeEvents.tenantId, tenantId), eq(changeEvents.id, id))),
  );
  if (!row) return;
  await upsertAtlasDocument(
    tenantId,
    {
      source: "change_event",
      refId: row.id,
      title: row.title,
      summary: row.description ?? row.title,
    },
    { kind: "system", memberId: null, name: "system" },
  );
}

export type RelatedIncident = {
  number: number;
  name: string;
  phase: "triage" | "active" | "post_incident" | "closed";
  declaredAt: Date;
  score: number | null;
};

/**
 * Incidents that look like this one: by embeddings when this incident is in
 * the knowledge layer (no provider call on a page view), by title similarity
 * otherwise — the fallback says so with a null score.
 */
export async function relatedIncidents(
  tenantId: string,
  inc: { id: string; name: string; summary: string | null },
  limit = 3,
): Promise<{ items: RelatedIncident[]; method: "embeddings" | "text" | "off" }> {
  const allowance = await aiAllowance(tenantId, "related");
  if (!allowance.ok && allowance.reason !== "unconfigured") return { items: [], method: "off" };
  const byNumber = (
    rows: Array<{ id: string; number: number; name: string; phase: string; declaredAt: Date }>,
    scores: Map<string, number | null>,
  ) =>
    rows.map((r) => ({
      number: r.number,
      name: r.name,
      phase: r.phase as RelatedIncident["phase"],
      declaredAt: r.declaredAt,
      score: scores.get(r.id) ?? null,
    }));
  if (allowance.ok) {
    const docs = await withTenant(tenantId, (tx) =>
      tx
        .select({ refId: atlasDocuments.refId, embedding: atlasDocuments.embedding })
        .from(atlasDocuments)
        .where(and(eq(atlasDocuments.tenantId, tenantId), eq(atlasDocuments.source, "incident")))
        .orderBy(desc(atlasDocuments.updatedAt))
        .limit(2000),
    );
    const own = docs.find((d) => d.refId === inc.id)?.embedding;
    if (own) {
      const scored = docs
        .filter((d) => d.refId !== inc.id && d.embedding)
        .map((d) => ({ refId: d.refId, score: cosine(own, d.embedding!) }))
        .filter((d) => d.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      if (scored.length > 0) {
        const rows = await withTenant(tenantId, (tx) =>
          tx
            .select({
              id: incidents.id,
              number: incidents.number,
              name: incidents.name,
              phase: incidents.phase,
              declaredAt: incidents.declaredAt,
            })
            .from(incidents)
            .where(
              and(
                eq(incidents.tenantId, tenantId),
                inArray(
                  incidents.id,
                  scored.map((d) => d.refId),
                ),
                ne(incidents.mode, "test"),
              ),
            ),
        );
        const scores = new Map(scored.map((d) => [d.refId, d.score as number | null]));
        const items = byNumber(rows, scores).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        if (items.length > 0) return { items, method: "embeddings" };
      }
    }
  }
  const q = inc.name.trim();
  if (q.length < 3) return { items: [], method: "text" };
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: incidents.id,
        number: incidents.number,
        name: incidents.name,
        phase: incidents.phase,
        declaredAt: incidents.declaredAt,
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.tenantId, tenantId),
          ne(incidents.id, inc.id),
          ne(incidents.mode, "test"),
          isNull(incidents.mergedIntoId),
          sql`similarity(${incidents.name}, ${q}) > 0.3`,
        ),
      )
      .orderBy(sql`similarity(${incidents.name}, ${q}) desc`)
      .limit(limit),
  );
  return { items: byNumber(rows, new Map()), method: "text" };
}

/**
 * Puts an incident into the knowledge layer from its title and summary —
 * called after declaration and resolution, quietly; private incidents only
 * with the workspace's opt-in.
 */
export async function indexIncidentForKnowledge(
  tenantId: string,
  incidentId: string,
): Promise<void> {
  if (!embeddingsConfigured()) return;
  const allowance = await aiAllowance(tenantId, "related");
  if (!allowance.ok) return;
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: incidents.id,
        number: incidents.number,
        name: incidents.name,
        summary: incidents.summary,
        aiSummary: incidents.aiSummary,
        visibility: incidents.visibility,
        mode: incidents.mode,
      })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId))),
  );
  if (!row || row.mode === "test") return;
  const d: Dossier = {
    id: row.id,
    number: row.number,
    name: row.name,
    visibility: row.visibility,
    serviceEntryId: null,
    declaredAt: new Date(),
    resolvedAt: null,
    text: "",
  };
  await indexIncident(tenantId, d, row.aiSummary ?? row.summary ?? row.name, {
    kind: "system",
    memberId: null,
    name: "system",
  });
}

/** A status update in the incident's own words, from what happened since the last one. */
export async function draftUpdate(
  tenantId: string,
  actor: Actor,
  number: number,
): Promise<AiOutcome<string>> {
  return guarded(tenantId, "update_draft", async () => {
    const d = await withTenant(tenantId, (tx) => dossier(tx, tenantId, number));
    if (!d) throw new Error("incident_not_found");
    return runCapability(tenantId, "update_draft", actor, d.id, async () => {
      const c = await ask(
        "TASK: update_draft. Write the next status update for this incident, addressed to stakeholders who are not responders: current impact, what has been done since the last update, what happens next. Two to four sentences, no headings, no bullet points, no times other than those in the material.",
        d.text,
        { maxTokens: 300 },
      );
      return {
        result: c.text,
        model: c.model,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
      };
    });
  });
}

export type SuggestedFollowUp = { title: string; priority: "P1" | "P2" | "P3" };

/** Follow-ups the timeline calls for, not yet created; each becomes real only when a person clicks. */
export async function suggestFollowUps(
  tenantId: string,
  actor: Actor,
  number: number,
): Promise<AiOutcome<SuggestedFollowUp[]>> {
  return guarded(tenantId, "follow_ups", async () => {
    const d = await withTenant(tenantId, (tx) => dossier(tx, tenantId, number));
    if (!d) throw new Error("incident_not_found");
    return runCapability(tenantId, "follow_ups", actor, d.id, async () => {
      const c = await ask(
        'TASK: follow_ups. Propose at most four follow-up actions this incident calls for and that are not already listed under Follow-ups. Answer with a JSON array of {"title": string, "priority": "P1"|"P2"|"P3"} — P1 for what prevents recurrence, P3 for hygiene. Titles under 100 characters, imperative mood.',
        d.text,
        { json: false, maxTokens: 400 },
      );
      const parsed = parseJson<
        | Array<{ title?: string; priority?: string }>
        | { items?: Array<{ title?: string; priority?: string }> }
      >(c.text);
      const list = Array.isArray(parsed) ? parsed : (parsed?.items ?? []);
      const result: SuggestedFollowUp[] = list
        .filter((x) => typeof x.title === "string" && x.title.trim().length > 2)
        .slice(0, 4)
        .map((x) => ({
          title: x.title!.trim().slice(0, 200),
          priority: x.priority === "P1" || x.priority === "P3" ? x.priority : "P2",
        }));
      return { result, model: c.model, inputTokens: c.inputTokens, outputTokens: c.outputTokens };
    });
  });
}

export type PmSection = { key: string; title: string; body: string };
const PM_KEYS: Array<{ key: string; title: string }> = [
  { key: "summary", title: "Summary" },
  { key: "impact", title: "Impact" },
  { key: "timeline", title: "Timeline" },
  { key: "root_cause", title: "Root cause" },
  { key: "went_well", title: "What went well" },
  { key: "improve", title: "What to improve" },
];

/**
 * The post-mortem draft from the timeline — all sections, or one regenerated.
 * Written to the incident's post-mortem with the AI-drafted flag; the sections
 * stay editable by hand afterwards.
 */
export async function draftPostMortem(
  tenantId: string,
  actor: Actor,
  number: number,
  opts: { sectionKey?: string; titles?: Record<string, string> } = {},
): Promise<AiOutcome<PmSection[]>> {
  return guarded(tenantId, "post_mortem", async () => {
    const d = await withTenant(tenantId, (tx) => dossier(tx, tenantId, number));
    if (!d) throw new Error("incident_not_found");
    const [existing] = await withTenant(tenantId, (tx) =>
      tx.select().from(postMortems).where(eq(postMortems.incidentId, d.id)),
    );
    const current: PmSection[] = existing?.sections?.length
      ? existing.sections
      : PM_KEYS.map((k) => ({ ...k, title: opts.titles?.[k.key] ?? k.title, body: "" }));
    const wanted = opts.sectionKey ? current.filter((s) => s.key === opts.sectionKey) : current;
    if (wanted.length === 0) throw new Error("unknown_section");
    const sections = await runCapability(tenantId, "post_mortem", actor, d.id, async () => {
      const c = await ask(
        `TASK: post_mortem. Draft the post-mortem sections listed below from the incident material. Answer with a JSON object {"sections": [{"key": string, "body": string}]} — one entry per requested key, in order. Bodies in plain prose or "- " bullet lines, 2–6 sentences each; timelines as bullet lines with times from the material only. Where the material does not say, write what is unknown rather than guessing.\nRequested sections: ${wanted.map((s) => `${s.key} (${s.title})`).join(", ")}`,
        d.text,
        { json: true, maxTokens: 1400 },
      );
      const parsed = parseJson<{
        sections?: Array<{ key?: string; body?: string; title?: string }>;
      }>(c.text);
      const bodies = new Map(
        (parsed?.sections ?? [])
          .filter((s) => typeof s.key === "string")
          .map((s) => [s.key!, (s.body ?? "").trim()]),
      );
      const result = current.map((s) =>
        wanted.some((w) => w.key === s.key) && bodies.has(s.key)
          ? { ...s, body: bodies.get(s.key)! }
          : s,
      );
      return { result, model: c.model, inputTokens: c.inputTokens, outputTokens: c.outputTokens };
    });
    await withTenant(tenantId, async (tx) => {
      if (existing) {
        await tx
          .update(postMortems)
          .set({ sections, aiDrafted: existing.aiDrafted || !opts.sectionKey })
          .where(eq(postMortems.id, existing.id));
      } else {
        await tx.insert(postMortems).values({
          tenantId,
          incidentId: d.id,
          status: "in_progress",
          sections,
          aiDrafted: true,
          ownerMemberId: actor.memberId,
        });
      }
    });
    const summary = sections.find((s) => s.key === "summary")?.body;
    if (summary) {
      await upsertAtlasDocument(
        tenantId,
        { source: "post_mortem", refId: d.id, title: `INC-${d.number} — ${d.name}`, summary },
        actor,
      ).catch(() => {});
    }
    return sections;
  });
}
