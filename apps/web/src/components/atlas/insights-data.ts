/**
 * Insights › ✦ Atlas, computed from the rows — owner: atlas-ui. Test
 * incidents are left out, like everywhere in Insights; a figure with no rows
 * behind it is null and the screen says "—".
 */
import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { atlasActions, incidents, investigations, withTenant } from "@openincident/db";
import type { InvestigationGrade } from "@openincident/db";
import { listServiceAutonomy, type ServiceAutonomyView } from "@/lib/atlas/queries";
import { isUndone } from "./run";

const DAY = 86_400_000;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

type Window = {
  resolved: number;
  alone: number;
  /** Minutes, declaration → resolution. */
  ttrAlone: number | null;
  ttrPeople: number | null;
  graded: number;
  right: number;
  actions: number;
  undone: number;
  costPerIncident: number | null;
};

export type AtlasInsights = {
  now: Window;
  before: Window;
  weeks: Array<{ start: Date; alone: number; approved: number; people: number }>;
  services: Array<ServiceAutonomyView & { ttr: number | null; undone: number }>;
  grades: Record<InvestigationGrade, number>;
  notGraded: number;
};

export async function atlasInsights(tenantId: string, days: number): Promise<AtlasInsights> {
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY);
  const prev = new Date(start.getTime() - days * DAY);
  const [rows, acts, autonomy] = await Promise.all([
    withTenant(tenantId, (tx) =>
      tx
        .select({
          id: incidents.id,
          serviceId: incidents.serviceId,
          declaredAt: incidents.declaredAt,
          resolvedAt: incidents.resolvedAt,
          alone: investigations.resolvedAlone,
          grade: investigations.grade,
          gradedAt: investigations.gradedAt,
          runs: investigations.runs,
          cost: investigations.costEur,
        })
        .from(incidents)
        .leftJoin(investigations, eq(investigations.incidentId, incidents.id))
        .where(
          and(
            eq(incidents.tenantId, tenantId),
            eq(incidents.mode, "live"),
            gte(incidents.declaredAt, prev),
          ),
        ),
    ),
    withTenant(tenantId, (tx) =>
      tx
        .select({
          incidentId: atlasActions.incidentId,
          serviceId: atlasActions.serviceId,
          at: atlasActions.at,
          kind: atlasActions.kind,
          decidedBy: atlasActions.decidedBy,
          approvalState: atlasActions.approvalState,
          executedAt: atlasActions.executedAt,
          undoneAt: atlasActions.undoneAt,
          redoneAt: atlasActions.redoneAt,
        })
        .from(atlasActions)
        .where(and(eq(atlasActions.tenantId, tenantId), gte(atlasActions.at, prev))),
    ),
    listServiceAutonomy(tenantId),
  ]);

  const approvedIncidents = new Set(
    acts.filter((a) => a.approvalState === "approved" && a.incidentId).map((a) => a.incidentId!),
  );
  const ttr = (r: (typeof rows)[number]) =>
    r.resolvedAt ? (r.resolvedAt.getTime() - r.declaredAt.getTime()) / 60_000 : null;

  function windowOf(from: Date, to: Date): Window {
    const inc = rows.filter((r) => r.resolvedAt && r.resolvedAt >= from && r.resolvedAt < to);
    const alone = inc.filter((r) => r.alone);
    const people = inc.filter((r) => !r.alone);
    const graded = rows.filter((r) => r.gradedAt && r.gradedAt >= from && r.gradedAt < to);
    const right = graded.filter((r) => r.grade === "bullseye" || r.grade === "on_target");
    const atlasActs = acts.filter(
      (a) =>
        a.at >= from &&
        a.at < to &&
        a.decidedBy === "atlas" &&
        (a.kind === "system" || a.kind === "oi_write") &&
        a.executedAt,
    );
    const withRun = inc.filter((r) => (r.runs ?? 0) > 0);
    return {
      resolved: inc.length,
      alone: alone.length,
      ttrAlone: median(alone.map(ttr).filter((x): x is number => x != null)),
      ttrPeople: median(people.map(ttr).filter((x): x is number => x != null)),
      graded: graded.length,
      right: right.length,
      actions: atlasActs.length,
      undone: atlasActs.filter((a) => isUndone(a)).length,
      costPerIncident: withRun.length
        ? withRun.reduce((s, r) => s + (r.cost ?? 0), 0) / withRun.length
        : null,
    };
  }

  const weeksCount = Math.max(1, Math.ceil(days / 7));
  const firstWeek = new Date(end.getTime() - weeksCount * 7 * DAY);
  const weeks = Array.from({ length: weeksCount }, (_, i) => {
    const ws = new Date(firstWeek.getTime() + i * 7 * DAY);
    const we = new Date(ws.getTime() + 7 * DAY);
    const inc = rows.filter((r) => r.resolvedAt && r.resolvedAt >= ws && r.resolvedAt < we);
    const alone = inc.filter((r) => r.alone).length;
    const approved = inc.filter((r) => !r.alone && approvedIncidents.has(r.id)).length;
    return { start: ws, alone, approved, people: inc.length - alone - approved };
  });

  const inPeriod = rows.filter((r) => r.resolvedAt && r.resolvedAt >= start);
  const services = autonomy
    .map((s) => ({
      ...s,
      ttr: median(
        inPeriod
          .filter((r) => r.serviceId === s.serviceId)
          .map(ttr)
          .filter((x): x is number => x != null),
      ),
      undone: acts.filter((a) => a.serviceId === s.serviceId && a.at >= start && isUndone(a))
        .length,
    }))
    .sort((a, b) => b.effective - a.effective || a.key.localeCompare(b.key));

  const grades: Record<InvestigationGrade, number> = {
    bullseye: 0,
    on_target: 0,
    miss: 0,
    nowhere_near: 0,
  };
  for (const r of rows) if (r.grade && r.gradedAt && r.gradedAt >= start) grades[r.grade] += 1;
  const notGraded = inPeriod.filter((r) => (r.runs ?? 0) > 0 && !r.grade).length;

  return {
    now: windowOf(start, end),
    before: windowOf(prev, start),
    weeks,
    services,
    grades,
    notGraded,
  };
}

export { pct as share };
