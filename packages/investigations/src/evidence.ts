/**
 * The evidence, gathered check by check: the timeline, the alerts linked to
 * the incident, the changes recorded around it, the past incidents that look
 * like it (with the cause their post-mortem documented), the service's
 * runbooks, who owns the service, and what responders told the analysis.
 * Every item carries an id — `E3`, `A1`, `C2`… — the findings must cite.
 * Each source the workspace switched off is reported as skipped, not silently
 * absent.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  alertSources,
  alerts,
  catalogEntries,
  changeEvents,
  incidentEvents,
  incidents,
  members,
  postMortems,
  runbooks,
  severities,
  withTenant,
  type Citation,
  type InvestigationCheck,
  type InvestigationCheckKind,
  type InvestigationNote,
  type Tx,
} from "@openincident/db";
import {
  embeddingsConfigured,
  getAiSettings,
  similarDocuments,
  type Actor,
} from "@openincident/ai";

export type EvidenceItem = Citation & { body: string };

export type IncidentHead = {
  id: string;
  number: number;
  name: string;
  summary: string | null;
  severity: string | null;
  service: string | null;
  serviceEntryId: string | null;
  phase: string;
  declaredAt: Date;
  resolvedAt: Date | null;
  visibility: string;
  mode: string;
};

export type Evidence = {
  incident: IncidentHead;
  items: EvidenceItem[];
  checks: InvestigationCheck[];
  /** The material the model reads: header, then one section per check, items tagged [ID]. */
  text: string;
};

const DAY = 86_400_000;
const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
const clip = (s: string | null | undefined, n: number) =>
  (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

type Sources = { catalog: boolean; incidents: boolean; changeEvents: boolean; docs: boolean };

async function head(tx: Tx, tenantId: string, incidentId: string): Promise<IncidentHead | null> {
  const [row] = await tx
    .select({ inc: incidents, sevName: severities.name, serviceName: catalogEntries.name })
    .from(incidents)
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .leftJoin(catalogEntries, eq(catalogEntries.id, incidents.serviceEntryId))
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
  if (!row) return null;
  return {
    id: row.inc.id,
    number: row.inc.number,
    name: row.inc.name,
    summary: row.inc.summary,
    severity: row.sevName,
    service: row.serviceName,
    serviceEntryId: row.inc.serviceEntryId,
    phase: row.inc.phase,
    declaredAt: row.inc.declaredAt,
    resolvedAt: row.inc.resolvedAt,
    visibility: row.inc.visibility,
    mode: row.inc.mode,
  };
}

/** Runs one check, measures it, and turns a failure into a reported check rather than a lost run. */
async function timed(
  kind: InvestigationCheckKind,
  fn: () => Promise<EvidenceItem[] | "skipped">,
  skipNote: string | null = null,
): Promise<{ check: InvestigationCheck; items: EvidenceItem[] }> {
  const t0 = Date.now();
  try {
    const out = await fn();
    if (out === "skipped")
      return {
        check: { kind, status: "skipped", count: 0, ms: Date.now() - t0, note: skipNote },
        items: [],
      };
    return {
      check: { kind, status: "done", count: out.length, ms: Date.now() - t0, note: null },
      items: out,
    };
  } catch (err) {
    return {
      check: {
        kind,
        status: "failed",
        count: 0,
        ms: Date.now() - t0,
        note: err instanceof Error ? err.message.slice(0, 200) : String(err),
      },
      items: [],
    };
  }
}

async function timelineItems(tx: Tx, inc: IncidentHead, url: string): Promise<EvidenceItem[]> {
  const events = await tx
    .select()
    .from(incidentEvents)
    .where(eq(incidentEvents.incidentId, inc.id))
    .orderBy(asc(incidentEvents.occurredAt))
    .limit(150);
  return events
    .filter((e) => e.kind !== "investigation")
    .map((e, i) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const detail = [p.message, p.note, p.title, p.status, p.severity, p.to, p.role, p.name]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join(" — ");
      return {
        id: `E${i + 1}`,
        kind: "event" as const,
        label: `${fmt(e.occurredAt)} ${e.kind}`,
        url,
        body: `${fmt(e.occurredAt)} ${e.kind}${e.actorName ? ` (${e.actorName})` : ""}${detail ? `: ${clip(detail, 400)}` : ""}`,
      };
    });
}

