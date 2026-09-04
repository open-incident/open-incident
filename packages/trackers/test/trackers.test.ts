import { afterEach, describe, expect, it, vi } from "vitest";
import { createIssue, issueBody, readIssueState, testTracker } from "../src/index";

const calls: Array<{ url: string; init?: RequestInit }> = [];
function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(handler(url, init)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("trackers", () => {
  it("creates and reads back a GitHub issue with the configured base", async () => {
    process.env.GITHUB_API_BASE = "http://mock/gh";
    mockFetch((url, init) =>
      init?.method === "POST"
        ? { number: 42, html_url: "https://github.com/o/r/issues/42", id: 1 }
        : { state: "closed" },
    );
    const ref = await createIssue({ kind: "github", repo: "o/r", labels: ["ops"] }, "tok", {
      title: "Add alert",
      body: "b",
      priority: "P1",
    });
    expect(ref).toEqual({ id: "42", key: "#42", url: "https://github.com/o/r/issues/42" });
    expect(calls[0]!.url).toBe("http://mock/gh/repos/o/r/issues");
    expect(JSON.parse(String(calls[0]!.init?.body)).labels).toEqual(["ops", "P1"]);
    expect(await readIssueState({ kind: "github", repo: "o/r" }, "tok", ref)).toBe("closed");
  });

  it("maps Jira status categories and Linear state types to open/closed", async () => {
    process.env.JIRA_API_BASE = "http://mock/jira";
    mockFetch(() => ({ fields: { status: { statusCategory: { key: "done" } } } }));
    expect(
      await readIssueState(
        { kind: "jira", site: "acme.atlassian.net", email: "a@b.c", projectKey: "OPS" },
        "t",
        { id: "1", key: "OPS-1", url: "" },
      ),
    ).toBe("closed");
    process.env.LINEAR_API_BASE = "http://mock/linear";
    mockFetch(() => ({ data: { issue: { state: { type: "started" } } } }));
    expect(
      await readIssueState({ kind: "linear", teamKey: "OPS" }, "t", {
        id: "x",
        key: "OPS-7",
        url: "",
      }),
    ).toBe("open");
  });

  it("reports a failed test instead of throwing, and writes a body that links back", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
    const out = await testTracker({ kind: "github", repo: "o/r" }, "bad");
    expect(out.ok).toBe(false);
    const body = issueBody({
      incidentNumber: 217,
      incidentName: "Checkout latency",
      incidentUrl: "https://x/app/incidents/217",
      priority: "P1",
      dueAt: new Date("2026-09-10T00:00:00Z"),
    });
    expect(body).toContain("INC-217");
    expect(body).toContain("Due: 2026-09-10");
    expect(body).toContain("https://x/app/incidents/217");
  });
});
