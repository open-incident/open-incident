/**
 * Issue trackers — GitHub Issues, Jira Cloud, Linear. Three thin adapters over
 * plain fetch: create an issue from a follow-up, read its state back, test the
 * credentials. Base URLs come from the environment so the smoke suite can
 * point them at a mock; production uses the vendors' hosts.
 */
export type TrackerKind = "github" | "gitlab" | "jira" | "linear";
export const TRACKER_KINDS: TrackerKind[] = ["github", "gitlab", "jira", "linear"];

/** What the workspace configures — the secret travels separately, encrypted. */
export type TrackerConfig =
  | { kind: "github"; repo: string; labels?: string[] }
  | { kind: "gitlab"; project: string; labels?: string[] }
  | { kind: "jira"; site: string; email: string; projectKey: string; issueType?: string }
  | { kind: "linear"; teamKey: string };

export type IssueRef = { id: string; key: string; url: string };
export type IssueState = "open" | "closed";

export type NewIssue = { title: string; body: string; priority?: "P1" | "P2" | "P3" };

const timeout = () => AbortSignal.timeout(20_000);

function githubBase(): string {
  return (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/$/, "");
}
function gitlabBase(): string {
  return (process.env.GITLAB_API_BASE ?? "https://gitlab.com/api/v4").replace(/\/$/, "");
}
function gitlabProject(project: string): string {
  return encodeURIComponent(project.replace(/^\/|\/$/g, ""));
}
function glHeaders(token: string): Record<string, string> {
  return { "private-token": token, accept: "application/json", "content-type": "application/json" };
}
function jiraBase(site: string): string {
  return (
    process.env.JIRA_API_BASE ?? `https://${site.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
  ).replace(/\/$/, "");
}
function linearBase(): string {
  return (process.env.LINEAR_API_BASE ?? "https://api.linear.app").replace(/\/$/, "");
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Whether the credentials open the configured target; the detail names it. */
export async function testTracker(
  config: TrackerConfig,
  secret: string,
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  try {
    if (config.kind === "github") {
      const repo = await json<{ full_name: string; has_issues: boolean }>(
        await fetch(`${githubBase()}/repos/${config.repo}`, {
          headers: ghHeaders(secret),
          signal: timeout(),
        }),
      );
      if (!repo.has_issues) return { ok: false, error: "issues_disabled" };
      return { ok: true, detail: repo.full_name };
    }
    if (config.kind === "gitlab") {
      const project = await json<{ path_with_namespace: string; issues_enabled?: boolean }>(
        await fetch(`${gitlabBase()}/projects/${gitlabProject(config.project)}`, {
          headers: glHeaders(secret),
          signal: timeout(),
        }),
      );
      if (project.issues_enabled === false) return { ok: false, error: "issues_disabled" };
      return { ok: true, detail: project.path_with_namespace };
    }
    if (config.kind === "jira") {
      const me = await json<{ displayName?: string; emailAddress?: string }>(
        await fetch(`${jiraBase(config.site)}/rest/api/3/myself`, {
          headers: jiraHeaders(config, secret),
          signal: timeout(),
        }),
      );
      return {
        ok: true,
        detail: `${me.displayName ?? me.emailAddress ?? config.email} · ${config.projectKey}`,
      };
    }
    const data = await gql<{
      viewer: { name: string };
      teams: { nodes: Array<{ key: string; name: string }> };
    }>(
      secret,
      `query { viewer { name } teams(filter: { key: { eq: "${config.teamKey}" } }) { nodes { key name } } }`,
    );
    const team = data.teams.nodes[0];
    if (!team) return { ok: false, error: "team_not_found" };
    return { ok: true, detail: `${data.viewer.name} · ${team.name}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Creates the issue and returns how to find it again. */
export async function createIssue(
  config: TrackerConfig,
  secret: string,
  issue: NewIssue,
): Promise<IssueRef> {
  if (config.kind === "github") {
    const created = await json<{ number: number; html_url: string; id: number }>(
      await fetch(`${githubBase()}/repos/${config.repo}/issues`, {
        method: "POST",
        headers: ghHeaders(secret),
        body: JSON.stringify({
          title: issue.title,
          body: issue.body,
          labels: [...(config.labels ?? []), ...(issue.priority ? [issue.priority] : [])],
        }),
        signal: timeout(),
      }),
    );
    return { id: String(created.number), key: `#${created.number}`, url: created.html_url };
  }
  if (config.kind === "gitlab") {
    const created = await json<{ iid: number; id: number; web_url: string }>(
      await fetch(`${gitlabBase()}/projects/${gitlabProject(config.project)}/issues`, {
        method: "POST",
        headers: glHeaders(secret),
        body: JSON.stringify({
          title: issue.title,
          description: issue.body,
          labels: [...(config.labels ?? []), ...(issue.priority ? [issue.priority] : [])].join(","),
        }),
        signal: timeout(),
      }),
    );
    return { id: String(created.iid), key: `#${created.iid}`, url: created.web_url };
  }
  if (config.kind === "jira") {
    const created = await json<{ id: string; key: string }>(
      await fetch(`${jiraBase(config.site)}/rest/api/3/issue`, {
        method: "POST",
        headers: jiraHeaders(config, secret),
        body: JSON.stringify({
          fields: {
            project: { key: config.projectKey },
            issuetype: { name: config.issueType ?? "Task" },
            summary: issue.title,
            description: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: issue.body }] }],
            },
            ...(issue.priority ? { labels: [issue.priority] } : {}),
          },
        }),
        signal: timeout(),
      }),
    );
    return {
      id: created.id,
      key: created.key,
      url: `${jiraBrowseBase(config.site)}/browse/${created.key}`,
    };
  }
  const teams = await gql<{ teams: { nodes: Array<{ id: string }> } }>(
    secret,
    `query { teams(filter: { key: { eq: "${config.teamKey}" } }) { nodes { id } } }`,
  );
  const teamId = teams.teams.nodes[0]?.id;
  if (!teamId) throw new Error("team_not_found");
  const data = await gql<{
    issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } };
  }>(
    secret,
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }`,
    {
      input: {
        teamId,
        title: issue.title,
        description: issue.body,
        priority:
          issue.priority === "P1"
            ? 1
            : issue.priority === "P2"
              ? 2
              : issue.priority === "P3"
                ? 3
                : 0,
      },
    },
  );
  if (!data.issueCreate.success) throw new Error("issue_create_failed");
  return {
    id: data.issueCreate.issue.id,
    key: data.issueCreate.issue.identifier,
    url: data.issueCreate.issue.url,
  };
}

/** Whether the issue is still open — the one thing the status sync needs. */
export async function readIssueState(
  config: TrackerConfig,
  secret: string,
  ref: IssueRef,
): Promise<IssueState> {
  if (config.kind === "github") {
    const issue = await json<{ state: "open" | "closed" }>(
      await fetch(`${githubBase()}/repos/${config.repo}/issues/${ref.id}`, {
        headers: ghHeaders(secret),
        signal: timeout(),
      }),
    );
    return issue.state === "closed" ? "closed" : "open";
  }
  if (config.kind === "gitlab") {
    const issue = await json<{ state: "opened" | "closed" }>(
      await fetch(`${gitlabBase()}/projects/${gitlabProject(config.project)}/issues/${ref.id}`, {
        headers: glHeaders(secret),
        signal: timeout(),
      }),
    );
    return issue.state === "closed" ? "closed" : "open";
  }
  if (config.kind === "jira") {
    const issue = await json<{
      fields: { status: { statusCategory?: { key?: string }; name?: string } };
    }>(
      await fetch(`${jiraBase(config.site)}/rest/api/3/issue/${ref.key}?fields=status`, {
        headers: jiraHeaders(config, secret),
        signal: timeout(),
      }),
    );
    return issue.fields.status.statusCategory?.key === "done" ? "closed" : "open";
  }
  const data = await gql<{ issue: { state: { type: string } } }>(
    secret,
    `query($id: String!) { issue(id: $id) { state { type } } }`,
    { id: ref.id },
  );
  return data.issue.state.type === "completed" || data.issue.state.type === "canceled"
    ? "closed"
    : "open";
}

function ghHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "open-incident",
  };
}
function jiraHeaders(
  config: { kind: "jira"; email: string },
  token: string,
): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${config.email}:${token}`).toString("base64")}`,
    accept: "application/json",
    "content-type": "application/json",
  };
}
function jiraBrowseBase(site: string): string {
  return `https://${site.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}
async function gql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const data = await json<{ data?: T; errors?: Array<{ message: string }> }>(
    await fetch(`${linearBase()}/graphql`, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: timeout(),
    }),
  );
  if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join("; "));
  if (!data.data) throw new Error("empty_response");
  return data.data;
}

/** The body of an exported follow-up: where it comes from, and the link back. */
export function issueBody(input: {
  incidentNumber: number;
  incidentName: string;
  incidentUrl: string;
  priority: string | null;
  dueAt: Date | null;
}): string {
  return [
    `Follow-up of incident INC-${input.incidentNumber} — ${input.incidentName}`,
    input.priority ? `Priority: ${input.priority}` : null,
    input.dueAt ? `Due: ${input.dueAt.toISOString().slice(0, 10)}` : null,
    "",
    `Open Incident: ${input.incidentUrl}`,
    "",
    "Closing this issue marks the follow-up as done in Open Incident.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export * from "./store";
