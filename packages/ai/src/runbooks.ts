/**
 * Runbooks — documentation the assistant may read, attached to a service.
 * Content is pasted, or fetched from a file at a URL: GitHub and GitLab files
 * through their APIs (the workspace's tracker token when one is connected,
 * anonymous otherwise), anything else as plain text. Indexed in the knowledge
 * layer only when the workspace allows documentation as a source.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { atlasDocuments, runbooks, withTenant, type Tx } from "@openincident/db";
import { listTrackerInstalls } from "@openincident/trackers";
import { getAiSettings, upsertAtlasDocument, type Actor } from "./governance";

export const RUNBOOK_MAX_CHARS = 60_000;
const SYSTEM_ACTOR: Actor = { kind: "system", memberId: null, name: "system" };

type Tokens = { github?: string; gitlab?: string };

function githubApi(): string {
  return (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/$/, "");
}
function gitlabApi(): string {
  return (process.env.GITLAB_API_BASE ?? "https://gitlab.com/api/v4").replace(/\/$/, "");
}

/** Parses a GitHub or GitLab file URL into an API call; null for any other URL. */
export function parseRunbookUrl(
  url: string,
):
  | { kind: "github"; repo: string; ref: string; path: string }
  | { kind: "gitlab"; project: string; ref: string; path: string }
  | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  if (u.hostname === "github.com" || u.hostname === "www.github.com") {
    // /owner/repo/blob/<ref>/<path…>
    if (parts.length >= 5 && parts[2] === "blob")
      return {
        kind: "github",
        repo: `${parts[0]}/${parts[1]}`,
        ref: parts[3]!,
        path: parts.slice(4).join("/"),
      };
    return null;
  }
  const dash = parts.indexOf("-");
  if (dash > 0 && parts[dash + 1] === "blob" && parts.length >= dash + 4) {
    return {
      kind: "gitlab",
      project: parts.slice(0, dash).join("/"),
      ref: parts[dash + 2]!,
      path: parts.slice(dash + 3).join("/"),
    };
  }
  return null;
}

