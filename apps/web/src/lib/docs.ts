/**
 * Documentation tools, the product side: the workspace's Confluence or Notion
 * connection, and the export of a post-mortem as a page there. The page is a
 * copy at a moment; the post-mortem here stays the source and keeps the link.
 */
import { and, asc, eq } from "drizzle-orm";
import { decryptSecret } from "@openincident/crypto";
import {
  incidentEvents,
  incidents,
  integrationInstalls,
  postMortems,
  severities,
  withTenant,
  type Tx,
} from "@openincident/db";
import {
  DOCS_KINDS,
  createDocPage,
  docsLabel,
  type DocsConfig,
  type DocsKind,
} from "@openincident/docs";

export type DocsInstall = {
  id: string;
  kind: DocsKind;
  config: DocsConfig;
  secret: string;
  label: string;
};
export type ConnectedDocs = { kind: DocsKind; label: string };

function isDocsKind(kind: string): kind is DocsKind {
  return (DOCS_KINDS as string[]).includes(kind);
}

export async function listDocsInstalls(tx: Tx, tenantId: string): Promise<DocsInstall[]> {
  const rows = await tx
    .select()
    .from(integrationInstalls)
    .where(
      and(eq(integrationInstalls.tenantId, tenantId), eq(integrationInstalls.status, "active")),
    )
    .orderBy(asc(integrationInstalls.createdAt));
  const out: DocsInstall[] = [];
  for (const r of rows) {
    if (!isDocsKind(r.kind)) continue;
    const secret = decryptSecret(r.encryptedSecrets);
    if (!secret) continue;
    out.push({
      id: r.id,
      kind: r.kind,
      config: { ...(r.config as Omit<DocsConfig, "kind">), kind: r.kind } as DocsConfig,
      secret,
      label: r.externalName ?? docsLabel(r.kind),
    });
  }
  return out;
}

/** Kinds and labels only — what a page may show. */
export async function connectedDocs(tx: Tx, tenantId: string): Promise<ConnectedDocs[]> {
  return (await listDocsInstalls(tx, tenantId)).map((i) => ({
    kind: i.kind,
    label: docsLabel(i.kind),
  }));
}

export type ExportOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: "not_found" | "empty" | "not_connected" | "failed"; detail?: string };

/** Creates the page from the post-mortem's written sections and keeps its address on the post-mortem. */
export async function exportPostMortem(
  tenantId: string,
  number: number,
  kind: DocsKind,
  actor: { memberId: string | null; name: string },
  origin: string,
  titles: { severity?: string | null } = {},
): Promise<ExportOutcome> {
  type Prepared =
    | { error: "not_found" | "empty" | "not_connected" }
    | {
        row: {
          inc: typeof incidents.$inferSelect;
          pm: typeof postMortems.$inferSelect;
          sevName: string | null;
        };
        sections: Array<{ key: string; title: string; body: string }>;
        install: DocsInstall;
      };
  const prepared = await withTenant(tenantId, async (tx): Promise<Prepared> => {
    const [row] = await tx
      .select({ inc: incidents, pm: postMortems, sevName: severities.name })
      .from(incidents)
      .innerJoin(postMortems, eq(postMortems.incidentId, incidents.id))
      .leftJoin(severities, eq(severities.id, incidents.severityId))
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    if (!row) return { error: "not_found" };
    const sections = row.pm.sections.filter((s) => s.body.trim() !== "");
    if (sections.length === 0) return { error: "empty" };
    const install = (await listDocsInstalls(tx, tenantId)).find((i) => i.kind === kind);
    if (!install) return { error: "not_connected" };
    return { row, sections, install };
  });
  if ("error" in prepared) return { ok: false, reason: prepared.error };
  const { row, sections, install } = prepared;
  void titles;
  const title = `INC-${row.inc.number} — ${row.inc.name}`;
  const subtitle = [
    row.sevName,
    row.inc.declaredAt.toISOString().slice(0, 10),
    row.pm.aiDrafted ? "AI-drafted, human-reviewed" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  let created: { id: string; url: string };
  try {
    created = await createDocPage(install.config, install.secret, {
      title,
      subtitle,
      sections,
      sourceUrl: `${origin}/app/incidents/${row.inc.number}`,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(postMortems)
      .set({ externalUrl: created.url })
      .where(eq(postMortems.id, row.pm.id));
    await tx.insert(incidentEvents).values({
      tenantId,
      incidentId: row.inc.id,
      kind: "link_added",
      actorKind: actor.memberId ? "member" : "system",
      actorMemberId: actor.memberId,
      actorName: actor.name,
      payload: {
        provider: kind,
        kind: "post_mortem",
        ref: docsLabel(kind),
        title: `Post-mortem — ${title}`,
        url: created.url,
      },
    });
  });
  return { ok: true, url: created.url };
}
