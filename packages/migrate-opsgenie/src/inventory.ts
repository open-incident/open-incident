/**
 * Step 1 and 2: checking the key, then reading the whole account.
 *
 * The key check answers four questions with as few calls as possible: is the
 * region reachable, may the key read alerts, may it read configuration
 * (users, schedules, policies — "Configuration Access"), and is it the
 * account's key rather than a team's (a team key only sees its own team).
 *
 * The inventory reads everything the import needs, reporting its progress
 * as it goes; it is a network job, it writes nothing.
 */
import { OpsgenieError, type OpsgenieClient } from "./client";
import type {
  OgEscalation,
  OgHeartbeat,
  OgIntegration,
  OgNotificationRule,
  OgOverride,
  OgPolicy,
  OgRoutingRule,
  OgSchedule,
  OgTeam,
  OgTimeline,
  OgUser,
} from "./types";
import { windowQuery } from "./client";

export type CheckResult = { ok: boolean; detail: string };
export type KeyChecks = {
  reach: CheckResult;
  read: CheckResult;
  config: CheckResult;
  account: CheckResult & { name?: string; teams?: number; teamKey?: boolean };
};

const errDetail = (e: unknown) =>
  e instanceof OpsgenieError ? (e.status ? String(e.status) : e.code) : "error";

export async function checkKey(client: OpsgenieClient): Promise<KeyChecks> {
  const out: KeyChecks = {
    reach: { ok: false, detail: "" },
    read: { ok: false, detail: "—" },
    config: { ok: false, detail: "—" },
    account: { ok: false, detail: "—" },
  };
  // Read access: a count of alerts. Its status also proves the host answers.
  try {
    await client.countAlerts("createdAt>0");
    out.reach = { ok: true, detail: "200" };
    out.read = { ok: true, detail: "✓" };
  } catch (e) {
    if (e instanceof OpsgenieError && e.code === "unreachable") {
      out.reach = { ok: false, detail: "unreachable" };
      return out;
    }
    // Opsgenie answered — the host is reachable, the key is the problem.
    out.reach = { ok: true, detail: errDetail(e) };
    out.read = { ok: false, detail: errDetail(e) };
    if (e instanceof OpsgenieError && e.status === 401) return out;
  }
  try {
    await client.usersProbe();
    out.config = { ok: true, detail: "✓" };
  } catch (e) {
    out.config = { ok: false, detail: errDetail(e) };
  }
  let teams = 0;
  try {
    teams = (await client.teams()).length;
  } catch {
    /* without Configuration Access the teams are out of reach too */
  }
  try {
    const account = await client.account();
    out.account = { ok: true, detail: account.name, name: account.name, teams };
  } catch (e) {
    const teamKey = e instanceof OpsgenieError && e.status === 403 && out.read.ok;
    out.account = { ok: false, detail: errDetail(e), teams, teamKey };
  }
  return out;
}

export const checksPass = (c: KeyChecks) => c.reach.ok && c.read.ok && c.config.ok && c.account.ok;

/* ---------- The inventory ---------- */

export type StoredUser = OgUser & { notificationRules?: OgNotificationRule[] };
export type StoredTeam = OgTeam & { routingRules: OgRoutingRule[] };
export type StoredScheduleData = OgSchedule & {
  overrides: OgOverride[];
  timeline: OgTimeline | null;
};
export type StoredIntegration = OgIntegration & { lastAlertAt: string | null };

export type Snapshot = {
  readAt: string;
  account: string | null;
  users: StoredUser[];
  teams: StoredTeam[];
  schedules: StoredScheduleData[];
  escalations: OgEscalation[];
  policies: OgPolicy[];
  integrations: StoredIntegration[];
  heartbeats: OgHeartbeat[];
  alerts: { total: number; oldest: string | null; p5In90d: number };
};

export type Progress = (pct: number, label: string) => Promise<void> | void;

export const TIMELINE_WEEKS = 8;

