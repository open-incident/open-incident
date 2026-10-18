/**
 * Services — what the product runs, as it learns they exist.
 *
 * Nothing is declared here. A service appears the first time a signal names it
 * (an alert label, a monitor, a span) and waits in "seen in traffic" until
 * someone gives it an owner. That single click is the whole configuration:
 * from then on, an alert naming the service pages the owner team's policy, and
 * no rule and no schema were needed to get there.
 *
 * Two names of one thing — `storefront` in the traces, `web-storefront` in the
 * alerts — are merged rather than renamed: the merged name keeps its row (so a
 * signal carrying it is still recognised) and points at the service it now
 * counts for. Every read below folds those names into their service.
 */

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  alertSources,
  alerts,
  changeEvents,
  escalationPaths,
  incidents,
  members,
  monitors,
  postMortems,
  serviceLinks,
  services,
  statusPageComponents,
  statusPages,
  teamMembers,
  teams,
  type Tx,
} from "@openincident/db";

const DAY = 86_400_000;

export type ServiceState = "online" | "degraded" | "offline" | "unknown";

export type ServiceRow = {
  id: string;
  key: string;
  name: string | null;
  ownerTeamId: string | null;
  ownerTeamName: string | null;
  labels: Record<string, string>;
  confirmed: boolean;
  seenIn: string[];
  lastSeenAt: Date | null;
  telemetryLastSeenAt: Date | null;
  /** The other names merged into this service. */
  aliases: string[];
  incidents90d: number;
  /** Worst state among the monitors watching it — the dot on the row. */
  state: ServiceState;
};

/** Where a service was seen, counted — "Datadog ×12 · Grafana ×3 · 1 monitor". */
export type Sightings = {
  sources: Array<{ name: string; count: number; lastAt: Date }>;
  monitors: number;
  monitorsWaiting: number;
  /** The most recent check of a monitor on it, and the monitor's type. */
  lastCheck: { at: Date; type: string } | null;
  traces: boolean;
};

/** The most recent signal that named a service, and where it came from. */
export type LastSignal = { at: Date; kind: "alert" | "monitor" | "traces"; where: string };

/**
 * Records that a signal named this service.
 *
 * Idempotent and cheap: it is called on every ingested alert, so it writes the
 * name once and then only moves `last_seen_at` and the places it was seen. A
 * name merged into another service answers with that service's id, so a
 * monitor or an SLO created on the old name lands on the service it belongs to.
 */
export async function observeService(
  tx: Tx,
  tenantId: string,
  key: string,
  seenIn: string,
  now = new Date(),
): Promise<string | null> {
  const clean = key.trim().toLowerCase();
  if (!clean || clean.length > 120) return null;
  const [row] = await tx
    .insert(services)
    .values({ tenantId, key: clean, seenIn: [seenIn], lastSeenAt: now })
    .onConflictDoUpdate({
      target: [services.tenantId, services.key],
      set: {
        lastSeenAt: now,
        updatedAt: now,
        // Keeps the list of places short and stable: a set, capped.
        seenIn: sql`(
          select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
          from (
            select jsonb_array_elements_text(${services.seenIn}) as v
            union select ${seenIn}
            limit 12
          ) s
        )`,
      },
    })
    .returning({ id: services.id, mergedIntoId: services.mergedIntoId });
  return row ? (row.mergedIntoId ?? row.id) : null;
}

const STATE_RANK = { offline: 3, degraded: 2, online: 1 } as const;

/** Worst state per service among the monitors that are actually checking. */
function worstStates(rows: Array<{ serviceId: string | null; state: string }>) {
  const worst = new Map<string, ServiceState>();
  for (const m of rows) {
    if (!m.serviceId) continue;
    if (m.state !== "offline" && m.state !== "degraded" && m.state !== "online") continue;
    const cur = worst.get(m.serviceId);
    if (
      !cur ||
      cur === "unknown" ||
      STATE_RANK[m.state] > STATE_RANK[cur as keyof typeof STATE_RANK]
    )
      worst.set(m.serviceId, m.state);
  }
  return worst;
}

