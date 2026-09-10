import { eq } from "drizzle-orm";
import { withTenant, workspaces } from "@openincident/db";
import { buildTranslate } from "@/i18n/server";
import { resolveLocale } from "@/i18n/locales";
import { apiAuth, apiError, apiJson } from "@/lib/api";
import { getIncident } from "@/lib/incidents";
import { documentMarkdown, documentTitle, sectionTitle } from "@/lib/post-mortem";

export const dynamic = "force-dynamic";

function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/^INC-/i, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET /api/v1/incidents/{number}/post-mortem — the document, as sections and as markdown. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const number = parseNumber((await params).number);
  if (!number) return apiError(404, "not_found", "No such incident.");
  const tenantId = auth.ctx.tenant.id;
  const data = await withTenant(tenantId, async (tx) => {
    const inc = await getIncident(tx, tenantId, number);
    const [ws] = await tx
      .select({
        locale: workspaces.locale,
        timezone: workspaces.timezone,
        term: workspaces.postMortemTerm,
      })
      .from(workspaces)
      .where(eq(workspaces.tenantId, tenantId));
    return { inc, ws };
  });
  if (!data.inc) return apiError(404, "not_found", "No such incident.");
  const pm = data.inc.postMortem;
  if (!pm) return apiError(404, "no_post_mortem", "This incident has no post-mortem yet.");
  const t = buildTranslate(resolveLocale(data.ws?.locale), data.ws?.timezone ?? "Europe/Paris");
  const term = data.ws?.term ?? t("postMortem.title");
  return apiJson({
    incident: `INC-${number}`,
    title: documentTitle(data.inc, pm),
    status: pm.status,
    ai_drafted: pm.aiDrafted,
    owner: pm.ownerName,
    updated_at: pm.updatedAt.toISOString(),
    published_at: pm.publishedAt?.toISOString() ?? null,
    external_url: pm.externalUrl,
    sections: pm.sections.map((s) => ({ key: s.key, title: sectionTitle(s, t), body: s.body })),
    markdown: documentMarkdown(data.inc, pm, t, term),
  });
}