async function alertItems(tx: Tx, inc: IncidentHead, url: string): Promise<EvidenceItem[]> {
  const rows = await tx
    .select({ a: alerts, sourceKind: alertSources.kind, sourceName: alertSources.name })
    .from(alerts)
    .innerJoin(alertSources, eq(alertSources.id, alerts.sourceId))
    .where(eq(alerts.incidentId, inc.id))
    .orderBy(asc(alerts.firstAt))
    .limit(12);
  return rows.map(({ a, sourceKind, sourceName }, i) => {
    const attrs = Object.entries(a.attributes ?? {})
      .slice(0, 8)
      .map(([k, v]) => `${k}=${clip(v, 60)}`)
      .join(", ");
    return {
      id: `A${i + 1}`,
      kind: "alert" as const,
      label: `alert · ${clip(a.title, 80)}`,
      url: a.externalUrl ?? url,
      body: `[${sourceKind}/${sourceName}] ${clip(a.title, 200)}${a.description ? ` — ${clip(a.description, 400)}` : ""} · ${a.status}${a.groupCount > 1 ? ` · grouped ×${a.groupCount}` : ""} · first ${fmt(a.firstAt)} · last ${fmt(a.lastAt)}${a.resolvedAt ? ` · resolved ${fmt(a.resolvedAt)}` : ""}${attrs ? ` · ${attrs}` : ""}`,
    };
  });
}

async function changeItems(tx: Tx, tenantId: string, inc: IncidentHead): Promise<EvidenceItem[]> {
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
          ? or(
              eq(changeEvents.serviceEntryId, inc.serviceEntryId),
              isNull(changeEvents.serviceEntryId),
            )
          : sql`true`,
      ),
    )
    .orderBy(desc(changeEvents.occurredAt))
    .limit(12);
  return rows.map(({ ev, serviceName }, i) => ({
    id: `C${i + 1}`,
    kind: "change" as const,
    label: `${ev.kind} · ${clip(ev.title, 80)}`,
    url: ev.externalRef,
    body: `${fmt(ev.occurredAt)} ${ev.kind} ${clip(ev.title, 200)}${serviceName ? ` [${serviceName}]` : " [no service]"}${ev.environment ? ` (${ev.environment})` : ""}${ev.actorName ? ` by ${ev.actorName}` : ""}${ev.description ? ` — ${clip(ev.description, 300)}` : ""}`,
  }));
}

async function similarItems(
  tx: Tx,
  tenantId: string,
  inc: IncidentHead,
  origin: string,
  actor: Actor,
): Promise<EvidenceItem[]> {
  let ids: { id: string; score: number | null }[] = [];
  if (embeddingsConfigured()) {
    const docs = await similarDocuments(
      tenantId,
      `${inc.name}\n${inc.summary ?? ""}`,
      { source: "incident", excludeRefId: inc.id, limit: 4 },
      actor,
    );
    ids = docs.map((d) => ({ id: d.refId, score: d.score }));
  }
  if (ids.length === 0 && inc.name.trim().length >= 3) {
    const rows = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(
        and(
          eq(incidents.tenantId, tenantId),
          ne(incidents.id, inc.id),
          ne(incidents.mode, "test"),
          isNull(incidents.mergedIntoId),
          sql`similarity(${incidents.name}, ${inc.name.trim()}) > 0.3`,
        ),
      )
      .orderBy(sql`similarity(${incidents.name}, ${inc.name.trim()}) desc`)
      .limit(4);
    ids = rows.map((r) => ({ id: r.id, score: null }));
  }
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ inc: incidents, pm: postMortems.sections })
    .from(incidents)
    .leftJoin(postMortems, eq(postMortems.incidentId, incidents.id))
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        inArray(
          incidents.id,
          ids.map((x) => x.id),
        ),
        ne(incidents.mode, "test"),
      ),
    );
  const order = new Map(ids.map((x, i) => [x.id, i]));
  return rows
    .sort((a, b) => (order.get(a.inc.id) ?? 99) - (order.get(b.inc.id) ?? 99))
    .map(({ inc: past, pm }, i) => {
      const score = ids.find((x) => x.id === past.id)?.score;
      const cause = (pm ?? []).find((s) => s.key === "root_cause")?.body;
      const duration = past.resolvedAt
        ? `${Math.round((past.resolvedAt.getTime() - past.declaredAt.getTime()) / 60_000)} min`
        : "unresolved";
      return {
        id: `S${i + 1}`,
        kind: "incident" as const,
        label: `INC-${past.number} · ${clip(past.name, 70)}`,
        url: `${origin}/app/incidents/${past.number}`,
        body: `INC-${past.number} — ${clip(past.name, 160)} · declared ${fmt(past.declaredAt)} · ${duration}${score !== null && score !== undefined ? ` · similarity ${score.toFixed(2)}` : ""}${past.aiSummary || past.summary ? ` · ${clip(past.aiSummary ?? past.summary, 300)}` : ""}${cause ? ` · documented root cause: ${clip(cause, 500)}` : " · no documented root cause"}`,
      };
    });
}