/** Every service (merged names folded in), with its owner, its recent incidents and its monitors' state. */
export async function listServices(tx: Tx, tenantId: string): Promise<ServiceRow[]> {
  const rows = await tx
    .select({
      id: services.id,
      key: services.key,
      name: services.name,
      ownerTeamId: services.ownerTeamId,
      ownerTeamName: teams.name,
      labels: services.labels,
      confirmed: services.confirmed,
      seenIn: services.seenIn,
      lastSeenAt: services.lastSeenAt,
      telemetryLastSeenAt: services.telemetryLastSeenAt,
    })
    .from(services)
    .leftJoin(teams, eq(teams.id, services.ownerTeamId))
    .where(and(eq(services.tenantId, tenantId), isNull(services.mergedIntoId)))
    .orderBy(desc(services.confirmed), asc(services.key));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const merged = await tx
    .select({
      key: services.key,
      into: services.mergedIntoId,
      lastSeenAt: services.lastSeenAt,
      telemetryLastSeenAt: services.telemetryLastSeenAt,
    })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), isNotNull(services.mergedIntoId)));
  const aliasesOf = new Map<string, typeof merged>();
  for (const m of merged) {
    if (!m.into) continue;
    aliasesOf.set(m.into, [...(aliasesOf.get(m.into) ?? []), m]);
  }

  const since = new Date(Date.now() - 90 * DAY);
  const counts = await tx
    .select({ serviceId: incidents.serviceId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        inArray(incidents.serviceId, ids),
        ne(incidents.mode, "test"),
        isNull(incidents.mergedIntoId),
        sql`${incidents.declaredAt} >= ${since.toISOString()}::timestamptz`,
      ),
    )
    .groupBy(incidents.serviceId);
  const byService = new Map(counts.map((c) => [c.serviceId, c.n]));

  const mons = await tx
    .select({ serviceId: monitors.serviceId, state: monitors.state })
    .from(monitors)
    .where(and(eq(monitors.tenantId, tenantId), inArray(monitors.serviceId, ids)));
  // An incident still being fought is the service down; an alert still
  // firing on it is the service degraded — whatever its monitors say.
  const active = await tx
    .select({ serviceId: incidents.serviceId })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        inArray(incidents.serviceId, ids),
        eq(incidents.phase, "active"),
        ne(incidents.mode, "test"),
      ),
    );
  const nameToId = new Map<string, string>(rows.map((r) => [r.key, r.id]));
  for (const m of merged) if (m.into) nameToId.set(m.key, m.into);
  const firing = await tx
    .select({ service: sql<string>`lower(${alerts.attributes} ->> 'service')` })
    .from(alerts)
    .where(
      and(
        eq(alerts.tenantId, tenantId),
        eq(alerts.status, "firing"),
        eq(alerts.testMode, false),
        inArray(sql`lower(${alerts.attributes} ->> 'service')`, [...nameToId.keys()]),
      ),
    );
  const worst = worstStates([
    ...mons,
    ...firing.map((f) => ({ serviceId: nameToId.get(f.service) ?? null, state: "degraded" })),
    ...active.map((a) => ({ serviceId: a.serviceId, state: "offline" })),
  ]);

  const latest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);
  const dayAgo = Date.now() - DAY;
  return rows.map((r) => {
    const al = aliasesOf.get(r.id) ?? [];
    const lastSeenAt = al.reduce((d, m) => latest(d, m.lastSeenAt), r.lastSeenAt);
    const telemetryLastSeenAt = al.reduce(
      (d, m) => latest(d, m.telemetryLastSeenAt),
      r.telemetryLastSeenAt,
    );
    const heard = latest(lastSeenAt, telemetryLastSeenAt);
    return {
      ...r,
      lastSeenAt,
      telemetryLastSeenAt,
      aliases: al.map((m) => m.key),
      incidents90d: byService.get(r.id) ?? 0,
      // Nothing wrong and heard from in the last day reads as healthy; never
      // heard from, or silent for a day, stays grey — unknown, not fine.
      state: worst.get(r.id) ?? (heard && heard.getTime() > dayAgo ? "online" : "unknown"),
    };
  });
}

