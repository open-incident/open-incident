"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  exceptionGroups,
  incidentEvents,
  incidents,
  savedQueries,
  withTenant,
  type ExceptionGroupStatus,
  type SavedQuerySignal,
} from "@openincident/db";
import {
  compileFilter,
  compileUserSql,
  packById,
  parsePromql,
  type PackId,
} from "@openincident/telemetry";
import { packDashboardSlug, placePack } from "@openincident/oncall";
import { canRespond, isManager, requireMember } from "@/lib/session";
import { issueKey, revokeKey } from "@/lib/telemetry";

const PAGE = "/app/telemetry?tab=connect";

/**
 * Issues a key and hands it back through the URL, once.
 *
 * Deliberately not stored anywhere to be displayed later: the digest is all we
 * keep, so the only moment the operator can copy it is now. The screen says so
 * before the button, not after.
 */
export async function createIngestionKey(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  if (!isManager(member)) redirect(PAGE);
  const key = await issueKey(tenant.id, String(form.get("label") ?? "").trim());
  revalidatePath("/app/telemetry");
  redirect(`${PAGE}&issued=${encodeURIComponent(key)}`);
}

export async function revokeIngestionKey(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  if (!isManager(member)) redirect(PAGE);
  await revokeKey(tenant.id, String(form.get("id") ?? ""));
  revalidatePath("/app/telemetry");
  redirect(PAGE);
}

/**
 * Records what the workspace has decided about one exception group.
 *
 * `snoozed` needs a date, and it is chosen here rather than asked for: a
 * picker on a button whose whole purpose is "not now" is a question nobody
 * wants. A day is the answer that makes the group quiet through the incident
 * being worked on and loud again the next morning.
 */
export async function setExceptionStatus(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  const fingerprint = String(form.get("fingerprint") ?? "").trim();
  const status = String(form.get("status") ?? "");
  const back = `/app/telemetry?tab=exceptions&fp=${encodeURIComponent(fingerprint)}`;
  if (!canRespond(member) || !fingerprint || !STATUSES.includes(status as ExceptionGroupStatus)) {
    redirect(back);
  }

  const now = new Date();
  const next = status as ExceptionGroupStatus;
  const values = {
    status: next,
    snoozedUntil: next === "snoozed" ? new Date(now.getTime() + SNOOZE_HOURS * 3_600_000) : null,
    resolvedAt: next === "resolved" ? now : null,
    resolvedByMemberId: next === "resolved" ? member.id : null,
    updatedAt: now,
  };
  await withTenant(tenant.id, (tx) =>
    tx
      .insert(exceptionGroups)
      .values({ tenantId: tenant.id, fingerprint, firstSeenAt: now, ...values })
      .onConflictDoUpdate({
        target: [exceptionGroups.tenantId, exceptionGroups.fingerprint],
        set: values,
      }),
  );
  revalidatePath("/app/telemetry");
  redirect(back);
}

const STATUSES: ExceptionGroupStatus[] = ["open", "resolved", "ignored", "snoozed"];
const SNOOZE_HOURS = 24;

/**
 * Saving the query somebody is looking at.
 *
 * Compiled before it is stored, with the same compiler the explorer and the
 * monitors use: a saved query that does not run is a bookmark to a failure,
 * and the moment to say so is while the person still remembers what they
 * meant.
 */
