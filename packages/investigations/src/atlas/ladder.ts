/**
 * The ladder in motion: grades, undos and reopenings move a service down;
 * the record, recounted from the rows, moves it up one level at a time. An
 * admin's cap never changes the level itself — it only bounds what applies.
 * Every change is an autonomy_events row and an audit line under atlas.*.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  autonomyEvents,
  backtests,
  investigations,
  serviceAutonomy,
  services,
  withTenant,
  type AutonomyCause,
  type AutonomyLevel,
  type InvestigationGrade,
  type Tx,
} from "@openincident/db";
import { auditAtlasTx } from "./journal";
import { levelAfter, promotionDue, type AutonomyRecord } from "./rules";

export type Actor = { memberId: string | null; name: string };

const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<
    Record<string, unknown>
  >;

/**
 * Recounts a service's record from the rows — the definitions every screen
 * relies on: incidents seen (runs on live incidents), graded runs, the share
 * graded bullseye or on target, the latest backtest, proposals approved
 * unchanged, level-3 fixes run alone and not undone once their undo window
 * closed, the last Miss, and the right runs since the last fall.
 */
export async function recomputeServiceAutonomyTx(
  tx: Tx,
  tenantId: string,
  serviceId: string,
): Promise<AutonomyRecord & { cap: number | null }> {
  const [c] = rowsOf(
    await tx.execute(sql`
      select
        count(*) filter (where i.mode = 'live')::int as seen,
        count(v.grade)::int as graded,
        count(*) filter (where v.grade in ('bullseye', 'on_target'))::int as right_n,
        max(v.graded_at) filter (where v.grade in ('miss', 'nowhere_near')) as last_miss
      from app.investigations v
      join app.incidents i on i.id = v.incident_id
      where v.tenant_id = ${tenantId} and i.service_id = ${serviceId}
    `),
  );
  const [a] = rowsOf(
    await tx.execute(sql`
      select
        count(*) filter (where kind = 'system' and approval_state = 'approved'
          and coalesce((payload->>'modified')::boolean, false) = false)::int as proposals_ok,
        count(*) filter (where kind = 'system' and autonomous and level = 3
          and executed_at is not null and undone_at is null
          and executed_at < now() - interval '24 hours')::int as l3_ok
      from app.atlas_actions
      where tenant_id = ${tenantId} and service_id = ${serviceId}
    `),
  );
  const [drop] = await tx
    .select({ at: autonomyEvents.createdAt })
    .from(autonomyEvents)
    .where(
      and(
        eq(autonomyEvents.tenantId, tenantId),
        eq(autonomyEvents.serviceId, serviceId),
        sql`${autonomyEvents.toLevel} < ${autonomyEvents.fromLevel}`,
      ),
    )
    .orderBy(desc(autonomyEvents.createdAt))
    .limit(1);
  let rightSinceDrop: number | null = null;
  if (drop) {
    const [r] = rowsOf(
      await tx.execute(sql`
        select count(*)::int as n from app.investigations v
        join app.incidents i on i.id = v.incident_id
        where v.tenant_id = ${tenantId} and i.service_id = ${serviceId}
          and v.grade in ('bullseye', 'on_target') and v.graded_at > ${drop.at.toISOString()}::timestamptz
      `),
    );
    rightSinceDrop = Number(r?.n ?? 0);
  }
  const [bt] = await tx
    .select({ stats: backtests.stats })
    .from(backtests)
    .where(and(eq(backtests.tenantId, tenantId), eq(backtests.status, "completed")))
    .orderBy(desc(backtests.completedAt))
    .limit(1);
  const per = bt?.stats?.perService?.[serviceId];
  const graded = Number(c?.graded ?? 0);
  const record = {
    incidentsSeen: Number(c?.seen ?? 0),
    gradedRuns: graded,
    rightPct: graded ? Math.round((Number(c?.right_n ?? 0) / graded) * 1000) / 10 : null,
    lastMissAt: c?.last_miss ? new Date(String(c.last_miss)) : null,
    proposalsOk: Number(a?.proposals_ok ?? 0),
    l3FixesOk: Number(a?.l3_ok ?? 0),
    backtestPct: per && per.incidents ? Math.round((per.right / per.incidents) * 1000) / 10 : null,
    rightSinceDrop,
  };
  const [saved] = await tx
    .insert(serviceAutonomy)
    .values({ tenantId, serviceId, ...record })
    .onConflictDoUpdate({
      target: serviceAutonomy.serviceId,
      set: { ...record, updatedAt: new Date() },
    })
    .returning({ level: serviceAutonomy.level, cap: serviceAutonomy.cap });
  return { ...record, level: saved?.level ?? 0, cap: saved?.cap ?? null };
}

export async function recomputeServiceAutonomy(tenantId: string, serviceId: string) {
  return withTenant(tenantId, (tx) => recomputeServiceAutonomyTx(tx, tenantId, serviceId));
}