/**
 * How each service was seen: the alert sources that named it (all names merged
 * into it included), the monitors on it, and whether a trace carried it.
 */
export async function sightingsOf(
  tx: Tx,
  tenantId: string,
  rows: Array<Pick<ServiceRow, "id" | "key" | "aliases" | "telemetryLastSeenAt">>,
): Promise<Map<string, Sightings>> {
  const out = new Map<string, Sightings>();
  if (rows.length === 0) return out;
  const ownerOfName = new Map<string, string>();
  for (const r of rows) {
    ownerOfName.set(r.key, r.id);
    for (const a of r.aliases) ownerOfName.set(a, r.id);
  }
  const names = [...ownerOfName.keys()];
  const bySource = await tx
    .select({
      service: sql<string>`lower(${alerts.attributes} ->> 'service')`,
      source: alertSources.name,
      n: sql<number>`count(*)`.mapWith(Number),
      lastAt: sql<Date>`max(${alerts.lastAt})`.mapWith((v: string | Date) => new Date(v)),
    })
    .from(alerts)
    .innerJoin(alertSources, eq(alertSources.id, alerts.sourceId))
    .where(
      and(
        eq(alerts.tenantId, tenantId),
        eq(alerts.testMode, false),
        inArray(sql`lower(${alerts.attributes} ->> 'service')`, names),
      ),
    )
    .groupBy(sql`lower(${alerts.attributes} ->> 'service')`, alertSources.name);
  const mons = await tx
    .select({
      serviceId: monitors.serviceId,
      state: monitors.state,
      type: monitors.type,
      lastCheckAt: monitors.lastCheckAt,
    })
    .from(monitors)
    .where(
      and(
        eq(monitors.tenantId, tenantId),
        inArray(
          monitors.serviceId,
          rows.map((r) => r.id),
        ),
      ),
    );

  for (const r of rows) {
    const sources = new Map<string, { count: number; lastAt: Date }>();
    for (const s of bySource) {
      if (ownerOfName.get(s.service) !== r.id) continue;
      const cur = sources.get(s.source);
      sources.set(s.source, {
        count: (cur?.count ?? 0) + s.n,
        lastAt: cur && cur.lastAt > s.lastAt ? cur.lastAt : s.lastAt,
      });
    }
    const mine = mons.filter((m) => m.serviceId === r.id);
    const checked = mine
      .filter((m) => m.lastCheckAt)
      .sort((a, b) => b.lastCheckAt!.getTime() - a.lastCheckAt!.getTime())[0];
    out.set(r.id, {
      sources: [...sources.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.count - a.count),
      monitors: mine.length,
      monitorsWaiting: mine.filter((m) => m.state === "waiting" && !m.lastCheckAt).length,
      lastCheck: checked ? { at: checked.lastCheckAt!, type: checked.type } : null,
      traces: Boolean(r.telemetryLastSeenAt),
    });
  }
  return out;
}

/** The freshest of the three kinds of signal, and its origin. */
export function lastSignalOf(
  row: Pick<ServiceRow, "lastSeenAt" | "telemetryLastSeenAt">,
  seen: Sightings | undefined,
): LastSignal | null {
  const candidates: LastSignal[] = [];
  const alert = seen?.sources.slice().sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())[0];
  if (alert) candidates.push({ at: alert.lastAt, kind: "alert", where: alert.name });
  if (seen?.lastCheck)
    candidates.push({ at: seen.lastCheck.at, kind: "monitor", where: seen.lastCheck.type });
  if (row.telemetryLastSeenAt)
    candidates.push({ at: row.telemetryLastSeenAt, kind: "traces", where: "" });
  candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
  return candidates[0] ?? null;
}

export type OwnerSuggestion =
  | { teamId: string; teamName: string; why: "ack"; count: number }
  | { teamId: string; teamName: string; why: "calls" | "calledBy"; other: string }
  | { teamId: string; teamName: string; why: "prefix" | "repo"; other: string };

