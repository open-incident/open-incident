"use server";

import { eq } from "drizzle-orm";
import { catalogEntries, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireResponder } from "@/lib/session";
import { suggestDeclaration } from "@/lib/ai-capabilities";

/** Declaration form — a sharper title and summary proposed from what was typed; the person keeps or edits. */
export async function suggestDeclarationAction(input: {
  name: string;
  summary: string;
  serviceEntryId: string | null;
}): Promise<{ value: { title: string; summary: string } } | { error: string }> {
  const current = await requireResponder();
  const serviceName = input.serviceEntryId
    ? await withTenant(current.tenant.id, async (tx) => {
        const [s] = await tx
          .select({ name: catalogEntries.name })
          .from(catalogEntries)
          .where(eq(catalogEntries.id, input.serviceEntryId!));
        return s?.name ?? null;
      })
    : null;
  const out = await suggestDeclaration(
    current.tenant.id,
    { kind: "member", memberId: current.member.id, name: current.member.name },
    { name: input.name.slice(0, 300), summary: input.summary.slice(0, 2000), serviceName },
  );
  if (out.ok) return { value: out.value };
  const t = await getT();
  return { error: t(`ai.refusal.${out.reason}`) };
}
