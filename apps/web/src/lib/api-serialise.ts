/**
 * The shapes the v1 API answers with, where two routes answer with the same one.
 *
 * Here rather than exported from a `route.ts`, and not as a matter of taste:
 * Next allows a route file to export the handlers and its config and nothing
 * else, so a helper shared between `/alerts` and `/alerts/{id}` has to live
 * outside both. Putting it here also means the list and the detail cannot drift
 * into describing the same row two ways.
 */

export function serialiseService(r: {
  id: string;
  key: string;
  name: string | null;
  confirmed: boolean;
  seenIn: string[];
  labels: Record<string, string> | null;
  techStack: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  telemetryLastSeenAt: Date | null;
  ownerTeamId: string | null;
  ownerTeam: string | null;
}) {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    confirmed: r.confirmed,
    seen_in: r.seenIn,
    labels: r.labels ?? {},
    tech_stack: r.techStack,
    owner_team_id: r.ownerTeamId,
    owner_team: r.ownerTeam,
    first_seen_at: r.firstSeenAt?.toISOString() ?? null,
    last_seen_at: r.lastSeenAt?.toISOString() ?? null,
    telemetry_last_seen_at: r.telemetryLastSeenAt?.toISOString() ?? null,
  };
}

export function serialiseAlert(a: {
  id: string;
  title: string;
  description: string | null;
  status: "firing" | "resolved";
  urgency: "high" | "low" | null;
  snoozedUntil: Date | null;
  dedupKey: string;
  groupCount: number;
  incidentId: string | null;
  externalUrl: string | null;
  testMode: boolean;
  firstAt: Date;
  lastAt: Date;
  ackedAt: Date | null;
  resolvedAt: Date | null;
  source: string | null;
  priority: string | null;
}) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    status: a.status,
    urgency: a.urgency,
    source: a.source,
    priority: a.priority,
    dedup_key: a.dedupKey,
    snoozed_until: a.snoozedUntil?.toISOString() ?? null,
    // How many times this same alert fired before somebody looked. The single
    // most useful number on the screen and the easiest to forget in an API.
    occurrences: a.groupCount,
    incident_id: a.incidentId,
    external_url: a.externalUrl,
    test_mode: a.testMode,
    first_at: a.firstAt.toISOString(),
    last_at: a.lastAt.toISOString(),
    acked_at: a.ackedAt?.toISOString() ?? null,
    resolved_at: a.resolvedAt?.toISOString() ?? null,
  };
}