/** An observed call between two names, from the traces. */
export type ObservedEdge = { source: string; target: string; calls: number };

const prefixOf = (key: string) => {
  const head = key.split(/[-._/]/)[0] ?? "";
  return head.length >= 3 ? head : null;
};

/**
 * Which team most likely owns a service nobody has claimed.
 *
 * Read from what actually happened, strongest evidence first: the team whose
 * members acknowledged this service's alerts; then the owner of the service it
 * talks to most in the traces; then an owned service sharing its repository or
 * its name's first word. It is a suggestion, never an assignment, and when no
 * evidence exists there is no suggestion at all — a guess with nothing behind
 * it is worse than an empty space.
 */
export async function ownerSuggestions(
  tx: Tx,
  tenantId: string,
  unowned: Array<Pick<ServiceRow, "key" | "aliases" | "labels">>,
  owned: Array<Pick<ServiceRow, "key" | "aliases" | "labels" | "ownerTeamId" | "ownerTeamName">>,
  edges: ObservedEdge[] = [],
): Promise<Map<string, OwnerSuggestion>> {
  const out = new Map<string, OwnerSuggestion>();
  if (unowned.length === 0) return out;
  const nameToKey = new Map<string, string>();
  for (const u of unowned) {
    nameToKey.set(u.key, u.key);
    for (const a of u.aliases) nameToKey.set(a, u.key);
  }
  const rows = await tx
    .select({
      service: sql<string>`lower(${alerts.attributes} ->> 'service')`,
      teamId: teamMembers.teamId,
      teamName: teams.name,
      n: sql<number>`count(distinct ${members.id})`.mapWith(Number),
    })
    .from(alerts)
    .innerJoin(members, eq(members.id, alerts.ackedByMemberId))
    .innerJoin(teamMembers, eq(teamMembers.memberId, members.id))
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(alerts.tenantId, tenantId),
        // `inArray`, not `= any(...)`: drizzle interpolates a JavaScript array
        // into a row constructor, and Postgres refuses `= any((a, b, c))` with
        // "op ANY/ALL (array) requires array on right side".
        inArray(sql`lower(${alerts.attributes} ->> 'service')`, [...nameToKey.keys()]),
      ),
    )
    .groupBy(sql`lower(${alerts.attributes} ->> 'service')`, teamMembers.teamId, teams.name)
    .orderBy(desc(sql`count(distinct ${members.id})`));
  for (const r of rows) {
    const key = nameToKey.get(r.service);
    if (!key || out.has(key)) continue;
    out.set(key, { teamId: r.teamId, teamName: r.teamName, why: "ack", count: r.n });
  }

  const ownerByName = new Map<string, { teamId: string; teamName: string; key: string }>();
  for (const o of owned) {
    if (!o.ownerTeamId || !o.ownerTeamName) continue;
    const v = { teamId: o.ownerTeamId, teamName: o.ownerTeamName, key: o.key };
    ownerByName.set(o.key, v);
    for (const a of o.aliases) ownerByName.set(a, v);
  }

  for (const u of unowned) {
    if (out.has(u.key)) continue;
    const names = new Set([u.key, ...u.aliases]);
    // The neighbour with the most calls, either way round.
    let best: {
      calls: number;
      other: string;
      teamId: string;
      teamName: string;
      dir: "calls" | "calledBy";
    } | null = null;
    for (const e of edges) {
      const mineIsSource = names.has(e.source);
      const mineIsTarget = names.has(e.target);
      if (mineIsSource === mineIsTarget) continue;
      const otherName = mineIsSource ? e.target : e.source;
      const owner = ownerByName.get(otherName);
      if (!owner) continue;
      if (!best || e.calls > best.calls)
        best = {
          calls: e.calls,
          other: owner.key,
          teamId: owner.teamId,
          teamName: owner.teamName,
          dir: mineIsSource ? "calls" : "calledBy",
        };
    }
    if (best) {
      out.set(u.key, {
        teamId: best.teamId,
        teamName: best.teamName,
        why: best.dir,
        other: best.other,
      });
      continue;
    }
    const repo = u.labels.repo ?? u.labels.repository;
    const sameRepo = repo
      ? owned.find((o) => o.ownerTeamId && (o.labels.repo ?? o.labels.repository) === repo)
      : undefined;
    if (sameRepo?.ownerTeamId && sameRepo.ownerTeamName) {
      out.set(u.key, {
        teamId: sameRepo.ownerTeamId,
        teamName: sameRepo.ownerTeamName,
        why: "repo",
        other: sameRepo.key,
      });
      continue;
    }
    const head = prefixOf(u.key);
    const samePrefix = head
      ? owned.find((o) => o.ownerTeamId && o.key !== u.key && prefixOf(o.key) === head)
      : undefined;
    if (samePrefix?.ownerTeamId && samePrefix.ownerTeamName) {
      out.set(u.key, {
        teamId: samePrefix.ownerTeamId,
        teamName: samePrefix.ownerTeamName,
        why: "prefix",
        other: samePrefix.key,
      });
    }
  }
  return out;
}

