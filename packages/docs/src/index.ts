/**
 * Documentation tools — Confluence Cloud and Notion. Two thin adapters over
 * plain fetch: test the credentials, create a page from a post-mortem's
 * sections. Base URLs come from the environment so the smoke suite can stand
 * in for the vendors; production uses their hosts.
 */
export type DocsKind = "confluence" | "notion";
export const DOCS_KINDS: DocsKind[] = ["confluence", "notion"];

export type DocsConfig =
  | { kind: "confluence"; site: string; email: string; spaceKey: string; parentPageId?: string }
  | { kind: "notion"; parentPageId: string };

export type DocSection = { title: string; body: string };
export type DocPage = {
  title: string;
  subtitle?: string;
  sections: DocSection[];
  sourceUrl: string;
};
export type CreatedDoc = { id: string; url: string };

const timeout = () => AbortSignal.timeout(20_000);

function confluenceBase(site: string): string {
  return (
    process.env.CONFLUENCE_API_BASE ??
    `https://${site.replace(/^https?:\/\//, "").replace(/\/$/, "")}/wiki`
  ).replace(/\/$/, "");
}
function notionBase(): string {
  return (process.env.NOTION_API_BASE ?? "https://api.notion.com").replace(/\/$/, "");
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()) as T;
}

function confluenceHeaders(config: { email: string }, token: string): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${config.email}:${token}`).toString("base64")}`,
    accept: "application/json",
    "content-type": "application/json",
  };
}
function notionHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "notion-version": "2022-06-28",
    "content-type": "application/json",
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Confluence storage format: headings, paragraphs, and bullet lists for "- " lines. */
export function confluenceBody(page: DocPage): string {
  const parts: string[] = [];
  if (page.subtitle) parts.push(`<p><em>${esc(page.subtitle)}</em></p>`);
  for (const s of page.sections) {
    parts.push(`<h2>${esc(s.title)}</h2>`);
    const lines = s.body.split("\n").filter((l) => l.trim() !== "");
    if (lines.length && lines.every((l) => l.startsWith("- ")))
      parts.push(`<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join("")}</ul>`);
    else
      for (const para of s.body.split(/\n{2,}/))
        if (para.trim()) parts.push(`<p>${esc(para).replace(/\n/g, "<br/>")}</p>`);
  }
  parts.push(`<p><a href="${esc(page.sourceUrl)}">Open in Open Incident</a></p>`);
  return parts.join("");
}

/** Notion blocks: heading_2, paragraph, bulleted_list_item, with text chunks under the 2000-character limit. */
export function notionBlocks(page: DocPage): unknown[] {
  const rich = (text: string) => [{ type: "text", text: { content: text.slice(0, 2000) } }];
  const blocks: unknown[] = [];
  if (page.subtitle)
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: { content: page.subtitle.slice(0, 2000) },
            annotations: { italic: true },
          },
        ],
      },
    });
  for (const s of page.sections) {
    blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: rich(s.title) } });
    const lines = s.body.split("\n").filter((l) => l.trim() !== "");
    if (lines.length && lines.every((l) => l.startsWith("- ")))
      for (const l of lines)
        blocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: rich(l.slice(2)) },
        });
    else
      for (const para of s.body.split(/\n{2,}/))
        if (para.trim())
          blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: rich(para) } });
  }
  blocks.push({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        { type: "text", text: { content: "Open in Open Incident", link: { url: page.sourceUrl } } },
      ],
    },
  });
  return blocks.slice(0, 100);
}

export async function testDocs(
  config: DocsConfig,
  secret: string,
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  try {
    if (config.kind === "confluence") {
      const space = await json<{ key: string; name?: string }>(
        await fetch(
          `${confluenceBase(config.site)}/rest/api/space/${encodeURIComponent(config.spaceKey)}`,
          { headers: confluenceHeaders(config, secret), signal: timeout() },
        ),
      );
      return { ok: true, detail: `${space.name ?? space.key} · ${config.site}` };
    }
    const me = await json<{ name?: string; bot?: { workspace_name?: string } }>(
      await fetch(`${notionBase()}/v1/users/me`, {
        headers: notionHeaders(secret),
        signal: timeout(),
      }),
    );
    await json<{ id: string }>(
      await fetch(`${notionBase()}/v1/pages/${encodeURIComponent(config.parentPageId)}`, {
        headers: notionHeaders(secret),
        signal: timeout(),
      }),
    );
    return { ok: true, detail: me.bot?.workspace_name ?? me.name ?? "Notion" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createDocPage(
  config: DocsConfig,
  secret: string,
  page: DocPage,
): Promise<CreatedDoc> {
  if (config.kind === "confluence") {
    const created = await json<{ id: string; _links?: { base?: string; webui?: string } }>(
      await fetch(`${confluenceBase(config.site)}/rest/api/content`, {
        method: "POST",
        headers: confluenceHeaders(config, secret),
        body: JSON.stringify({
          type: "page",
          title: page.title.slice(0, 250),
          space: { key: config.spaceKey },
          ...(config.parentPageId ? { ancestors: [{ id: config.parentPageId }] } : {}),
          body: { storage: { value: confluenceBody(page), representation: "storage" } },
        }),
        signal: timeout(),
      }),
    );
    const base =
      created._links?.base ??
      `https://${config.site.replace(/^https?:\/\//, "").replace(/\/$/, "")}/wiki`;
    return { id: created.id, url: `${base}${created._links?.webui ?? `/pages/${created.id}`}` };
  }
  const created = await json<{ id: string; url?: string }>(
    await fetch(`${notionBase()}/v1/pages`, {
      method: "POST",
      headers: notionHeaders(secret),
      body: JSON.stringify({
        parent: { page_id: config.parentPageId },
        properties: {
          title: { title: [{ type: "text", text: { content: page.title.slice(0, 2000) } }] },
        },
        children: notionBlocks(page),
      }),
      signal: timeout(),
    }),
  );
  return {
    id: created.id,
    url: created.url ?? `https://www.notion.so/${created.id.replace(/-/g, "")}`,
  };
}

export function docsLabel(kind: DocsKind): string {
  return kind === "confluence" ? "Confluence" : "Notion";
}
export function docsTarget(config: DocsConfig): string {
  return config.kind === "confluence" ? `${config.site} · ${config.spaceKey}` : config.parentPageId;
}
