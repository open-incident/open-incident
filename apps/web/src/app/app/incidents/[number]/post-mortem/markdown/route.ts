import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { currentMember } from "@/lib/session";
import { getIncident } from "@/lib/incidents";
import { documentMarkdown } from "@/lib/post-mortem";

export const dynamic = "force-dynamic";

/** The post-mortem as a markdown file — what a wiki, a repository or an email wants. */
export async function GET(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const current = await currentMember();
  if (!current) return new Response("unauthorized", { status: 401 });
  const number = Number((await params).number);
  if (!Number.isInteger(number) || number <= 0) return new Response("not found", { status: 404 });
  const inc = await withTenant(current.tenant.id, (tx) =>
    getIncident(tx, current.tenant.id, number),
  );
  if (!inc?.postMortem) return new Response("not found", { status: 404 });
  const t = await getT();
  const term = current.workspace.postMortemTerm ?? t("postMortem.title");
  const body = documentMarkdown(inc, inc.postMortem, t, term);
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="INC-${number}-post-mortem.md"`,
      "cache-control": "no-store",
    },
  });
}