/** The teams a service can be handed to, with the policy each one pages. */
export async function listTeams(tx: Tx, tenantId: string) {
  return tx
    .select({
      id: teams.id,
      name: teams.name,
      policyPathId: teams.policyPathId,
      policyName: escalationPaths.name,
      chatChannel: teams.chatChannel,
    })
    .from(teams)
    .leftJoin(escalationPaths, eq(escalationPaths.id, teams.policyPathId))
    .where(eq(teams.tenantId, tenantId))
    .orderBy(asc(teams.name));
}

/** The teams a member belongs to — "Platform" beside the suggestion is the reader's own team. */
export async function teamsOfMember(tx: Tx, tenantId: string, memberId: string) {
  return tx
    .select({ id: teams.id, name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teams.tenantId, tenantId), eq(teamMembers.memberId, memberId)))
    .orderBy(asc(teams.name));
}

/**
 * One service, everything its page shows. A merged name answers with the
 * service it was merged into, so an old link still lands somewhere true.
 */
export async function getService(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select({
      id: services.id,
      key: services.key,
      name: services.name,
      ownerTeamId: services.ownerTeamId,
      ownerTeamName: teams.name,
      ownerPolicyName: escalationPaths.name,
      ownerChannel: teams.chatChannel,
      labels: services.labels,
      confirmed: services.confirmed,
      seenIn: services.seenIn,
      firstSeenAt: services.firstSeenAt,
      lastSeenAt: services.lastSeenAt,
      telemetryLastSeenAt: services.telemetryLastSeenAt,
      mergedIntoId: services.mergedIntoId,
    })
    .from(services)
    .leftJoin(teams, eq(teams.id, services.ownerTeamId))
    .leftJoin(escalationPaths, eq(escalationPaths.id, teams.policyPathId))
    .where(and(eq(services.tenantId, tenantId), eq(services.id, id)));
  if (!row) return null;
  if (row.mergedIntoId) return { mergedInto: row.mergedIntoId } as const;

  const aliasRows = await tx
    .select({ key: services.key, telemetryLastSeenAt: services.telemetryLastSeenAt })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.mergedIntoId, row.id)))
    .orderBy(asc(services.key));
  const aliases = aliasRows.map((a) => a.key);
  const names = [row.key, ...aliases];
  const nameMatch = inArray(sql`lower(${alerts.attributes} ->> 'service')`, names);

  const since7 = new Date(Date.now() - 7 * DAY);
  const since90 = new Date(Date.now() - 90 * DAY);
  const alertRows = await tx
    .select({
      source: alertSources.name,
      n: sql<number>`count(*)`.mapWith(Number),
      paged: sql<number>`count(*) filter (where ${alerts.escalationId} is not null)`.mapWith(
        Number,
      ),
    })
    .from(alerts)
    .innerJoin(alertSources, eq(alertSources.id, alerts.sourceId))
    .where(
      and(
        eq(alerts.tenantId, tenantId),
        eq(alerts.testMode, false),
        nameMatch,
        gte(alerts.firstAt, since7),
      ),
    )
    .groupBy(alertSources.name)
    .orderBy(desc(sql`count(*)`));

  const incidentWhere = and(
    eq(incidents.tenantId, tenantId),
    eq(incidents.serviceId, row.id),
    ne(incidents.mode, "test"),
    isNull(incidents.mergedIntoId),
    gte(incidents.declaredAt, since90),
  );
  const [incidentCount] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(incidents)
    .where(incidentWhere);
  const incidentRows = await tx
    .select({ number: incidents.number, name: incidents.name })
    .from(incidents)
    .where(incidentWhere)
    .orderBy(desc(incidents.declaredAt))
    .limit(3);

  const monitorRows = await tx
    .select({
      id: monitors.id,
      name: monitors.name,
      type: monitors.type,
      state: monitors.state,
      lastLatencyMs: monitors.lastLatencyMs,
      lastCheckAt: monitors.lastCheckAt,
    })
    .from(monitors)
    .where(and(eq(monitors.tenantId, tenantId), eq(monitors.serviceId, row.id)))
    .orderBy(asc(monitors.name));

  const pages = await tx
    .select({ page: statusPages.name, component: statusPageComponents.name })
    .from(statusPageComponents)
    .innerJoin(statusPages, eq(statusPages.id, statusPageComponents.pageId))
    .where(
      and(eq(statusPageComponents.tenantId, tenantId), eq(statusPageComponents.serviceId, row.id)),
    )
    .orderBy(asc(statusPages.name));

  const sightings = (
    await sightingsOf(tx, tenantId, [
      {
        id: row.id,
        key: row.key,
        aliases,
        telemetryLastSeenAt:
          row.telemetryLastSeenAt ??
          aliasRows.find((a) => a.telemetryLastSeenAt)?.telemetryLastSeenAt ??
          null,
      },
    ])
  ).get(row.id)!;

  return {
    ...row,
    mergedInto: null,
    aliases,
    alerts7d: alertRows.reduce((n, r) => n + r.n, 0),
    alertsPaged7d: alertRows.reduce((n, r) => n + r.paged, 0),
    alertsBySource7d: alertRows.map((r) => ({ name: r.source, count: r.n })),
    incidents90d: incidentCount?.n ?? 0,
    incidents: incidentRows,
    monitors: monitorRows,
    statusPages: pages,
    sightings,
  };
}

