"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getT } from "@/i18n/server";
import { exportPostMortem } from "@/lib/docs";
import { requireResponder } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";

/** "Export to Confluence / Notion" — the page is created there, the link kept here. */
export async function exportPostMortemAction(formData: FormData) {
  const current = await requireResponder();
  const number = z.coerce.number().int().positive().parse(formData.get("number"));
  const kind = z.enum(["confluence", "notion"]).parse(formData.get("kind"));
  const res = await exportPostMortem(
    current.tenant.id,
    number,
    kind,
    { memberId: current.member.id, name: current.member.name },
    await currentOrigin(),
  );
  revalidatePath(`/app/incidents/${number}`);
  if (!res.ok) {
    const t = await getT();
    // Surfaced on the next render through the query string; the page reads it.
    const { redirect } = await import("next/navigation");
    redirect(
      `/app/incidents/${number}?tab=post-incident&exportError=${encodeURIComponent(t(`postMortem.exportError.${res.reason}`))}`,
    );
  }
}
