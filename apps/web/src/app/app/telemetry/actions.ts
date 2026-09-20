"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isManager, requireMember } from "@/lib/session";
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