export type ServiceDetail = Extract<
  NonNullable<Awaited<ReturnType<typeof getService>>>,
  { mergedInto: null }
>;

/** The services another one could be merged with. */
export async function mergeCandidates(tx: Tx, tenantId: string, exceptId: string) {
  return tx
    .select({ id: services.id, key: services.key, confirmed: services.confirmed })
    .from(services)
    .where(
      and(
        eq(services.tenantId, tenantId),
        isNull(services.mergedIntoId),
        ne(services.id, exceptId),
      ),
    )
    .orderBy(desc(services.confirmed), asc(services.key));
}

/* ---------- Context: what the workspace's own records say about a service ---------- */

export type ContextFact =
  | { kind: "changes"; other: string; incidents: number[] }
  | { kind: "rootCause"; incident: number; excerpt: string }
  | { kind: "resolve"; mine: number; all: number; count: number };

export type ContextCite = { label: "timeline" | "postMortem"; incident: number };

/** Two hours: a change further back than that is rarely what an incident followed. */
const CHANGE_WINDOW_MS = 2 * 3_600_000;

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * What the records say about this service, each statement with its source.
 *
 * Three readings, all from rows: the changes its incidents followed (a deploy,
 * a flag, a config push within the two hours before), the root cause its last
 * post-mortem wrote down, and how fast its incidents resolve against the rest
 * of the workspace. Nothing is generated; a reading with no rows behind it is
 * left out rather than padded.
 */
