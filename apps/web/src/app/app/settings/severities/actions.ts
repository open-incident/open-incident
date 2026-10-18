"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { severities, statusPages, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";

const schema = z.object({
  severityId: z.string().uuid().or(z.literal("")).optional(),
  name: z.string().trim().min(1).max(20),
  description: z.string().trim().max(200).optional(),
});

/**
 * "+ Add severity" and "Edit": the name, the description, and the two things
 * a severity drives.
 *
 * - Starts the post-incident flow: the severity's own entry rule — on keeps
 *   "always" or "yes", off keeps "opt-in" or "no" (the flow reads always/yes).
 * - Proposes a status page update: incidents propose an update of the
 *   workspace's first status page from the worst severity down to that
 *   page's threshold. Switching it on moves the threshold down to this
 *   severity; off, up to the one above. The worst one is always proposed.
 */
export async function saveSeverity(_prev: DialogResult, formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.sev.errorName") };
  const input = parsed.data;
  const starts = formData.get("startsPost") === "on";
  const proposesRaw = formData.get("proposes");
  const proposes = proposesRaw === "keep" ? null : proposesRaw === "on";

  const out = await withTenant(current.tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(severities)
      .where(eq(severities.tenantId, current.tenant.id))
      .orderBy(asc(severities.rank));
    const row = input.severityId ? rows.find((s) => s.id === input.severityId) : undefined;
    if (input.severityId && !row) return { error: t("settingsV2.error.invalid") };
    if (rows.some((s) => s.id !== row?.id && s.name.toLowerCase() === input.name.toLowerCase()))
      return { error: t("settingsV2.sev.errorDuplicate") };

    let rank: number;
    if (row) {
      const postIncident = starts
        ? row.postIncident === "always" || row.postIncident === "yes"
          ? row.postIncident
          : "yes"
        : row.postIncident === "opt_in" || row.postIncident === "never"
          ? row.postIncident
          : "opt_in";
      await tx
        .update(severities)
        .set({ name: input.name, description: input.description || null, postIncident })
        .where(eq(severities.id, row.id));
      await recordAudit(tx, current, "config", "severity.updated", {
        from: row.name,
        to: input.name,
        postIncident,
      });
      rank = row.rank;
    } else {
      rank = Math.max(-1, ...rows.map((s) => s.rank)) + 1;
      await tx.insert(severities).values({
        tenantId: current.tenant.id,
        name: input.name,
        description: input.description || null,
        rank,
        postIncident: starts ? "yes" : "opt_in",
      });
      await recordAudit(tx, current, "config", "severity.created", {
        name: input.name,
        rank,
      });
    }

    // The status page's threshold, the one incidents read to propose an update.
    if (proposes !== null) {
      const [page] = await tx
        .select({
          id: statusPages.id,
          name: statusPages.name,
          minSeverityRank: statusPages.minSeverityRank,
        })
        .from(statusPages)
        .where(eq(statusPages.tenantId, current.tenant.id))
        .orderBy(asc(statusPages.createdAt))
        .limit(1);
      if (page) {
        const now = rank <= page.minSeverityRank;
        const next = proposes && !now ? rank : !proposes && now && rank > 0 ? rank - 1 : null;
        if (next !== null) {
          await tx
            .update(statusPages)
            .set({ minSeverityRank: next })
            .where(and(eq(statusPages.tenantId, current.tenant.id), eq(statusPages.id, page.id)));
          await recordAudit(tx, current, "config", "status_page.threshold_changed", {
            page: page.name,
            from: page.minSeverityRank,
            to: next,
          });
        }
      }
    }
    return { last: rows[rows.length - 1]?.name ?? null, created: !row };
  });
  if ("error" in out) return { ok: false, error: out.error ?? t("settingsV2.error.invalid") };
  revalidatePath("/app/settings/severities");
  revalidatePath("/app/settings/types");
  revalidatePath("/app/status-pages");
  revalidatePath("/app/incidents", "layout");
  return {
    ok: true,
    message: !out.created
      ? t("settingsV2.sev.saved", { name: input.name })
      : out.last
        ? t("settingsV2.sev.added", { name: input.name, last: out.last })
        : t("settingsV2.sev.addedFirst", { name: input.name }),
  };
}
