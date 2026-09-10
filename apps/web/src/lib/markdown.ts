/**
 * Markdown as people write it in a post-mortem, rendered to HTML that cannot
 * carry a script: raw HTML is shown as text, links keep only web protocols,
 * images become their caption (nothing is fetched from a third party). Used
 * on the server for the document and in the browser for the editor's preview.
 */
import { marked, type Tokens } from "marked";

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

export function renderMarkdown(body: string): string {
  const renderer = new marked.Renderer();
  renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);
  renderer.link = ({ href, tokens, title }: Tokens.Link) => {
    const text = renderer.parser.parseInline(tokens);
    const safe = /^(https?:|mailto:|\/|#)/i.test(href.trim()) ? href.trim() : "#";
    return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ""} target="_blank" rel="noreferrer">${text}</a>`;
  };
  renderer.image = ({ href, text }: Tokens.Image) => `<span>${escapeHtml(text || href)}</span>`;
  return marked.parse(body, { renderer, gfm: true, breaks: true, async: false }) as string;
}

/** A markdown table from headers and rows; pipes in cells are escaped. */
export function markdownTable(headers: string[], rows: string[][]): string {
  const cell = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}
