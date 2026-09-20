"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exceptionGroups, withTenant, type ExceptionGroupStatus } from "@openincident/db";
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