async function runbookItems(tx: Tx, tenantId: string, inc: IncidentHead): Promise<EvidenceItem[]> {
  const rows = await tx
    .select()
    .from(runbooks)
    .where(
      and(
        eq(runbooks.tenantId, tenantId),
        inc.serviceEntryId
          ? or(eq(runbooks.serviceEntryId, inc.serviceEntryId), isNull(runbooks.serviceEntryId))
          : isNull(runbooks.serviceEntryId),
        ne(runbooks.content, ""),
      ),
    )
    .orderBy(desc(runbooks.updatedAt))
    .limit(4);
  return rows.map((r, i) => ({
    id: `R${i + 1}`,
    kind: "runbook" as const,
    label: `runbook · ${clip(r.title, 80)}`,
    url: r.sourceUrl,
    body: `${clip(r.title, 120)}: ${clip(r.content, 1500)}`,
  }));
}

async function ownershipItems(
  tx: Tx,
  tenantId: string,
  inc: IncidentHead,
  origin: string,
): Promise<EvidenceItem[]> {
  if (!inc.serviceEntryId) return [];
  const [service] = await tx
    .select()
    .from(catalogEntries)
    .where(and(eq(catalogEntries.tenantId, tenantId), eq(catalogEntries.id, inc.serviceEntryId)));
  if (!service) return [];
  const attrs = service.attributes ?? {};
  const parts: string[] = [];
  const ownerId = typeof attrs.owner === "string" ? attrs.owner : null;
  let ownerName: string | null = null;
  if (ownerId) {
    const [team] = await tx
      .select()
      .from(catalogEntries)
      .where(and(eq(catalogEntries.tenantId, tenantId), eq(catalogEntries.id, ownerId)));
    if (team) {
      ownerName = team.name;
      const memberIds = Array.isArray(team.attributes?.members)
        ? (team.attributes.members as unknown[]).filter((m): m is string => typeof m === "string")
        : [];
      const names =
        memberIds.length > 0
          ? (
              await tx
                .select({ name: members.name })
                .from(members)
                .where(
                  and(eq(members.tenantId, tenantId), inArray(members.id, memberIds.slice(0, 12))),
                )
            ).map((m) => m.name)
          : [];
      parts.push(
        `Service ${service.name} is owned by team ${team.name}${names.length ? ` (members: ${names.slice(0, 6).join(", ")})` : ""}.`,
      );
    }
  }
  if (!ownerName) parts.push(`Service ${service.name} has no owner team recorded in the catalog.`);
  for (const key of ["tier", "repository", "environments", "escalation_path"]) {
    const v = attrs[key];
    if (typeof v === "string" && v) parts.push(`${key}: ${clip(v, 120)}.`);
  }
  if (service.description) parts.push(clip(service.description, 300));
  return [
    {
      id: "O1",
      kind: "owner",
      label: `owner · ${ownerName ?? service.name}`,
      url: `${origin}/app/catalog?entry=${encodeURIComponent(service.name)}`,
      body: parts.join(" "),
    },
  ];
}