/** Moves a service to `to`, writes why, and audits it. No-op when already there. */
export async function setLevelTx(
  tx: Tx,
  tenantId: string,
  serviceId: string,
  to: AutonomyLevel,
  cause: AutonomyCause,
  by: Actor | null,
  opts: { investigationId?: string | null; note?: string | null; grade?: string | null } = {},
): Promise<{ from: number; to: number } | null> {
  const [cur] = await tx
    .select({ level: serviceAutonomy.level })
    .from(serviceAutonomy)
    .where(and(eq(serviceAutonomy.tenantId, tenantId), eq(serviceAutonomy.serviceId, serviceId)));
  const from = cur?.level ?? 0;
  if (from === to) return null;
  const now = new Date();
  await tx
    .insert(serviceAutonomy)
    .values({ tenantId, serviceId, level: to, changedAt: now, reason: cause })
    .onConflictDoUpdate({
      target: serviceAutonomy.serviceId,
      set: {
        level: to,
        changedAt: now,
        reason: cause,
        // A fall restarts the count of right runs that earns the way back.
        ...(to < from ? { rightSinceDrop: 0 } : {}),
        updatedAt: now,
      },
    });
  await tx.insert(autonomyEvents).values({
    tenantId,
    serviceId,
    fromLevel: from,
    toLevel: to,
    cause,
    byMemberId: by?.memberId ?? null,
    investigationId: opts.investigationId ?? null,
    note: opts.note ?? null,
  });
  const [svc] = await tx
    .select({ key: services.key })
    .from(services)
    .where(eq(services.id, serviceId));
  // Atlas moves the level; the person whose gesture caused it is named in the line.
  await auditAtlasTx(tx, tenantId, null, "atlas.level_changed", {
    service: svc?.key ?? null,
    from,
    to,
    cause,
    grade: opts.grade ?? null,
    by: by?.name ?? null,
  });
  return { from, to };
}

/**
 * One level up when the record allows it — checked after every right grade,
 * every recount (a backtest, an undo window closing). Never more than one.
 */
export async function maybePromoteTx(
  tx: Tx,
  tenantId: string,
  serviceId: string,
): Promise<{ from: number; to: number } | null> {
  const rec = await recomputeServiceAutonomyTx(tx, tenantId, serviceId);
  const due = promotionDue(rec);
  if (due === null) return null;
  return setLevelTx(tx, tenantId, serviceId, due, "promotion", null, {
    note: `${rec.gradedRuns} graded runs · ${rec.rightPct ?? 0} % right`,
  });
}

/**
 * A grade after closure, by a person: written on the run, then the ladder
 * moves — a Miss one level down, Nowhere near back to L1, a right grade may
 * promote. Returns the change of level, if any.
 */
export async function gradeRunTx(
  tx: Tx,
  tenantId: string,
  investigationId: string,
  grade: InvestigationGrade,
  by: Actor,
  note?: string | null,
): Promise<{ serviceId: string | null; change: { from: number; to: number } | null }> {
  const [inv] = await tx
    .select({
      id: investigations.id,
      incidentId: investigations.incidentId,
      grade: investigations.grade,
      serviceId: sql<
        string | null
      >`(select service_id from app.incidents where id = ${investigations.incidentId})`,
    })
    .from(investigations)
    .where(and(eq(investigations.tenantId, tenantId), eq(investigations.id, investigationId)));
  if (!inv) return { serviceId: null, change: null };
  const previous = inv.grade;
  await tx
    .update(investigations)
    .set({
      grade,
      gradeNote: note ?? null,
      gradedByMemberId: by.memberId,
      gradedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(investigations.id, inv.id));
  if (!inv.serviceId) return { serviceId: null, change: null };
  let change: { from: number; to: number } | null = null;
  // Re-grading the same way moves nothing; a new Miss or Nowhere near does.
  if ((grade === "miss" || grade === "nowhere_near") && previous !== grade) {
    const [cur] = await tx
      .select({ level: serviceAutonomy.level })
      .from(serviceAutonomy)
      .where(eq(serviceAutonomy.serviceId, inv.serviceId));
    const to = levelAfter(cur?.level ?? 0, grade === "miss" ? "miss" : "nowhere_near");
    change = await setLevelTx(tx, tenantId, inv.serviceId, to, "grade", by, {
      investigationId: inv.id,
      grade,
    });
    await recomputeServiceAutonomyTx(tx, tenantId, inv.serviceId);
  } else {
    change = await maybePromoteTx(tx, tenantId, inv.serviceId);
  }
  return { serviceId: inv.serviceId, change };
}

export async function gradeRun(
  tenantId: string,
  investigationId: string,
  grade: InvestigationGrade,
  by: Actor,
  note?: string | null,
) {
  return withTenant(tenantId, (tx) => gradeRunTx(tx, tenantId, investigationId, grade, by, note));
}

/** A fall caused by a person's gesture on what Atlas did (undo, reopen). */
export async function dropTx(
  tx: Tx,
  tenantId: string,
  serviceId: string,
  cause: "undo" | "reopen",
  by: Actor,
  opts: { toL1?: boolean; investigationId?: string | null } = {},
) {
  const [cur] = await tx
    .select({ level: serviceAutonomy.level })
    .from(serviceAutonomy)
    .where(eq(serviceAutonomy.serviceId, serviceId));
  const level = cur?.level ?? 0;
  const to = opts.toL1 ? levelAfter(level, "reopen") : levelAfter(level, "undo");
  const change = await setLevelTx(tx, tenantId, serviceId, to, cause, by, {
    investigationId: opts.investigationId ?? null,
  });
  await recomputeServiceAutonomyTx(tx, tenantId, serviceId);
  return change;
}
