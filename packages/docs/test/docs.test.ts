import { afterEach, describe, expect, it, vi } from "vitest";
import { confluenceBody, createDocPage, notionBlocks, testDocs } from "../src/index";

const page = {
  title: "INC-217 — Checkout latency",
  subtitle: "SEV2 · 26 Aug",
  sections: [
    {
      title: "Summary",
      body: "Between 13:55 and 15:20 latency degraded.\n\nAbout 4 % of attempts failed.",
    },
    { title: "What went well", body: "- Ack in 4 min\n- Status page updated" },
  ],
  sourceUrl: "https://x/app/incidents/217",
};
afterEach(() => vi.unstubAllGlobals());

describe("docs", () => {
  it("renders sections as Confluence storage and Notion blocks, escaping and splitting bullets", () => {
    const html = confluenceBody(page);
    expect(html).toContain("<h2>Summary</h2>");
    expect(html).toContain("<ul><li>Ack in 4 min</li><li>Status page updated</li></ul>");
    expect(html).toContain('href="https://x/app/incidents/217"');
    const blocks = notionBlocks(page) as Array<{ type: string }>;
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "heading_2",
      "paragraph",
      "paragraph",
      "heading_2",
      "bulleted_list_item",
      "bulleted_list_item",
      "paragraph",
    ]);
  });

  it("creates pages through the configured bases and reports failed tests instead of throwing", async () => {
    process.env.CONFLUENCE_API_BASE = "http://mock/wiki";
    process.env.NOTION_API_BASE = "http://mock/notion";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/rest/api/content"))
        return new Response(
          JSON.stringify({
            id: "123",
            _links: { base: "https://acme.atlassian.net/wiki", webui: "/spaces/OPS/pages/123" },
          }),
          { status: 200 },
        );
      if (url.endsWith("/v1/pages"))
        return new Response(
          JSON.stringify({ id: "abc-def", url: "https://www.notion.so/abcdef" }),
          { status: 200 },
        );
      return new Response("nope", { status: 401 });
    });
    const c = await createDocPage(
      { kind: "confluence", site: "acme.atlassian.net", email: "a@b.c", spaceKey: "OPS" },
      "t",
      page,
    );
    expect(c.url).toBe("https://acme.atlassian.net/wiki/spaces/OPS/pages/123");
    const n = await createDocPage({ kind: "notion", parentPageId: "parent" }, "t", page);
    expect(n.url).toBe("https://www.notion.so/abcdef");
    expect(calls[0]).toBe("POST http://mock/wiki/rest/api/content");
    const bad = await testDocs({ kind: "notion", parentPageId: "parent" }, "bad");
    expect(bad.ok).toBe(false);
  });
});
