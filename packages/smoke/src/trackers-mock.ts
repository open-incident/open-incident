import { createServer, type Server } from "node:http";

/**
 * A mock of the trackers' APIs for the smoke suite — GitHub REST, GitLab, Jira
 * Cloud REST, Linear GraphQL, Confluence, Notion — plus a Backstage catalog,
 * enough for create / read state / test / import. Issues
 * live in memory; `POST /_close/<id>` closes one so the status sync has
 * something to bring back.
 */
export type TrackerCall = { method: string; path: string; body: Record<string, unknown> };

export function startTrackersMock(port = 3199): Promise<{
  server: Server;
  calls: TrackerCall[];
  issues: Map<string, { title: string; closed: boolean }>;
}> {
  const calls: TrackerCall[] = [];
  const issues = new Map<string, { title: string; closed: boolean }>();
  let seq = 100;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (o: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw || "{}") as Record<string, unknown>;
      } catch {
        body = {};
      }
      calls.push({ method: req.method ?? "GET", path: url.pathname, body });
      // GitHub/Jira/Linear authenticate with Authorization; GitLab with PRIVATE-TOKEN.
      const privateToken = req.headers["private-token"];
      const auth =
        req.headers.authorization ??
        (typeof privateToken === "string" ? `Token ${privateToken}` : "");
      if (url.pathname.startsWith("/_close/")) {
        const id = url.pathname.slice("/_close/".length);
        const it = issues.get(id);
        if (it) it.closed = true;
        return json({ ok: Boolean(it) });
      }
      // Backstage catalog API (the importer's `backstage` source): two groups, two components.
      if (url.pathname === "/api/catalog/entities/by-query") {
        const entity = (kind: string, name: string, spec: Record<string, unknown>, extra = {}) => ({
          apiVersion: "backstage.io/v1alpha1",
          kind,
          metadata: { name, namespace: "default", ...extra },
          spec,
        });
        return json({
          items: [
            entity("Group", "search", { type: "team", profile: { displayName: "Search" } }),
            entity("Group", "ranking", { type: "team", profile: { displayName: "Ranking" } }),
            entity(
              "Component",
              "search-indexer",
              { type: "service", owner: "group:default/search", lifecycle: "production" },
              {
                description: "Indexes the catalog for search",
                annotations: {
                  "github.com/project-slug": "skylark/search-indexer",
                  "openincident.dev/tier": "tier 2",
                },
              },
            ),
            entity("Component", "ranking-api", { type: "service", owner: "ranking" }),
            entity("API", "search-openapi", { type: "openapi", owner: "search" }),
          ],
          pageInfo: {},
        });
      }
      const publicRead =
        req.method === "GET" &&
        (/\/contents\//.test(url.pathname) || /\/repository\/files\//.test(url.pathname));
      if (!publicRead && (!auth || auth.includes("bad")))
        return json({ message: "Bad credentials" }, 401);
      // GitHub
      let m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)$/);
      if (m) return json({ full_name: m[1], has_issues: true });
      m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues$/);
      if (m && req.method === "POST") {
        const id = String(++seq);
        issues.set(id, { title: String(body.title ?? ""), closed: false });
        return json(
          {
            number: Number(id),
            id: Number(id),
            html_url: `https://github.com/${m[1]}/issues/${id}`,
          },
          201,
        );
      }
      m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/);
      if (m) {
        const it = issues.get(m[1]!);
        return it
          ? json({ number: Number(m[1]), state: it.closed ? "closed" : "open" })
          : json({ message: "Not Found" }, 404);
      }
      // Confluence Cloud
      m = url.pathname.match(/^\/wiki\/rest\/api\/space\/([^/]+)$/);
      if (m) return json({ key: m[1], name: `Space ${m[1]}` });
      if (url.pathname === "/wiki/rest/api/content" && req.method === "POST") {
        const id = String(++seq);
        issues.set(`cf-${id}`, { title: String(body.title ?? ""), closed: false });
        return json({
          id,
          _links: { base: "https://skylark.atlassian.net/wiki", webui: `/spaces/OPS/pages/${id}` },
        });
      }
      // Notion
      if (url.pathname === "/notion/v1/users/me")
        return json({ object: "user", name: "Open Incident", bot: { workspace_name: "Skylark" } });
      m = url.pathname.match(/^\/notion\/v1\/pages\/([^/]+)$/);
      if (m && req.method === "GET") return json({ object: "page", id: m[1] });
      if (url.pathname === "/notion/v1/pages" && req.method === "POST") {
        const id = `${++seq}`.padStart(8, "0");
        const props = body.properties as
          { title?: { title?: Array<{ text?: { content?: string } }> } } | undefined;
        issues.set(`no-${id}`, {
          title: String(props?.title?.title?.[0]?.text?.content ?? ""),
          closed: false,
        });
        return json({
          object: "page",
          id: `${id}-0000-0000-0000-000000000000`,
          url: `https://www.notion.so/${id}`,
        });
      }
      // GitHub contents (runbook files) — public read, no token required
      m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/);
      if (m && req.method === "GET") {
        const text = `# Runbook — ${decodeURIComponent(m[2]!)}\n\n1. Check the connection pool of payments-worker.\n2. Roll back the last deploy if p99 > 2 s.\n3. Page the Payments escalation path.\n`;
        return json({
          type: "file",
          encoding: "base64",
          path: decodeURIComponent(m[2]!),
          content: Buffer.from(text).toString("base64"),
          html_url: `https://github.com/${m[1]}/blob/main/${m[2]}`,
        });
      }
      // GitLab raw file
      m = url.pathname.match(/^\/projects\/([^/]+)\/repository\/files\/([^/]+)\/raw$/);
      if (m && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end(`# Runbook — ${decodeURIComponent(m[2]!)}\n\n1. Restart the worker.\n`);
      }
      // GitLab
      m = url.pathname.match(/^\/projects\/([^/]+)$/);
      if (m)
        return json({
          id: 7,
          path_with_namespace: decodeURIComponent(m[1]!),
          issues_enabled: true,
        });
      m = url.pathname.match(/^\/projects\/([^/]+)\/issues$/);
      if (m && req.method === "POST") {
        const id = String(++seq);
        issues.set(`gl-${id}`, { title: String(body.title ?? ""), closed: false });
        return json(
          {
            iid: Number(id),
            id: Number(id),
            web_url: `https://gitlab.com/${decodeURIComponent(m[1]!)}/-/issues/${id}`,
          },
          201,
        );
      }
      m = url.pathname.match(/^\/projects\/[^/]+\/issues\/(\d+)$/);
      if (m) {
        const it = issues.get(`gl-${m[1]}`);
        return it
          ? json({ iid: Number(m[1]), state: it.closed ? "closed" : "opened" })
          : json({ message: "404 Not found" }, 404);
      }
      // Jira
      if (url.pathname === "/rest/api/3/myself")
        return json({ displayName: "Mock Jira", emailAddress: "jira@mock" });
      if (url.pathname === "/rest/api/3/issue" && req.method === "POST") {
        const id = String(++seq);
        const fields = body.fields as { project?: { key?: string }; summary?: string } | undefined;
        const key = `${fields?.project?.key ?? "OPS"}-${id}`;
        issues.set(key, { title: String(fields?.summary ?? ""), closed: false });
        return json({ id, key }, 201);
      }
      m = url.pathname.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/);
      if (m) {
        const it = issues.get(m[1]!);
        return it
          ? json({
              key: m[1],
              fields: {
                status: {
                  name: it.closed ? "Done" : "To Do",
                  statusCategory: { key: it.closed ? "done" : "new" },
                },
              },
            })
          : json({ errorMessages: ["Issue does not exist"] }, 404);
      }
      // Linear
      if (url.pathname === "/graphql" && req.method === "POST") {
        const query = String(body.query ?? "");
        const vars = (body.variables ?? {}) as Record<string, unknown>;
        if (query.includes("issueCreate")) {
          const id = `lin_${++seq}`;
          const input = vars.input as { title?: string } | undefined;
          issues.set(id, { title: String(input?.title ?? ""), closed: false });
          return json({
            data: {
              issueCreate: {
                success: true,
                issue: {
                  id,
                  identifier: `OPS-${seq}`,
                  url: `https://linear.app/mock/issue/OPS-${seq}`,
                },
              },
            },
          });
        }
        if (query.includes("issue(id")) {
          const it = issues.get(String(vars.id));
          return json({
            data: { issue: { state: { type: it?.closed ? "completed" : "started" } } },
          });
        }
        return json({
          data: {
            viewer: { name: "Mock Linear" },
            teams: { nodes: [{ id: "team_1", key: "OPS", name: "Ops" }] },
          },
        });
      }
      return json({ message: `mock: unknown ${req.method} ${url.pathname}` }, 404);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, calls, issues }));
  });
}
