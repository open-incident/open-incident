/**
 * The user guide: Markdown chapters under docs/guide, read from the repository
 * at request time and rendered inside the product. The same files are meant
 * for the public website later — they carry no product markup, only a small
 * front matter (title, section, order) and relative image paths.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { cache } from "react";
import { marked, type Tokens } from "marked";

export type ChapterMeta = {
  slug: string;
  title: string;
  section: string;
  order: number;
  summary: string;
};

export type Chapter = ChapterMeta & {
  html: string;
  headings: Array<{ id: string; text: string; level: number }>;
};

/** Sections in reading order; the key is what a chapter's front matter names. */
export const GUIDE_SECTIONS = [
  "getting-started",
  "daily-use",
  "configuration",
  "integrations",
  "enterprise",
  "operations",
  "use-cases",
  "reference",
] as const;
export type GuideSection = (typeof GUIDE_SECTIONS)[number];

/** docs/guide, wherever the process runs from: the repository, apps/web, or the standalone image. */
export function guideRoot(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "docs/guide"),
    path.resolve(process.cwd(), "../../docs/guide"),
    path.resolve(process.cwd(), "../docs/guide"),
  ];
  return candidates.find((c) => existsSync(path.join(c, "index.json")) || existsSync(c)) ?? null;
}

function frontMatter(source: string): { meta: Record<string, string>; body: string } {
  const m = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: source };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]!] = kv[2]!.replace(/^"(.*)"$/, "$1").trim();
  }
  return { meta, body: source.slice(m[0].length) };
}

export const listChapters = cache((): ChapterMeta[] => {
  const root = guideRoot();
  if (!root) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const { meta } = frontMatter(readFileSync(path.join(root, file), "utf8"));
      const slug = file.replace(/\.md$/, "").replace(/^\d+-/, "");
      return {
        slug,
        title: meta.title ?? slug,
        section: meta.section ?? "reference",
        order: Number(meta.order ?? file.match(/^(\d+)-/)?.[1] ?? 999),
        summary: meta.summary ?? "",
      };
    })
    .sort((a, b) => a.order - b.order);
});

/** The rail shows heading text as text, not as the HTML marked produced. */
function decodeEntities(html: string): string {
  return html
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

/**
 * Renders a chapter. Images resolve to the product's image route, headings
 * get ids for the "on this page" rail, external links open in a new tab.
 * The source is the repository's own — no user content is rendered here.
 */
export const readChapter = cache((slug: string): Chapter | null => {
  const root = guideRoot();
  if (!root) return null;
  const file = readdirSync(root).find((f) => f.replace(/\.md$/, "").replace(/^\d+-/, "") === slug);
  if (!file) return null;
  const meta = listChapters().find((c) => c.slug === slug)!;
  const { body } = frontMatter(readFileSync(path.join(root, file), "utf8"));
  const headings: Chapter["headings"] = [];
  const used = new Set<string>();
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens, depth }: Tokens.Heading) => {
    const text = renderer.parser.parseInline(tokens);
    let id = slugify(text) || `h-${headings.length}`;
    while (used.has(id)) id = `${id}-`;
    used.add(id);
    if (depth === 2 || depth === 3)
      headings.push({ id, text: decodeEntities(text.replace(/<[^>]+>/g, "")), level: depth });
    return `<h${depth} id="${id}">${text}</h${depth}>\n`;
  };
  renderer.image = ({ href, text, title }: Tokens.Image) => {
    const file = href.replace(/^\.?\/?img\//, "").replace(/[^a-zA-Z0-9._-]/g, "");
    const cap = title ?? text;
    return `<figure><img src="/app/docs/img/${file}" alt="${text}" loading="lazy" />${cap ? `<figcaption>${cap}</figcaption>` : ""}</figure>`;
  };
  renderer.link = ({ href, tokens, title }: Tokens.Link) => {
    const text = renderer.parser.parseInline(tokens);
    const external = /^https?:\/\//.test(href);
    // A chapter link is written as a bare slug (e.g. `alerts`) or `alerts#section`.
    const target =
      external || href.startsWith("/") || href.startsWith("#")
        ? href
        : `/app/docs/${href.replace(/\.md$/, "")}`;
    return `<a href="${target}"${title ? ` title="${title}"` : ""}${external ? ' target="_blank" rel="noreferrer"' : ""}>${text}</a>`;
  };
  const html = marked.parse(body, { renderer, gfm: true, breaks: false }) as string;
  return { ...meta, html, headings };
});

/** Previous and next chapters in reading order. */
export function neighbours(slug: string): { prev: ChapterMeta | null; next: ChapterMeta | null } {
  const all = listChapters();
  const i = all.findIndex((c) => c.slug === slug);
  return {
    prev: i > 0 ? all[i - 1]! : null,
    next: i >= 0 && i < all.length - 1 ? all[i + 1]! : null,
  };
}
