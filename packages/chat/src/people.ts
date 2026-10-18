/**
 * Who belongs in an incident's channel: the declarer and the role holders,
 * and — when the administrator asks for it — the person on call for the
 * incident's service.
 *
 * The on-call answer needs the rotation engine, which lives in the on-call
 * package — and that package already depends on this one (it sends pages as
 * direct messages). So the engine is handed in rather than imported: the web
 * server registers its resolver once at start, and until it has, nobody on
 * call is added (the declarer and the role holders still are).
 *
 * The registration sits on `globalThis` because the server bundles its routes
 * apart from its start-up hook: a module-level variable would exist once per
 * bundle, and the channel would be created by a copy that never heard of it.
 */
import { and, eq, inArray } from "drizzle-orm";
import { incidents, members, roleAssignments, type Tx } from "@openincident/db";

export type ChatPerson = { memberId: string; name: string; email: string; onCall: boolean };

export type OnCallResolver = (
  tx: Tx,
  tenantId: string,
  incidentId: string,
) => Promise<Array<{ id: string; name: string; email: string }>>;

const KEY = Symbol.for("openincident.chat.onCallResolver");
type Registry = { [KEY]?: OnCallResolver };

/** Called once by the server at start. */
export function registerOnCallResolver(fn: OnCallResolver): void {
  (globalThis as Registry)[KEY] = fn;
}

export function onCallResolverRegistered(): boolean {
  return typeof (globalThis as Registry)[KEY] === "function";
}

/** The person (or people) on call for the incident's service right now — empty when unknown. */
export async function onCallForIncident(
  tx: Tx,
  tenantId: string,
  incidentId: string,
): Promise<Array<{ id: string; name: string; email: string }>> {
  const fn = (globalThis as Registry)[KEY];
  if (!fn) return [];
  try {
    return await fn(tx, tenantId, incidentId);
  } catch (err) {
    console.error("[chat] on-call lookup failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** The declarer and the role holders of an incident, active members only. */
export async function incidentPeople(
  tx: Tx,
  tenantId: string,
  incidentId: string,
): Promise<ChatPerson[]> {
  const [inc] = await tx
    .select({ creator: incidents.creatorMemberId })
    .from(incidents)
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
  const roles = await tx
    .select({ memberId: roleAssignments.memberId })
    .from(roleAssignments)
    .where(eq(roleAssignments.incidentId, incidentId));
  const ids = [
    ...new Set(
      [inc?.creator, ...roles.map((r) => r.memberId)].filter((x): x is string => Boolean(x)),
    ),
  ];
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: members.id, name: members.name, email: members.email, status: members.status })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), inArray(members.id, ids)));
  return rows
    .filter((r) => r.status === "active")
    .map((r) => ({ memberId: r.id, name: r.name, email: r.email, onCall: false }));
}

/** Everyone the channel should hold, by the install's settings, without duplicates. */
export async function channelPeople(
  tx: Tx,
  tenantId: string,
  incidentId: string,
  settings: { autoInvite: boolean; inviteOnCall: boolean },
): Promise<ChatPerson[]> {
  const out: ChatPerson[] = settings.autoInvite
    ? await incidentPeople(tx, tenantId, incidentId)
    : [];
  if (settings.inviteOnCall) {
    for (const m of await onCallForIncident(tx, tenantId, incidentId)) {
      const known = out.find((p) => p.memberId === m.id);
      if (known) known.onCall = true;
      else out.push({ memberId: m.id, name: m.name, email: m.email, onCall: true });
    }
  }
  return out;
}

/** "Thomas Moreau, Nadia Benali and Jordan Bakker (on call)" — the line the channel reads. */
export function peopleLine(people: ChatPerson[]): string {
  const names = people.map((p) => (p.onCall ? `${p.name} (on call)` : p.name));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