/** The file's text, from the API of its forge or as plain text; throws on refusal. */
export async function fetchRunbookContent(url: string, tokens: Tokens = {}): Promise<string> {
  const parsed = parseRunbookUrl(url);
  const signal = AbortSignal.timeout(20_000);
  if (parsed?.kind === "github") {
    const res = await fetch(
      `${githubApi()}/repos/${parsed.repo}/contents/${parsed.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(parsed.ref)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "open-incident",
          ...(tokens.github ? { authorization: `Bearer ${tokens.github}` } : {}),
        },
        signal,
      },
    );
    if (!res.ok) throw new Error(`github_${res.status}`);
    const data = (await res.json()) as { content?: string; encoding?: string };
    if (!data.content) throw new Error("github_no_content");
    return Buffer.from(
      data.content.replace(/\n/g, ""),
      data.encoding === "base64" ? "base64" : "utf8",
    )
      .toString("utf8")
      .slice(0, RUNBOOK_MAX_CHARS);
  }
  if (parsed?.kind === "gitlab") {
    const res = await fetch(
      `${gitlabApi()}/projects/${encodeURIComponent(parsed.project)}/repository/files/${encodeURIComponent(parsed.path)}/raw?ref=${encodeURIComponent(parsed.ref)}`,
      {
        headers: tokens.gitlab ? { "private-token": tokens.gitlab } : {},
        signal,
      },
    );
    if (!res.ok) throw new Error(`gitlab_${res.status}`);
    return (await res.text()).slice(0, RUNBOOK_MAX_CHARS);
  }
  const res = await fetch(url, {
    headers: { accept: "text/markdown, text/plain;q=0.9, */*;q=0.1" },
    signal,
  });
  if (!res.ok) throw new Error(`fetch_${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (/html/.test(type)) throw new Error("html_not_supported");
  return (await res.text()).slice(0, RUNBOOK_MAX_CHARS);
}

async function tokensFor(tx: Tx, tenantId: string): Promise<Tokens> {
  const installs = await listTrackerInstalls(tx, tenantId).catch(() => []);
  return {
    github: installs.find((i) => i.kind === "github")?.secret,
    gitlab: installs.find((i) => i.kind === "gitlab")?.secret,
  };
}

/** Puts the runbook in the knowledge layer — or takes it out when documentation is not an allowed source. */
export async function indexRunbook(tenantId: string, id: string): Promise<void> {
  const [row, settings] = await withTenant(
    tenantId,
    async (tx) =>
      [
        (
          await tx
            .select()
            .from(runbooks)
            .where(and(eq(runbooks.tenantId, tenantId), eq(runbooks.id, id)))
        )[0] ?? null,
        await getAiSettings(tx, tenantId),
      ] as const,
  );
  if (!row) return;
  if (!settings.sources.docs || !row.content.trim()) {
    await withTenant(tenantId, (tx) =>
      tx
        .delete(atlasDocuments)
        .where(
          and(
            eq(atlasDocuments.tenantId, tenantId),
            eq(atlasDocuments.source, "runbook"),
            eq(atlasDocuments.refId, id),
          ),
        ),
    );
    return;
  }
  await upsertAtlasDocument(
    tenantId,
    { source: "runbook", refId: id, title: row.title, summary: row.content.slice(0, 4000) },
    SYSTEM_ACTOR,
  );
}

/** Fetches a URL-based runbook again; records the error instead of failing. Returns whether the content changed. */
export async function refreshRunbook(tenantId: string, id: string): Promise<boolean> {
  const prepared = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(runbooks)
      .where(and(eq(runbooks.tenantId, tenantId), eq(runbooks.id, id)));
    if (!row?.sourceUrl) return null;
    return { row, tokens: await tokensFor(tx, tenantId) };
  });
  if (!prepared) return false;
  const now = new Date();
  try {
    const content = await fetchRunbookContent(prepared.row.sourceUrl!, prepared.tokens);
    const hash = createHash("sha256").update(content).digest("hex");
    const changed = hash !== prepared.row.contentHash;
    await withTenant(tenantId, (tx) =>
      tx
        .update(runbooks)
        .set({ content, contentHash: hash, fetchedAt: now, fetchError: null, updatedAt: now })
        .where(eq(runbooks.id, id)),
    );
    if (changed) await indexRunbook(tenantId, id);
    return changed;
  } catch (err) {
    await withTenant(tenantId, (tx) =>
      tx
        .update(runbooks)
        .set({
          fetchedAt: now,
          fetchError: err instanceof Error ? err.message : String(err),
          updatedAt: now,
        })
        .where(eq(runbooks.id, id)),
    );
    return false;
  }
}

/** The worker's pass: every URL-based runbook of every live workspace. */
export async function sweepRunbooks(tenantIds: string[]): Promise<number> {
  let changed = 0;
  for (const tenantId of tenantIds) {
    const ids = await withTenant(tenantId, (tx) =>
      tx
        .select({ id: runbooks.id })
        .from(runbooks)
        .where(and(eq(runbooks.tenantId, tenantId), isNotNull(runbooks.sourceUrl))),
    );
    for (const { id } of ids) if (await refreshRunbook(tenantId, id)) changed++;
  }
  return changed;
}

/** The runbooks of a service (and the workspace-wide ones), oldest first. */
export async function runbooksForService(tx: Tx, tenantId: string, serviceEntryId: string | null) {
  const rows = await tx
    .select()
    .from(runbooks)
    .where(eq(runbooks.tenantId, tenantId))
    .orderBy(asc(runbooks.createdAt));
  return rows.filter((r) => r.serviceEntryId === null || r.serviceEntryId === serviceEntryId);
}

/** What the dossier may quote: the runbooks of the service, trimmed, when documentation is an allowed source. */
export async function runbookExcerpts(
  tx: Tx,
  tenantId: string,
  serviceEntryId: string | null,
  maxChars = 6000,
): Promise<string[]> {
  const settings = await getAiSettings(tx, tenantId);
  if (!settings.sources.docs) return [];
  const rows = await runbooksForService(tx, tenantId, serviceEntryId);
  const out: string[] = [];
  let budget = maxChars;
  for (const r of rows) {
    if (!r.content.trim() || budget <= 0) continue;
    const excerpt = r.content.slice(0, Math.min(budget, 3000));
    budget -= excerpt.length;
    out.push(`## ${r.title}${r.sourceUrl ? ` (${r.sourceUrl})` : ""}\n${excerpt}`);
  }
  return out;
}