export async function readInventory(
  client: OpsgenieClient,
  now: Date,
  progress: Progress = () => {},
): Promise<Snapshot> {
  await progress(2, "account");
  const account = await client
    .account()
    .then((a) => a.name)
    .catch(() => null);

  await progress(6, "users");
  const users: StoredUser[] = await client.users();
  for (const [i, u] of users.entries()) {
    if (i < 200) u.notificationRules = await client.notificationRules(u.id).catch(() => []);
    if (i % 10 === 0) await progress(6 + Math.round((i / Math.max(1, users.length)) * 10), "users");
  }

  await progress(18, "teams");
  const teamList = await client.teams();
  const teams: StoredTeam[] = [];
  for (const [i, t] of teamList.entries()) {
    const full = await client.team(t.id).catch(() => t);
    const routingRules = await client.routingRules(t.id).catch(() => []);
    teams.push({ ...t, ...full, routingRules });
    await progress(18 + Math.round(((i + 1) / Math.max(1, teamList.length)) * 12), "teams");
  }

  await progress(32, "schedules");
  const scheduleList = await client.schedules();
  const schedules: StoredScheduleData[] = [];
  for (const [i, s] of scheduleList.entries()) {
    const overrides = await client.overrides(s.id).catch(() => []);
    const timeline = await client.timeline(s.id, now, TIMELINE_WEEKS).catch(() => null);
    schedules.push({ ...s, overrides, timeline });
    await progress(32 + Math.round(((i + 1) / Math.max(1, scheduleList.length)) * 20), "schedules");
  }

  await progress(54, "escalations");
  const escalations = await client.escalations();
  await progress(58, "policies");
  const policies = await client.policies(teams.map((t) => t.id));

  await progress(62, "integrations");
  const integrationList = await client.integrations();
  // One pass over the latest alerts names the last alert of most integrations
  // (an alert carries its integration); the rest are asked one by one.
  const lastSeen = new Map<string, string>();
  for (let offset = 0; offset < 2_000; offset += 100) {
    const page = await client.searchAlerts("createdAt>0", offset, 100, "desc").catch(() => []);
    for (const a of page)
      if (a.integration?.id && !lastSeen.has(a.integration.id))
        lastSeen.set(a.integration.id, a.createdAt);
    if (page.length < 100 || lastSeen.size >= integrationList.length) break;
  }
  const integrations: StoredIntegration[] = [];
  for (const [i, x] of integrationList.entries()) {
    let last = lastSeen.get(x.id) ?? null;
    if (!last)
      for (const query of [
        `integration.id:${x.id}`,
        `integration.name:"${x.name.replace(/"/g, "")}"`,
      ]) {
        const hit = await client
          .searchAlerts(query, 0, 1, "desc")
          .then(
            (r) => r.find((a) => !a.integration || a.integration.id === x.id)?.createdAt ?? null,
          )
          .catch(() => undefined);
        if (hit !== undefined) {
          last = hit;
          break;
        }
      }
    integrations.push({ ...x, lastAlertAt: last });
    await progress(
      62 + Math.round(((i + 1) / Math.max(1, integrationList.length)) * 18),
      "integrations",
    );
  }

  await progress(82, "heartbeats");
  const heartbeats = await client.heartbeats().catch(() => []);

  await progress(88, "alerts");
  const total = await client.countAlerts("createdAt>0");
  const oldest = await client
    .searchAlerts("createdAt>0", 0, 1, "asc")
    .then((r) => r[0]?.createdAt ?? null)
    .catch(() => null);
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const p5In90d = await client.countAlerts(windowQuery(since, now, "priority:P5")).catch(() => 0);
  await progress(100, "done");

  return {
    readAt: now.toISOString(),
    account,
    users,
    teams,
    schedules,
    escalations,
    policies,
    integrations,
    heartbeats,
    alerts: { total, oldest, p5In90d },
  };
}

/**
 * Future on-call slots of each Opsgenie user in the final timeline, from
 * `from`. A slot is a stretch of one rotation held by one person: the nights
 * of one week are one slot, not seven.
 */
export function futureSlots(schedules: StoredScheduleData[], from: Date): Map<string, number> {
  const out = new Map<string, number>();
  const GAP = 36 * 3_600_000;
  for (const s of schedules)
    for (const r of s.timeline?.finalTimeline?.rotations ?? []) {
      const last = new Map<string, number>();
      const periods = (r.periods ?? [])
        .filter((p) => p.recipient?.type === "user" && p.recipient.id)
        .filter((p) => new Date(p.endDate).getTime() > from.getTime())
        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
      for (const p of periods) {
        const id = p.recipient!.id!;
        const start = new Date(p.startDate).getTime();
        const prev = last.get(id);
        if (prev === undefined || start - prev > GAP) out.set(id, (out.get(id) ?? 0) + 1);
        last.set(id, new Date(p.endDate).getTime());
      }
    }
  return out;
}

/** Which schedules a user's future slots are in, for the conflict notes. */
export function slotSchedules(
  schedules: StoredScheduleData[],
  userId: string,
  from: Date,
): string[] {
  const names: string[] = [];
  for (const s of schedules)
    for (const r of s.timeline?.finalTimeline?.rotations ?? [])
      if (
        (r.periods ?? []).some(
          (p) => p.recipient?.id === userId && new Date(p.endDate).getTime() > from.getTime(),
        )
      ) {
        if (!names.includes(s.name)) names.push(s.name);
      }
  return names;
}