function noteItems(notes: InvestigationNote[]): EvidenceItem[] {
  return notes.slice(-8).map((n, i) => ({
    id: `N${i + 1}`,
    kind: "note" as const,
    label: `note · ${n.memberName}`,
    url: null,
    body: `${n.at.slice(0, 16).replace("T", " ")} ${n.memberName}: ${clip(n.body, 800)}`,
  }));
}

const SECTION_CAP: Record<InvestigationCheckKind, number> = {
  timeline: 9000,
  alerts: 4000,
  changes: 3500,
  similar_incidents: 4500,
  runbooks: 6500,
  ownership: 1200,
  notes: 2500,
};

const SECTION_TITLE: Record<InvestigationCheckKind, string> = {
  timeline: "Timeline of this incident",
  alerts: "Alerts linked to this incident",
  changes:
    "Changes recorded in the day before the incident and since (the affected service, or unscoped)",
  similar_incidents: "Past incidents that look like this one",
  runbooks: "Runbooks of the affected service",
  ownership: "Ownership",
  notes: "What responders told this analysis",
};

/**
 * Everything the analysis may read about one incident, with the checks that
 * produced it. Sources the workspace switched off are reported as skipped.
 */
export async function gatherEvidence(
  tenantId: string,
  incidentId: string,
  notes: InvestigationNote[],
  actor: Actor,
  origin: string,
): Promise<Evidence | null> {
  return withTenant(tenantId, async (tx) => {
    const inc = await head(tx, tenantId, incidentId);
    if (!inc) return null;
    const settings = await getAiSettings(tx, tenantId);
    const sources: Sources = settings.sources;
    const url = `${origin}/app/incidents/${inc.number}`;
    const off = "source switched off in the workspace's AI governance";

    const results = [
      await timed("timeline", () => timelineItems(tx, inc, url)),
      await timed("alerts", () => alertItems(tx, inc, url)),
      await timed(
        "changes",
        () => (sources.changeEvents ? changeItems(tx, tenantId, inc) : Promise.resolve("skipped")),
        off,
      ),
      await timed(
        "similar_incidents",
        () =>
          sources.incidents
            ? similarItems(tx, tenantId, inc, origin, actor)
            : Promise.resolve("skipped"),
        off,
      ),
      await timed(
        "runbooks",
        () => (sources.docs ? runbookItems(tx, tenantId, inc) : Promise.resolve("skipped")),
        off,
      ),
      await timed(
        "ownership",
        () =>
          sources.catalog ? ownershipItems(tx, tenantId, inc, origin) : Promise.resolve("skipped"),
        off,
      ),
      await timed("notes", () => Promise.resolve(noteItems(notes))),
    ];
    const items = results.flatMap((r) => r.items);
    const checks = results.map((r) => r.check);

    const lines: string[] = [
      `INC-${inc.number} — ${inc.name}`,
      `Severity: ${inc.severity ?? "—"} · Service: ${inc.service ?? "—"} · Phase: ${inc.phase} · Declared: ${fmt(inc.declaredAt)}${inc.resolvedAt ? ` · Resolved: ${fmt(inc.resolvedAt)}` : " · not resolved"}`,
      inc.summary ? `Summary: ${clip(inc.summary, 800)}` : "",
    ];
    for (const r of results) {
      lines.push("", `## ${SECTION_TITLE[r.check.kind]}`);
      if (r.check.status === "skipped")
        lines.push(`(skipped — ${r.check.note ?? "not available"})`);
      else if (r.check.status === "failed")
        lines.push(`(could not be read: ${r.check.note ?? "error"})`);
      else if (r.items.length === 0) lines.push("(nothing recorded)");
      else {
        let budget = SECTION_CAP[r.check.kind];
        for (const it of r.items) {
          const line = `[${it.id}] ${it.body}`;
          if (budget - line.length < 0) break;
          budget -= line.length;
          lines.push(line);
        }
      }
    }
    return { incident: inc, items, checks, text: lines.join("\n").slice(0, 32_000) };
  });
}
