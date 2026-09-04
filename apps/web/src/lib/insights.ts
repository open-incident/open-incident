/**
 * Insights — real numbers from the workspace's own rows: incidents, alerts,
 * pages, follow-ups over a period, compared with the previous one. Test
 * incidents are excluded. What is not measurable is said, not simulated.
 */
import { and, eq, gte, isNull, lt, ne } from "drizzle-orm";
import {
  alertSources,
  alerts,
  catalogEntries,
  escalations,
  followUpPriorities,
  followUps,
  incidents,
  members,
  notificationDeliveries,
  severities,
  type Tx,
} from "@openincident/db";

const DAY = 86_400_000;

export type Period = { days: 30 | 90 | 365; from: Date; to: Date; prevFrom: Date };

export function periodOf(days: 30 | 90 | 365, now = new Date()): Period {
  const to = now;
  const from = new Date(to.getTime() - days * DAY);
  return { days, from, to, prevFrom: new Date(from.getTime() - days * DAY) };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const inWindow = (d: Date, from: Date, to: Date) =>
  d.getTime() >= from.getTime() && d.getTime() < to.getTime();

/** Buckets filled from the end, oldest first, so the current, partial bucket is the last one. */
export function buckets(
  dates: Date[],
  period: Period,
): Array<{ label: Date; count: number; partial: boolean }> {
  const size = period.days <= 7 ? DAY : period.days <= 120 ? 7 * DAY : 30 * DAY;
  const n = Math.ceil((period.days * DAY) / size);
  const out: Array<{ label: Date; count: number; partial: boolean }> = [];
  for (let i = 0; i < n; i++) {
    const end = period.to.getTime() - (n - 1 - i) * size;
    const start = end - size;
    out.push({
      label: new Date(start),
      count: dates.filter((d) => d.getTime() >= start && d.getTime() < end).length,
      partial: i === n - 1,
    });
  }
  return out;
}

export type Stat = { value: number | null; prev: number | null };
const stat = (value: number | null, prev: number | null): Stat => ({ value, prev });

export async function incidentInsights(tx: Tx, tenantId: string, period: Period) {
  const rows = await tx
    .select({
      inc: incidents,
      sevRank: severities.rank,
      sevName: severities.name,
      serviceName: catalogEntries.name,
    })
    .from(incidents)
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .leftJoin(catalogEntries, eq(catalogEntries.id, incidents.serviceEntryId))
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        ne(incidents.mode, "test"),
        isNull(incidents.mergedIntoId),
        gte(incidents.declaredAt, period.prevFrom),
      ),
    );
  const cur = rows.filter((r) => inWindow(r.inc.declaredAt, period.from, period.to));
  const prev = rows.filter((r) => inWindow(r.inc.declaredAt, period.prevFrom, period.from));
  const mtta = (set: typeof rows) =>
    median(
      set
        .filter((r) => r.inc.acknowledgedAt)
        .map((r) => (r.inc.acknowledgedAt!.getTime() - r.inc.declaredAt.getTime()) / 60_000),
    );
  const mttr = (set: typeof rows) =>
    median(
      set
        .filter((r) => r.inc.resolvedAt)
        .map((r) => (r.inc.resolvedAt!.getTime() - r.inc.declaredAt.getTime()) / 60_000),
    );
  const high = (set: typeof rows) => set.filter((r) => r.sevRank !== null && r.sevRank <= 1).length;
  const bySeverity = new Map<string, number>();
  for (const r of cur)
    bySeverity.set(r.sevName ?? "—", (bySeverity.get(r.sevName ?? "—") ?? 0) + 1);
  const byService = new Map<string, { count: number; mttr: number[] }>();
  for (const r of cur) {
    const k = r.serviceName ?? "—";
    const e = byService.get(k) ?? { count: 0, mttr: [] };
    e.count++;
    if (r.inc.resolvedAt)
      e.mttr.push((r.inc.resolvedAt.getTime() - r.inc.declaredAt.getTime()) / 60_000);
    byService.set(k, e);
  }
  return {
    count: stat(cur.length, prev.length),
    mtta: stat(mtta(cur), mtta(prev)),
    mttr: stat(mttr(cur), mttr(prev)),
    high: stat(high(cur), high(prev)),
    weekly: buckets(
      cur.map((r) => r.inc.declaredAt),
      period,
    ),
    bySeverity: [...bySeverity.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count })),
    byService: [...byService.entries()]
      .map(([name, e]) => ({ name, count: e.count, mttr: median(e.mttr) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    rows: cur.map((r) => ({
      number: r.inc.number,
      name: r.inc.name,
      severity: r.sevName,
      service: r.serviceName,
      phase: r.inc.phase,
      declaredAt: r.inc.declaredAt,
      acknowledgedAt: r.inc.acknowledgedAt,
      resolvedAt: r.inc.resolvedAt,
    })),
  };
}

export async function alertInsights(tx: Tx, tenantId: string, period: Period) {
  const rows = await tx
    .select({
      a: alerts,
      sourceName: alertSources.name,
      sourceId: alertSources.id,
      sourceActive: alertSources.active,
    })
    .from(alerts)
    .innerJoin(alertSources, eq(alertSources.id, alerts.sourceId))
    .where(
      and(
        eq(alerts.tenantId, tenantId),
        eq(alerts.testMode, false),
        isNull(alerts.groupId),
        gte(alerts.firstAt, period.prevFrom),
      ),
    );
  const cur = rows.filter((r) => inWindow(r.a.firstAt, period.from, period.to));
  const prev = rows.filter((r) => inWindow(r.a.firstAt, period.prevFrom, period.from));
  const conv = (set: typeof rows) =>
    set.length ? Math.round((set.filter((r) => r.a.incidentId).length / set.length) * 100) : null;
  const auto = (set: typeof rows) =>
    set.length
      ? Math.round(
          (set.filter(
            (r) => r.a.resolvedAt && r.a.resolvedAt.getTime() - r.a.firstAt.getTime() < 5 * 60_000,
          ).length /
            set.length) *
            100,
        )
      : null;
  const sources = await tx
    .select({ id: alertSources.id, name: alertSources.name, active: alertSources.active })
    .from(alertSources)
    .where(eq(alertSources.tenantId, tenantId));
  const bySource = new Map<string, number>();
  for (const r of cur)
    bySource.set(r.sourceName, (bySource.get(r.sourceName) ?? 0) + r.a.groupCount);
  const noisy = new Map<string, { count: number; routeId: string | null; alertId: string }>();
  for (const r of cur) {
    const e = noisy.get(r.a.dedupKey) ?? { count: 0, routeId: r.a.routeId, alertId: r.a.id };
    e.count += r.a.groupCount;
    noisy.set(r.a.dedupKey, e);
  }
  const titles = new Map(cur.map((r) => [r.a.dedupKey, r.a.title]));
  return {
    count: stat(
      cur.reduce((n, r) => n + r.a.groupCount, 0),
      prev.reduce((n, r) => n + r.a.groupCount, 0),
    ),
    conversion: stat(conv(cur), conv(prev)),
    autoResolved: stat(auto(cur), auto(prev)),
    activeSources: stat(sources.filter((s) => s.active).length, null),
    bySource: [...bySource.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    noisy: [...noisy.entries()]
      .map(([key, e]) => ({
        key,
        title: titles.get(key) ?? key,
        count: e.count,
        routeId: e.routeId,
        alertId: e.alertId,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
    rows: cur.map((r) => ({
      title: r.a.title,
      source: r.sourceName,
      priority: r.a.attributes.priority ?? "",
      service: r.a.attributes.service ?? "",
      firstAt: r.a.firstAt,
      resolvedAt: r.a.resolvedAt,
      grouped: r.a.groupCount,
      incidentId: r.a.incidentId,
    })),
  };
}

function localHour(at: Date, timeZone: string): number {
  try {
    return (
      Number(
        new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(
          at,
        ),
      ) % 24
    );
  } catch {
    return at.getUTCHours();
  }
}
function localWeekday(at: Date, timeZone: string): number {
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(at);
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd) + 1;
  } catch {
    return 1;
  }
}

export async function pagerInsights(tx: Tx, tenantId: string, period: Period, workspaceTz: string) {
  const rows = await tx
    .select({ d: notificationDeliveries, memberName: members.name, memberTz: members.timezone })
    .from(notificationDeliveries)
    .innerJoin(members, eq(members.id, notificationDeliveries.memberId))
    .where(
      and(
        eq(notificationDeliveries.tenantId, tenantId),
        eq(notificationDeliveries.kind, "escalation"),
        gte(notificationDeliveries.createdAt, period.prevFrom),
      ),
    );
  // One page = one escalation × member × moment (channels of the same step collapse).
  const key = (r: (typeof rows)[number]) =>
    `${r.d.escalationId ?? r.d.id}:${r.d.memberId}:${Math.floor(r.d.createdAt.getTime() / 60_000)}`;
  const dedup = (set: typeof rows) => [...new Map(set.map((r) => [key(r), r])).values()];
  const cur = dedup(rows.filter((r) => inWindow(r.d.createdAt, period.from, period.to)));
  const prev = dedup(rows.filter((r) => inWindow(r.d.createdAt, period.prevFrom, period.from)));
  const night = (set: typeof cur) =>
    set.filter((r) => {
      const h = localHour(r.d.createdAt, r.memberTz ?? workspaceTz);
      return h >= 0 && h < 6;
    }).length;
  const offHours = (set: typeof cur) =>
    set.length
      ? Math.round(
          (set.filter((r) => {
            const tz = r.memberTz ?? workspaceTz;
            const h = localHour(r.d.createdAt, tz);
            const wd = localWeekday(r.d.createdAt, tz);
            return wd >= 6 || h < 9 || h >= 18;
          }).length /
            set.length) *
            100,
        )
      : null;
  const escs = await tx
    .select({ id: escalations.id, startedAt: escalations.startedAt, ackedAt: escalations.ackedAt })
    .from(escalations)
    .where(and(eq(escalations.tenantId, tenantId), gte(escalations.startedAt, period.prevFrom)));
  const ackMedian = (from: Date, to: Date) =>
    median(
      escs
        .filter((e) => e.ackedAt && inWindow(e.startedAt, from, to))
        .map((e) => (e.ackedAt!.getTime() - e.startedAt.getTime()) / 60_000),
    );
  const heat = new Map<string, number[]>();
  for (const r of cur) {
    const row = heat.get(r.memberName) ?? Array.from({ length: 24 }, () => 0);
    row[localHour(r.d.createdAt, r.memberTz ?? workspaceTz)]!++;
    heat.set(r.memberName, row);
  }
  const nightByMember = [...heat.entries()]
    .map(([name, hours]) => ({ name, night: hours.slice(0, 6).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.night - a.night);
  return {
    pages: stat(cur.length, prev.length),
    night: stat(night(cur), night(prev)),
    ackMedian: stat(ackMedian(period.from, period.to), ackMedian(period.prevFrom, period.from)),
    offHours: stat(offHours(cur), offHours(prev)),
    heat: [...heat.entries()]
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours.reduce((x, y) => x + y, 0) - a.hours.reduce((x, y) => x + y, 0)),
    worstNight: nightByMember[0] && nightByMember[0].night > 0 ? nightByMember[0] : null,
    rows: cur.map((r) => ({
      member: r.memberName,
      at: r.d.createdAt,
      localHour: localHour(r.d.createdAt, r.memberTz ?? workspaceTz),
      channel: r.d.methodKind,
      status: r.d.status,
    })),
  };
}

export async function followUpInsights(tx: Tx, tenantId: string, period: Period) {
  const rows = await tx
    .select({
      f: followUps,
      priorityName: followUpPriorities.name,
      targetDays: followUpPriorities.completeWithinDays,
      incidentNumber: incidents.number,
      serviceId: incidents.serviceEntryId,
    })
    .from(followUps)
    .leftJoin(followUpPriorities, eq(followUpPriorities.id, followUps.priorityId))
    .innerJoin(incidents, eq(incidents.id, followUps.incidentId))
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        ne(incidents.mode, "test"),
        gte(followUps.createdAt, period.prevFrom),
      ),
    );
  const cur = rows.filter((r) => inWindow(r.f.createdAt, period.from, period.to));
  const prev = rows.filter((r) => inWindow(r.f.createdAt, period.prevFrom, period.from));
  const closed = (set: typeof rows) =>
    set.length
      ? Math.round((set.filter((r) => r.f.status === "done").length / set.length) * 100)
      : null;
  const closure = (set: typeof rows) =>
    median(
      set
        .filter((r) => r.f.completedAt)
        .map((r) => (r.f.completedAt!.getTime() - r.f.createdAt.getTime()) / DAY),
    );
  const now = new Date();
  const overdueNow = await tx
    .select({
      f: followUps,
      priorityName: followUpPriorities.name,
      incidentNumber: incidents.number,
    })
    .from(followUps)
    .leftJoin(followUpPriorities, eq(followUpPriorities.id, followUps.priorityId))
    .innerJoin(incidents, eq(incidents.id, followUps.incidentId))
    .where(
      and(eq(followUps.tenantId, tenantId), eq(followUps.status, "open"), lt(followUps.dueAt, now)),
    );
  // Team = owner of the incident's service (catalog attribute `owner`, an entry id).
  const services = await tx
    .select({
      id: catalogEntries.id,
      name: catalogEntries.name,
      attributes: catalogEntries.attributes,
    })
    .from(catalogEntries)
    .where(eq(catalogEntries.tenantId, tenantId));
  const nameOfTeam = new Map(services.map((s) => [s.id, s.name]));
  const teamOf = (serviceId: string | null) => {
    if (!serviceId) return null;
    const owner = services.find((s) => s.id === serviceId)?.attributes.owner;
    return typeof owner === "string" ? owner : null;
  };
  const byTeam = new Map<string, { total: number; done: number }>();
  for (const r of cur) {
    const team = teamOf(r.serviceId);
    if (!team) continue;
    const e = byTeam.get(team) ?? { total: 0, done: 0 };
    e.total++;
    if (r.f.status === "done") e.done++;
    byTeam.set(team, e);
  }
  const p1 = rows.find((r) => r.priorityName === "P1")?.targetDays ?? null;
  return {
    created: stat(cur.length, prev.length),
    closed: stat(closed(cur), closed(prev)),
    closureDays: stat(closure(cur), closure(prev)),
    overdue: stat(overdueNow.length, null),
    byTeam: [...byTeam.entries()]
      .map(([id, e]) => ({
        name: nameOfTeam.get(id) ?? id,
        rate: e.total ? Math.round((e.done / e.total) * 100) : 0,
        total: e.total,
      }))
      .sort((a, b) => b.rate - a.rate),
    overdueList: overdueNow
      .map((r) => ({
        id: r.f.id,
        title: r.f.title,
        priority: r.priorityName,
        incidentNumber: r.incidentNumber,
        daysLate: Math.floor((now.getTime() - r.f.dueAt!.getTime()) / DAY),
      }))
      .sort((a, b) => b.daysLate - a.daysLate)
      .slice(0, 5),
    p1TargetDays: p1,
    rows: cur.map((r) => ({
      title: r.f.title,
      priority: r.priorityName,
      status: r.f.status,
      incidentNumber: r.incidentNumber,
      createdAt: r.f.createdAt,
      dueAt: r.f.dueAt,
      completedAt: r.f.completedAt,
    })),
  };
}

/** The delta label of a stat against the previous period: sign and unit given by the caller. */
export function delta(
  s: Stat,
  unit: "count" | "pct" | "minutes" | "days",
): { text: string; good: boolean | null } | null {
  if (s.value === null || s.prev === null) return null;
  const d = s.value - s.prev;
  if (unit === "pct")
    return { text: `${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d))} pt`, good: null };
  if (unit === "count") {
    if (s.prev === 0) return { text: `+${s.value}`, good: null };
    const pct = Math.round((d / s.prev) * 100);
    return { text: `${pct >= 0 ? "+" : "−"}${Math.abs(pct)} %`, good: null };
  }
  return { text: `${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d * 10) / 10)}`, good: null };
}

/** CSV with a UTF-8 BOM so spreadsheets read accents right. */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "﻿";
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    "﻿" +
    [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") +
    "\n"
  );
}