export async function serviceContext(
  tx: Tx,
  tenantId: string,
  serviceId: string,
): Promise<{ facts: ContextFact[]; cites: ContextCite[] }> {
  const since = new Date(Date.now() - 180 * DAY);
  const mine = await tx
    .select({
      id: incidents.id,
      number: incidents.number,
      declaredAt: incidents.declaredAt,
      resolvedAt: incidents.resolvedAt,
    })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        eq(incidents.serviceId, serviceId),
        ne(incidents.mode, "test"),
        isNull(incidents.mergedIntoId),
        gte(incidents.declaredAt, since),
      ),
    )
    .orderBy(desc(incidents.declaredAt));
  const facts: ContextFact[] = [];
  const cites: ContextCite[] = [];
  if (mine.length === 0) return { facts, cites };

  // Changes in the window before each incident, grouped by the service changed.
  const earliest = new Date(
    Math.min(...mine.map((i) => i.declaredAt.getTime())) - CHANGE_WINDOW_MS,
  );
  const changes = await tx
    .select({ at: changeEvents.occurredAt, serviceKey: services.key })
    .from(changeEvents)
    .innerJoin(services, eq(services.id, changeEvents.serviceId))
    .where(and(eq(changeEvents.tenantId, tenantId), gte(changeEvents.occurredAt, earliest)));
  const followed = new Map<string, number[]>();
  for (const inc of mine) {
    const seen = new Set<string>();
    for (const c of changes) {
      const gap = inc.declaredAt.getTime() - c.at.getTime();
      if (gap < 0 || gap > CHANGE_WINDOW_MS || seen.has(c.serviceKey)) continue;
      seen.add(c.serviceKey);
      followed.set(c.serviceKey, [...(followed.get(c.serviceKey) ?? []), inc.number]);
    }
  }
  const strongest = [...followed.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (strongest) {
    facts.push({ kind: "changes", other: strongest[0], incidents: strongest[1].slice(0, 3) });
    for (const n of strongest[1].slice(0, 2)) cites.push({ label: "timeline", incident: n });
  }

  // The last root cause written down for this service.
  const [pm] = await tx
    .select({ number: incidents.number, sections: postMortems.sections })
    .from(postMortems)
    .innerJoin(incidents, eq(incidents.id, postMortems.incidentId))
    .where(
      and(
        eq(postMortems.tenantId, tenantId),
        eq(incidents.serviceId, serviceId),
        or(eq(postMortems.status, "in_review"), eq(postMortems.status, "completed")),
      ),
    )
    .orderBy(desc(incidents.declaredAt))
    .limit(1);
  const cause = pm?.sections.find((s) => s.key === "root_cause")?.body.trim();
  if (pm && cause) {
    const first = cause.split(/(?<=[.!?])\s/)[0] ?? cause;
    facts.push({
      kind: "rootCause",
      incident: pm.number,
      excerpt: first.length > 220 ? `${first.slice(0, 217)}…` : first,
    });
    cites.unshift({ label: "postMortem", incident: pm.number });
  }

  // Resolution against the workspace, over the same 180 days.
  const ttr = (rows: Array<{ declaredAt: Date; resolvedAt: Date | null }>) =>
    median(
      rows
        .filter((r) => r.resolvedAt && r.resolvedAt >= r.declaredAt)
        .map((r) => (r.resolvedAt!.getTime() - r.declaredAt.getTime()) / 60_000),
    );
  const all = await tx
    .select({ declaredAt: incidents.declaredAt, resolvedAt: incidents.resolvedAt })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        ne(incidents.mode, "test"),
        isNull(incidents.mergedIntoId),
        gte(incidents.declaredAt, since),
      ),
    );
  const mineTtr = ttr(mine);
  const allTtr = ttr(all);
  const resolved = mine.filter((r) => r.resolvedAt).length;
  if (mineTtr !== null && allTtr !== null && resolved >= 2)
    facts.push({ kind: "resolve", mine: mineTtr, all: allTtr, count: resolved });

  return { facts, cites: cites.slice(0, 3) };
}

/* ---------- Dependencies: observed, declared, hidden ---------- */

