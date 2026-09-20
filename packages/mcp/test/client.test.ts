/**
 * The client, which is the only part of this package with decisions in it.
 *
 * The tools themselves are declarations; what can go wrong is the URL a person
 * pasted, the shape of a refusal, and a walk over pages that never ends.
 */
import { describe, expect, it, vi } from "vitest";
import { ApiError, IncidentClient } from "../src/client";

function stub(handler: (url: URL, init: RequestInit) => Response) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(new URL(String(input)), init ?? {}),
  ) as unknown as typeof fetch;
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("the base URL somebody pasted", () => {
  it.each([
    ["https://skylark.example", "https://skylark.example/api/v1/on-call"],
    ["https://skylark.example/", "https://skylark.example/api/v1/on-call"],
    ["https://skylark.example///", "https://skylark.example/api/v1/on-call"],
    ["https://skylark.example/api/v1", "https://skylark.example/api/v1/on-call"],
    ["https://skylark.example/api/v1/", "https://skylark.example/api/v1/on-call"],
  ])("%s becomes %s", async (given, expected) => {
    let seen = "";
    const fetchImpl = stub((url) => {
      seen = url.toString();
      return ok({ data: [] });
    });
    await new IncidentClient({ baseUrl: given, apiKey: "k", fetchImpl }).get("/on-call");
    expect(seen).toBe(expected);
  });
});

describe("the request", () => {
  it("carries the key and drops empty query values", async () => {
    let seen: URL | null = null;
    let auth = "";
    const fetchImpl = stub((url, init) => {
      seen = url;
      auth = new Headers(init.headers).get("authorization") ?? "";
      return ok({ data: [] });
    });
    await new IncidentClient({
      baseUrl: "https://x.example",
      apiKey: "oi_live_abc",
      fetchImpl,
    }).get("/alerts", { status: "firing", since: undefined, cursor: null, q: "" });
    expect(auth).toBe("Bearer oi_live_abc");
    expect(seen!.searchParams.get("status")).toBe("firing");
    // An empty cursor sent as `cursor=` is not the same as no cursor: some
    // endpoints would read it as a date and refuse the whole call.
    expect(seen!.searchParams.has("since")).toBe(false);
    expect(seen!.searchParams.has("cursor")).toBe(false);
    expect(seen!.searchParams.has("q")).toBe(false);
  });

  it("turns the product's error envelope into a typed failure", async () => {
    const fetchImpl = stub(
      () =>
        new Response(
          JSON.stringify({ error: { code: "missing_scope", message: "Needs write." } }),
          {
            status: 403,
          },
        ),
    );
    const api = new IncidentClient({ baseUrl: "https://x.example", apiKey: "k", fetchImpl });
    await expect(api.get("/incidents")).rejects.toMatchObject({
      status: 403,
      code: "missing_scope",
      message: "Needs write.",
    });
  });

  it("keeps the body when a proxy answers something that is not JSON", async () => {
    const fetchImpl = stub(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    const api = new IncidentClient({ baseUrl: "https://x.example", apiKey: "k", fetchImpl });
    const error = await api.get("/incidents").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("http_error");
    expect((error as ApiError).message).toContain("502 Bad Gateway");
  });

  it("returns nothing for a 204 rather than failing to parse it", async () => {
    const fetchImpl = stub(() => new Response(null, { status: 204 }));
    const api = new IncidentClient({ baseUrl: "https://x.example", apiKey: "k", fetchImpl });
    await expect(api.request("POST", "/x", { body: {} })).resolves.toBeUndefined();
  });
});

describe("walking a collection", () => {
  it("follows the cursor to the end", async () => {
    const pages: Record<string, { data: number[]; next_cursor: string | null }> = {
      "": { data: [1, 2], next_cursor: "a" },
      a: { data: [3, 4], next_cursor: "b" },
      b: { data: [5], next_cursor: null },
    };
    const fetchImpl = stub((url) => ok(pages[url.searchParams.get("cursor") ?? ""]));
    const api = new IncidentClient({ baseUrl: "https://x.example", apiKey: "k", fetchImpl });
    const out = await api.collect<number>("/alerts");
    expect(out.items).toEqual([1, 2, 3, 4, 5]);
    expect(out.truncated).toBe(false);
  });

  /**
   * The cap is the point. An assistant asking for "all the alerts" on a noisy
   * workspace would otherwise fill its context and take a minute doing it —
   * and `truncated` is what lets it say "there are more" instead of answering
   * from a slice as though it were the whole.
   */
  it("stops at the cap and says so", async () => {
    const fetchImpl = stub(() => ok({ data: [1, 2], next_cursor: "more" }));
    const api = new IncidentClient({ baseUrl: "https://x.example", apiKey: "k", fetchImpl });
    const out = await api.collect<number>("/alerts", {}, 4);
    expect(out.items).toHaveLength(4);
    expect(out.truncated).toBe(true);
  });

  it("copes with a collection that answers without a cursor at all", async () => {
    const fetchImpl = stub(() => ok({ data: [1, 2, 3] }));
    const api = new IncidentClient({ baseUrl: "https://x.example", apiKey: "k", fetchImpl });
    const out = await api.collect<number>("/services");
    expect(out.items).toEqual([1, 2, 3]);
    expect(out.truncated).toBe(false);
  });
});
