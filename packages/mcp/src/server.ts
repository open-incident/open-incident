/**
 * The Open Incident MCP server.
 *
 * Tools chosen for what somebody actually does during an incident — who is on
 * call, what is firing, what changed, what did we write down, declare it, tell
 * people — rather than one tool per endpoint. A faithful mirror of twenty-eight
 * routes would be twenty-eight choices an assistant makes badly, and the two
 * most useful tools here (`who_is_on_call`, `get_service_health`) are the ones
 * that do not correspond to a single route at all.
 *
 * Every write is annotated as such, and the three that reach a human say so in
 * their own description, because a client that asks for confirmation can only
 * ask about what it was told.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, IncidentClient, type ClientConfig } from "./client";

/** Tool results are text: JSON an assistant can read, pretty-printed. */
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failed(error: unknown) {
  if (error instanceof ApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `The workspace refused the call (${error.status} ${error.code}): ${error.message}`,
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Could not reach the workspace: ${message}` }],
  };
}

async function guard<T>(run: () => Promise<T>) {
  try {
    return json(await run());
  } catch (error) {
    return failed(error);
  }
}

const PHASE = z.enum(["triage", "active", "post_incident", "closed"]);

export function createServer(config: ClientConfig): McpServer {
  const api = new IncidentClient(config);
  const server = new McpServer({ name: "open-incident", version: "0.1.0" });

  /* ---------- Who and what, right now ---------- */

  server.registerTool(
    "who_is_on_call",
    {
      title: "Who is on call",
      description:
        "The people who would be woken right now, per schedule, with when their shift ends and " +
        "whether they are covering for somebody. Ask this before suggesting anyone be contacted. " +
        "An empty list for a schedule means nobody is on it at that moment — which is a gap worth " +
        "saying out loud rather than glossing over.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        at: z.string().optional().describe("ISO 8601 instant. Defaults to now."),
        schedule: z.string().optional().describe("One schedule, by name or id. Omit for all."),
      },
    },
    async ({ at, schedule }) => guard(() => api.get("/on-call", { at, schedule })),
  );

  server.registerTool(
    "search_incidents",
    {
      title: "Search incidents",
      description:
        "Incidents in the workspace, newest activity first. Filter by phase. Returns a summary of " +
        "each — use get_incident to read one properly.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        phase: PHASE.optional().describe("Only this phase; omit for all of them."),
        limit: z.number().int().min(1).max(100).default(25),
      },
    },
    async ({ phase, limit }) =>
      guard(async () => {
        const { items, truncated } = await api.collect<Record<string, unknown>>(
          "/incidents",
          { phase },
          limit,
        );
        return { count: items.length, truncated, incidents: items };
      }),
  );

  server.registerTool(
    "get_incident",
    {
      title: "Read an incident",
      description:
        "One incident with its whole timeline and every update that was published. Read this " +
        "before drafting anything: the timeline usually holds what has already been tried, and " +
        "the updates hold what customers have already been told.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        number: z.string().describe("The incident number, `217` or `INC-217`."),
        include_post_mortem: z.boolean().default(false),
      },
    },
    async ({ number, include_post_mortem }) =>
      guard(async () => {
        const [incident, timeline] = await Promise.all([
          api.get(`/incidents/${number}`),
          api.get(`/incidents/${number}/timeline`),
        ]);
        const postMortem = include_post_mortem
          ? await api.get(`/incidents/${number}/post-mortem`).catch(() => null)
          : undefined;
        return { incident, timeline, ...(postMortem ? { post_mortem: postMortem } : {}) };
      }),
  );

  server.registerTool(
    "search_alerts",
    {
      title: "Search alerts",
      description:
        "The raw alerts, which are not incidents. Hundreds fire and a handful matter — " +
        "`occurrences` is how many times the same one repeated before anybody looked, and it is " +
        "usually the most informative number in the list.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        status: z.enum(["firing", "resolved"]).optional(),
        since: z.string().optional().describe("ISO 8601 instant."),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ status, since, limit }) =>
      guard(async () => {
        const { items, truncated } = await api.collect<Record<string, unknown>>(
          "/alerts",
          { status, since },
          limit,
        );
        return { count: items.length, truncated, alerts: items };
      }),
  );

  server.registerTool(
    "get_alert",
    {
      title: "Read an alert",
      description:
        "One alert with the payload its sender actually sent, and everything that happened to it. " +
        "An alert nobody can explain is an alert nobody can silence, and the payload is usually " +
        "the explanation.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: { id: z.string().describe("The alert id.") },
    },
    async ({ id }) => guard(() => api.get(`/alerts/${id}`)),
  );

  /* ---------- A service, from every angle at once ---------- */

  server.registerTool(
    "get_service_health",
    {
      title: "How a service is doing",
      description:
        "Everything the workspace knows about one service, gathered in one call: what it is, its " +
        "monitors and their last verdicts, the jobs that report into it, its objectives and how " +
        "much error budget is left, the alerts it has raised recently and any incident open " +
        "against it. This is the call to make when somebody asks whether a service is healthy — " +
        "the individual lists each answer a third of the question.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        service: z.string().describe("The service key (`checkout-api`) or its id."),
        since: z
          .string()
          .optional()
          .describe("ISO 8601 instant for the alert window. Defaults to the last 24 hours."),
      },
    },
    async ({ service, since }) =>
      guard(async () => {
        const detail = await api.get<{ id: string; key: string }>(
          `/services/${encodeURIComponent(service)}`,
        );
        const window = since ?? new Date(Date.now() - 86_400_000).toISOString();
        const [monitors, heartbeats, slos, alerts, incidents] = await Promise.all([
          api.get<{ data: { service_id: string | null }[] }>("/monitors"),
          api.get<{ data: { service_id: string | null }[] }>("/heartbeats"),
          api.get<{ data: { service_id: string | null }[] }>("/slos"),
          api.get<{ data: unknown[] }>("/alerts", { since: window, limit: 100 }),
          api.get<{ data: { service?: { id?: string } | null }[] }>("/incidents", {
            phase: "active",
            limit: 100,
          }),
        ]);
        const mine = <T extends { service_id: string | null }>(rows: T[]) =>
          rows.filter((r) => r.service_id === detail.id);
        return {
          service: detail,
          monitors: mine(monitors.data),
          heartbeats: mine(heartbeats.data),
          slos: mine(slos.data),
          // Alerts do not carry a service on the row, so they are returned for
          // the window rather than filtered — saying "here is everything that
          // fired" beats silently returning none because the link is missing.
          recent_alerts: alerts.data,
          recent_alerts_since: window,
          open_incidents: incidents.data.filter((i) => i.service?.id === detail.id),
        };
      }),
  );

  /* ---------- What we already wrote down ---------- */

  server.registerTool(
    "search_runbooks",
    {
      title: "Search runbooks",
      description:
        "What somebody wrote down for the next person, with the text. Check this before " +
        "suggesting a course of action: the team may already have decided one.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Words to match in the title or the body. Omit for all of them."),
        service: z.string().optional().describe("Only runbooks filed under this service key."),
      },
    },
    async ({ query, service }) =>
      guard(async () => {
        const all = await api.get<{ data: Record<string, unknown>[] }>("/runbooks");
        const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const rows = all.data.filter((r) => {
          if (service && r["service"] !== service) return false;
          if (words.length === 0) return true;
          const hay = `${String(r["title"] ?? "")} ${String(r["content"] ?? "")}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
        return { count: rows.length, runbooks: rows };
      }),
  );

  server.registerTool(
    "list_workspace",
    {
      title: "List the workspace",
      description:
        "Services, teams, people, schedules or escalation policies — whichever you need to " +
        "resolve a name into an id, or to understand how this workspace is organised.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        kind: z.enum(["services", "teams", "members", "schedules", "escalation-policies"]),
      },
    },
    async ({ kind }) => guard(() => api.get(`/${kind}`)),
  );

  /* ---------- Writing ---------- */

  server.registerTool(
    "declare_incident",
    {
      title: "Declare an incident",
      description:
        "Opens an incident. **This pages real people**: the workspace's rules run, the escalation " +
        "path fires and whoever is on call is contacted, exactly as if a human had declared it. " +
        "Use mode `test` to try the machinery without waking anybody.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        name: z.string().min(2).describe("What is wrong, in a line somebody can read at 3 a.m."),
        summary: z.string().optional(),
        severity: z
          .string()
          .optional()
          .describe("e.g. SEV2. The workspace's default when omitted."),
        service: z.string().optional().describe("The affected service, by key or id."),
        type: z.string().optional(),
        mode: z.enum(["live", "retrospective", "test"]).default("live"),
        /*
         * Without this an assistant cannot declare anything in a workspace
         * whose incident type requires fields — and most real ones do. The
         * refusal it gets is perfectly clear ("Required by the type
         * \"Défaut\": service, region") and perfectly useless, because the
         * tool had no way to supply them. Found by running the tool against a
         * real workspace, not by reading the schema.
         */
        custom_fields: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Values for the fields this incident type requires. A refusal names the missing " +
              "ones, so read the message rather than guessing.",
          ),
      },
    },
    async (input) => guard(() => api.post("/incidents", input)),
  );

  server.registerTool(
    "post_incident_update",
    {
      title: "Publish an incident update",
      description:
        "Adds an update to an incident. **This can reach customers**: if the incident is on a " +
        "status page, the message is published and subscribers are emailed. Write it as the " +
        "sentence you would sign.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        number: z.string().describe("The incident number, `217` or `INC-217`."),
        message: z.string().min(2),
        status: z
          .string()
          .optional()
          .describe("Move the incident to this status at the same time."),
        severity: z.string().optional(),
      },
    },
    async ({ number, ...body }) => guard(() => api.post(`/incidents/${number}/updates`, body)),
  );

  server.registerTool(
    "add_follow_up",
    {
      title: "Add a follow-up",
      description:
        "Records something to do after the incident. Reaches nobody immediately — this is the " +
        "safe one, and the right home for 'we should probably…' rather than putting it in a " +
        "customer-facing update.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        number: z.string().describe("The incident number, `217` or `INC-217`."),
        title: z.string().min(2),
        description: z.string().optional(),
      },
    },
    async ({ number, ...body }) => guard(() => api.post(`/incidents/${number}/follow-ups`, body)),
  );

  server.registerTool(
    "record_change_event",
    {
      title: "Record a change",
      description:
        "Files a deploy, a flag flip or a configuration change, so the next investigation can see " +
        "it on the timeline. Reaches nobody. Worth doing generously: 'what changed' is the first " +
        "question of every incident, and an unrecorded change is the one nobody thinks of.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        kind: z.enum(["deploy", "flag", "config", "other"]).default("deploy"),
        title: z.string().min(2),
        description: z.string().optional(),
        service: z.string().optional().describe("By key or id."),
        environment: z.string().optional(),
        occurred_at: z.string().optional().describe("ISO 8601; now when omitted."),
      },
    },
    async (input) => guard(() => api.post("/change-events", input)),
  );

  return server;
}