export type DependencyNode = {
  /** Null when the traces name something the workspace has no service for yet. */
  serviceId: string | null;
  key: string;
  direction: "upstream" | "downstream";
  declared: boolean;
  hidden: boolean;
  observed: { calls: number; errors: number; p95Ms: number } | null;
  state: ServiceState;
};

/**
 * The calls between this service and others, as the traces observed them and
 * as people settled them. Observed calls come in by name and are folded into
 * the service that name belongs to, merged names included.
 */
export async function serviceDependencies(
  tx: Tx,
  tenantId: string,
  svc: { id: string; key: string; aliases: string[] },
  observed: Array<{
    other: string;
    direction: "upstream" | "downstream";
    calls: number;
    errors: number;
    p95Ms: number;
  }>,
): Promise<DependencyNode[]> {
  const all = await tx
    .select({ id: services.id, key: services.key, mergedIntoId: services.mergedIntoId })
    .from(services)
    .where(eq(services.tenantId, tenantId));
  const keyOf = new Map(all.map((s) => [s.id, s.key]));
  const canonical = new Map<string, { id: string; key: string }>();
  for (const s of all) {
    const target = s.mergedIntoId ?? s.id;
    canonical.set(s.key, { id: target, key: keyOf.get(target) ?? s.key });
  }
  const links = await tx
    .select({
      from: serviceLinks.fromServiceId,
      to: serviceLinks.toServiceId,
      state: serviceLinks.state,
    })
    .from(serviceLinks)
    .where(
      and(
        eq(serviceLinks.tenantId, tenantId),
        or(eq(serviceLinks.fromServiceId, svc.id), eq(serviceLinks.toServiceId, svc.id)),
      ),
    );

  const nodes = new Map<string, DependencyNode>();
  const own = new Set([svc.key, ...svc.aliases]);
  for (const o of observed) {
    if (o.calls <= 0 || own.has(o.other)) continue;
    const c = canonical.get(o.other);
    if (c?.id === svc.id) continue;
    const id = `${o.direction}:${c?.key ?? o.other}`;
    const cur = nodes.get(id);
    nodes.set(id, {
      serviceId: c?.id ?? null,
      key: c?.key ?? o.other,
      direction: o.direction,
      declared: false,
      hidden: false,
      observed: {
        calls: (cur?.observed?.calls ?? 0) + o.calls,
        errors: (cur?.observed?.errors ?? 0) + o.errors,
        p95Ms: Math.max(cur?.observed?.p95Ms ?? 0, o.p95Ms),
      },
      state: "unknown",
    });
  }
  for (const l of links) {
    const direction = l.from === svc.id ? "downstream" : "upstream";
    const otherId = l.from === svc.id ? l.to : l.from;
    const key = keyOf.get(otherId);
    if (!key) continue;
    const id = `${direction}:${key}`;
    const cur = nodes.get(id);
    nodes.set(id, {
      serviceId: otherId,
      key,
      direction,
      observed: cur?.observed ?? null,
      declared: l.state === "declared",
      hidden: l.state === "hidden",
      state: "unknown",
    });
  }

  const ids = [...nodes.values()].map((n) => n.serviceId).filter((x): x is string => !!x);
  if (ids.length > 0) {
    const mons = await tx
      .select({ serviceId: monitors.serviceId, state: monitors.state })
      .from(monitors)
      .where(and(eq(monitors.tenantId, tenantId), inArray(monitors.serviceId, ids)));
    const worst = worstStates(mons);
    for (const n of nodes.values()) {
      const fromMonitors = n.serviceId ? worst.get(n.serviceId) : undefined;
      const failing =
        n.observed && n.observed.calls > 0 && n.observed.errors / n.observed.calls > 0.05;
      n.state =
        fromMonitors === "offline"
          ? "offline"
          : fromMonitors === "degraded" || failing
            ? "degraded"
            : (fromMonitors ?? (n.observed ? "online" : "unknown"));
    }
  }
  return [...nodes.values()].sort(
    (a, b) => (b.observed?.calls ?? 0) - (a.observed?.calls ?? 0) || a.key.localeCompare(b.key),
  );
}
