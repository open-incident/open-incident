/**
 * What is accepted from a browser, and what is kept of it.
 *
 * The decoder's job is not to be clever, it is to be unwilling: the payload is
 * written by whoever loads the page, so every ceiling below is a thing that
 * would otherwise be a column somebody filled. The origin check is the only
 * thing standing between one workspace's table and another site's traffic,
 * since the application id is public by construction.
 */
import { describe, expect, it } from "vitest";
import { MAX_EVENTS, decodeRumBatch, originAllowed, parseUserAgent, RumError } from "../src/rum";

const context = { userAgent: "", country: "FR", salt: "workspace-salt" };

function batch(events: unknown[]) {
  return decodeRumBatch({ events }, context);
}

describe("a batch from a browser", () => {
  it("keeps the events it knows and drops the rest", () => {
    const out = batch([
      { type: "page_view", session: "s1" },
      { type: "web_vital", session: "s1", vital: "LCP", value: 2100, rating: "good" },
      { type: "something_else", session: "s1" },
    ]);
    expect(out.map((e) => e.type)).toEqual(["page_view", "web_vital"]);
    expect(out[1]!.vitalValue).toBe(2100);
  });

  it("drops an event with no session, which cannot be part of a timeline", () => {
    expect(batch([{ type: "page_view" }])).toEqual([]);
  });

  it("refuses a batch that is not a batch", () => {
    expect(() => decodeRumBatch({}, context)).toThrow(RumError);
    expect(() => decodeRumBatch({ events: "lots" }, context)).toThrow(RumError);
  });

  it("refuses a batch above the ceiling rather than truncating it", () => {
    const many = Array.from({ length: MAX_EVENTS + 1 }, () => ({
      type: "page_view",
      session: "s",
    }));
    expect(() => batch(many)).toThrow(/at most/);
  });

  it("clips every string the page controls", () => {
    const out = batch([
      {
        type: "error",
        session: "s".repeat(500),
        url: "u".repeat(5000),
        route: "r".repeat(500),
        message: "m".repeat(5000),
        stack: "k".repeat(50_000),
      },
    ]);
    expect(out[0]!.sessionId.length).toBe(64);
    expect(out[0]!.url.length).toBe(2_000);
    expect(out[0]!.route.length).toBe(200);
    expect(out[0]!.errorStack.length).toBe(8_000);
  });

  it("keeps at most sixteen attributes and no nested ones", () => {
    const attributes: Record<string, unknown> = { nested: { a: 1 } };
    for (let i = 0; i < 40; i++) attributes[`k${i}`] = i;
    const out = batch([{ type: "action", session: "s", attributes }]);
    expect(Object.keys(out[0]!.attributes).length).toBeLessThanOrEqual(16);
    expect(out[0]!.attributes.nested).toBeUndefined();
  });
});

describe("what is never stored", () => {
  it("hashes the user rather than keeping it, and salts it per workspace", () => {
    const here = decodeRumBatch(
      { events: [{ type: "page_view", session: "s", user: "amelie@skylark.dev" }] },
      context,
    );
    const elsewhere = decodeRumBatch(
      { events: [{ type: "page_view", session: "s", user: "amelie@skylark.dev" }] },
      { ...context, salt: "another-workspace" },
    );
    expect(here[0]!.userHash).not.toContain("amelie");
    expect(here[0]!.userHash).toHaveLength(32);
    // The same person on two customers' sites must be two hashes, or the two
    // tables could be joined against each other.
    expect(here[0]!.userHash).not.toBe(elsewhere[0]!.userHash);
  });

  it("leaves the hash empty when the page named nobody", () => {
    expect(batch([{ type: "page_view", session: "s" }])[0]!.userHash).toBe("");
  });
});

describe("the clock a browser claims", () => {
  it("takes a plausible one", () => {
    const when = Date.now() - 5_000;
    expect(batch([{ type: "page_view", session: "s", ts: when }])[0]!.ts).toContain(
      new Date(when).toISOString().slice(0, 16).replace("T", " "),
    );
  });

  it("replaces one that is days out", () => {
    // A machine whose clock was never set would otherwise write into a
    // partition already past its retention, or years from being read.
    const out = batch([{ type: "page_view", session: "s", ts: Date.parse("2001-01-01") }]);
    expect(out[0]!.ts.slice(0, 4)).toBe(String(new Date().getUTCFullYear()));
  });
});

describe("which origin may report", () => {
  it("accepts exactly what the workspace listed", () => {
    expect(originAllowed("https://shop.example.com", ["https://shop.example.com"])).toBe(true);
    expect(originAllowed("https://shop.example.com/", ["https://shop.example.com"])).toBe(true);
  });

  it("refuses everything when nothing was listed", () => {
    // The safe reading of "somebody pasted the id into a page before thinking
    // about it": an application with no origins accepts nothing.
    expect(originAllowed("https://shop.example.com", [])).toBe(false);
  });

  it("does not treat a listed origin as a prefix", () => {
    expect(originAllowed("https://shop.example.com.evil.test", ["https://shop.example.com"])).toBe(
      false,
    );
    expect(originAllowed("http://shop.example.com", ["https://shop.example.com"])).toBe(false);
  });
});

describe("the user agent, coarsely", () => {
  const chrome =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
  const safari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const edge = chrome + " Edg/141.0";

  it("names the browser, and not the ones it pretends to be", () => {
    // Every one of them says "Safari" and most say "Chrome": the order of the
    // tests is the whole of this function.
    expect(parseUserAgent(chrome).browser).toBe("Chrome");
    expect(parseUserAgent(safari).browser).toBe("Safari");
    expect(parseUserAgent(edge).browser).toBe("Edge");
  });

  it("names the system and the form factor", () => {
    expect(parseUserAgent(chrome)).toMatchObject({ os: "macOS", device: "desktop" });
    expect(parseUserAgent(safari)).toMatchObject({ os: "iOS", device: "mobile" });
  });

  it("says other rather than guessing", () => {
    expect(parseUserAgent("curl/8.7").browser).toBe("other");
    expect(parseUserAgent("")).toMatchObject({ browser: "other", os: "other" });
  });
});