export async function saveQuery(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  const signal = String(form.get("signal") ?? "");
  const query = String(form.get("query") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  const service = String(form.get("service") ?? "").trim();
  const back = `/app/telemetry?tab=${encodeURIComponent(signal)}${query ? `&q=${encodeURIComponent(query)}` : ""}`;

  if (!canRespond(member) || !SIGNALS.includes(signal as SavedQuerySignal) || !name || !query) {
    redirect(`${back}&error=invalid`);
  }
  const refusal = savedQueryError(signal as SavedQuerySignal, query);
  if (refusal) redirect(`${back}&error=query&why=${encodeURIComponent(refusal)}`);

  await withTenant(tenant.id, (tx) =>
    tx
      .insert(savedQueries)
      .values({
        tenantId: tenant.id,
        name,
        signal: signal as SavedQuerySignal,
        query,
        service: service || null,
        createdByMemberId: member.id,
      })
      // A name reused is the same query being refined, not a second one: the
      // alternative is a list with four things called "checkout errors".
      .onConflictDoUpdate({
        target: [savedQueries.tenantId, savedQueries.signal, savedQueries.name],
        set: { query, service: service || null, updatedAt: new Date() },
      }),
  );
  revalidatePath("/app/telemetry");
  redirect(back);
}

export async function deleteSavedQuery(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  const id = String(form.get("id") ?? "");
  const signal = String(form.get("signal") ?? "logs");
  if (canRespond(member) && id) {
    await withTenant(tenant.id, (tx) =>
      tx
        .delete(savedQueries)
        .where(and(eq(savedQueries.tenantId, tenant.id), eq(savedQueries.id, id))),
    );
  }
  revalidatePath("/app/telemetry");
  redirect(`/app/telemetry?tab=${encodeURIComponent(signal)}`);
}

const SIGNALS: SavedQuerySignal[] = ["logs", "traces", "exceptions", "metrics", "sql"];

/** Whether the query would run, checked with whichever compiler owns it. */
function savedQueryError(signal: SavedQuerySignal, query: string): string | null {
  try {
    if (signal === "sql") compileUserSql(query);
    else if (signal === "metrics") parsePromql(query);
    else compileFilter(signal, query);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

/**
 * Places a collector pack's dashboard, on request.
 *
 * The sweep does this by itself the first time a pack reports; this is the
 * other way in, for a workspace that deleted the dashboard and changed its
 * mind, or that wants the screen ready before the collector is running. A pack
 * already placed is not placed twice — the reader is sent to the one they have.
 */
export async function installPackDashboard(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  if (!isManager(member)) redirect(PAGE);
  const pack = String(form.get("pack") ?? "");
  if (!packById(pack)) redirect(PAGE);
  const id = pack as PackId;

  const slug =
    (await placePack(tenant.id, id, member.id)) ?? (await packDashboardSlug(tenant.id, id));
  revalidatePath(PAGE);
  redirect(slug ? `/app/dashboards/${slug}` : `${PAGE}&error=pack`);
}

/**
 * Hangs a trace on an incident, as a timeline entry that leads back to it.
 *
 * A trace is evidence, and evidence that lives in somebody's browser tab is
 * evidence the post-mortem will not have. `link_added` is the kind the
 * timeline already renders and already stores a URL for; this is the first
 * thing to fill it in with something that is not an issue tracker.
 */
export async function attachTraceToIncident(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  const traceId = String(form.get("trace") ?? "").trim();
  if (!canRespond(member) || !traceId) redirect(`/app/telemetry?tab=traces&trace=${traceId}`);
  const incidentId = z.string().uuid().parse(form.get("incident"));
  const title = String(form.get("title") ?? "").slice(0, 200);

  const number = await withTenant(tenant.id, async (tx) => {
    const [inc] = await tx
      .select({ id: incidents.id, number: incidents.number })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenant.id), eq(incidents.id, incidentId)));
    if (!inc) return null;
    await tx.insert(incidentEvents).values({
      tenantId: tenant.id,
      incidentId: inc.id,
      kind: "link_added",
      actorKind: "member",
      actorMemberId: member.id,
      actorName: member.name,
      payload: {
        provider: "telemetry",
        kind: "trace",
        ref: traceId.slice(0, 16),
        title,
        url: `/app/telemetry?tab=traces&trace=${traceId}`,
      },
    });
    return inc.number;
  });

  revalidatePath(`/app/incidents/${number ?? ""}`);
  redirect(
    number
      ? `/app/telemetry?tab=traces&trace=${traceId}&attached=${number}`
      : `/app/telemetry?tab=traces&trace=${traceId}`,
  );
}
