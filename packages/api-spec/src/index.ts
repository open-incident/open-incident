/**
 * The API contract, written by hand — and the single source every reader gets:
 * the instance serves it at `/api/v1/openapi.json`, the developer site renders
 * its pages from it, and a test refuses any route that is missing here. One
 * document, so the documentation cannot drift from what the product answers.
 *
 * The server URL is rebuilt from the caller's origin, so a self-hosted instance
 * documents itself rather than pointing at ours.
 */

/** A minimal shape: enough to walk the document without dragging a schema library in. */
export type OpenApiOperation = {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: {
    name: string;
    in: "path" | "query" | "header";
    required?: boolean;
    description?: string;
    schema?: Record<string, unknown>;
  }[];
  requestBody?: Record<string, unknown>;
  responses: Record<string, { description?: string; content?: Record<string, unknown> }>;
};

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: { url: string }[];
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
};

/** The HTTP methods a path may declare — anything else is not an operation. */
export const HTTP_METHODS = ["get", "post", "patch", "put", "delete"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * One tag per path prefix, longest match first.
 *
 * Assigned here rather than written on each operation for a reason that has
 * already bitten this document once elsewhere: twenty-eight operations, each
 * carrying a hand-typed tag, is twenty-eight chances to type a new one by
 * accident and end up with two folders called "On-call" and "On call". A
 * prefix map cannot drift, and adding a route to an existing area needs no
 * decision at all.
 */
const TAGS: [prefix: string, tag: string][] = [
  ["/incidents", "Incidents"],
  ["/follow-ups", "Incidents"],
  ["/change-events", "Changes"],
  ["/services", "Services"],
  ["/teams", "People"],
  ["/members", "People"],
  ["/on-call", "On-call"],
  ["/schedules", "On-call"],
  ["/escalation-policies", "On-call"],
  ["/alerts", "Alerts"],
  ["/monitors", "Checks"],
  ["/heartbeats", "Checks"],
  ["/slos", "Objectives"],
  ["/runbooks", "Runbooks"],
  ["/status-pages", "Status pages"],
];

/** What each tag is for, shown above its section in the reference. */
const TAG_NOTES: Record<string, string> = {
  Incidents: "Declaring, reading, updating and closing out what people are working on.",
  Changes: "Deploys, flag flips and configuration changes — the first question of every incident.",
  Services:
    "The estate, mostly as the product learned it: a service appears the first time something names it.",
  People: "Teams and the people in them, for resolving the ids everything else returns.",
  "On-call": "Who would be woken, the rotas behind that, and the paths an alert escalates along.",
  Alerts: "The raw signal. Hundreds fire; a handful become incidents.",
  Checks: "Monitors that go and look, and heartbeats that wait to be told.",
  Objectives: "Service level objectives and how much error budget is left.",
  Runbooks: "What somebody wrote down for the next person.",
  "Status pages": "What the public sees.",
};

function tagFor(path: string): string {
  let best = "";
  let tag = "Other";
  for (const [prefix, name] of TAGS) {
    if (path.startsWith(prefix) && prefix.length > best.length) {
      best = prefix;
      tag = name;
    }
  }
  return tag;
}

export function openApiDocument(origin: string, extraServers: string[] = []): OpenApiDocument {
  const incident = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      number: { type: "integer" },
      reference: { type: "string", example: "INC-217" },
      name: { type: "string" },
      summary: { type: "string", nullable: true },
      phase: { type: "string", enum: ["triage", "active", "post_incident", "closed"] },
      status: {
        type: "string",
        nullable: true,
        description: "Status name within the active phase.",
      },
      severity: { type: "string", nullable: true, example: "SEV2" },
      type: { type: "string" },
      mode: { type: "string", enum: ["live", "retrospective", "test"] },
      visibility: { type: "string", enum: ["public", "private"] },
      source: { type: "string" },
      service: {
        type: "object",
        nullable: true,
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
      lead: {
        type: "object",
        nullable: true,
        properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string" } },
      },
      custom_fields: { type: "object", additionalProperties: true },
      declared_at: { type: "string", format: "date-time" },
      accepted_at: { type: "string", format: "date-time", nullable: true },
      acknowledged_at: { type: "string", format: "date-time", nullable: true },
      resolved_at: { type: "string", format: "date-time", nullable: true },
      closed_at: { type: "string", format: "date-time", nullable: true },
      next_update_due_at: { type: "string", format: "date-time", nullable: true },
      last_activity_at: { type: "string", format: "date-time" },
    },
  };
  const error = {
    type: "object",
    properties: {
      error: {
        type: "object",
        properties: { code: { type: "string" }, message: { type: "string" } },
      },
    },
  };
  const errors = {
    "401": {
      description: "Unknown or revoked key",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    },
    "403": {
      description: "Missing scope, or workspace suspended",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    },
    "429": {
      description: "Rate limited — 600 requests per minute per key",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    },
  };
  const numberParam = {
    name: "number",
    in: "path",
    required: true,
    schema: { type: "string" },
    description: "The incident number, `217` or `INC-217`.",
  };

  const doc = {
    openapi: "3.1.0",
    info: {
      title: "Open Incident API",
      version: "1",
      description:
        "Authenticate with `Authorization: Bearer oi_live_…`. A key resolves its own workspace. Scopes: `read`, `write` (implies read and incident:create), `incident:create`. Lists are paginated by cursor, 100 items at most. Every error is `{ error: { code, message } }`.",
    },
    servers: [origin, ...extraServers].map((o) => ({ url: `${o}/api/v1` })),
    tags: TAGS.map(([, name]) => name)
      .filter((name, i, all) => all.indexOf(name) === i)
      .map((name) => ({ name, description: TAG_NOTES[name] })),
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer" } },
      schemas: {
        Incident: incident,
        Error: error,
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/incidents": {
        get: {
          summary: "List incidents, newest activity first",
          parameters: [
            {
              name: "phase",
              in: "query",
              schema: { type: "string", enum: ["triage", "active", "post_incident", "closed"] },
            },
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 100, default: 50 } },
          ],
          responses: {
            "200": {
              description: "A page",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/Incident" } },
                      next_cursor: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
            ...errors,
          },
        },
        post: {
          summary: "Declare an incident (scope incident:create or write)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    summary: { type: "string" },
                    type: {
                      type: "string",
                      description: "Type name or id; the default type when omitted.",
                    },
                    severity: { type: "string", example: "SEV2" },
                    service: {
                      type: "string",
                      description: "The affected service, by key (`checkout-api`) or id.",
                    },
                    mode: {
                      type: "string",
                      enum: ["live", "retrospective", "test"],
                      default: "live",
                    },
                    declared_at: {
                      type: "string",
                      format: "date-time",
                      description: "Retrospective mode only.",
                    },
                    custom_fields: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Incident" } },
              },
            },
            "422": {
              description:
                "Invalid body, unknown type/severity/service, or a field the type requires is missing",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
            },
            ...errors,
          },
        },
      },
      "/incidents/{number}": {
        get: {
          summary: "One incident",
          parameters: [numberParam],
          responses: {
            "200": {
              description: "The incident",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Incident" } },
              },
            },
            "404": { description: "No such incident" },
            ...errors,
          },
        },
        patch: {
          summary: "Edit name, summary or custom fields (scope write)",
          parameters: [numberParam],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    summary: { type: "string", nullable: true },
                    custom_fields: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "The incident",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Incident" } },
              },
            },
            "404": { description: "No such incident" },
            ...errors,
          },
        },
      },
      "/incidents/{number}/updates": {
        post: {
          summary: "Share a status update — status, message, severity, reminder (scope write)",
          parameters: [numberParam],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["message"],
                  properties: {
                    status: {
                      type: "string",
                      description: 'A status of the incident\'s type, or "resolved".',
                    },
                    message: { type: "string" },
                    severity: { type: "string" },
                    next_update_in_minutes: { type: "integer" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "The incident after the update",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Incident" } },
              },
            },
            "409": { description: "Closed, or still in triage" },
            ...errors,
          },
        },
      },
      "/incidents/{number}/timeline": {
        get: {
          summary: "Every timeline event, oldest first",
          parameters: [numberParam],
          responses: {
            "200": { description: "Events" },
            "404": { description: "No such incident" },
            ...errors,
          },
        },
      },
      "/incidents/{number}/post-mortem": {
        get: {
          summary: "The post-mortem of an incident, as sections and as markdown",
          description:
            "The document a workspace writes after an incident: its title, status (in_progress, in_review, completed), owner, whether the assistant drafted it, every section with its key, title and markdown body, and the whole rendered as one markdown document — for a knowledge base, a wiki or a tool of your own. `404 no_post_mortem` until it exists.",
          parameters: [numberParam],
          responses: {
            "200": { description: "The post-mortem" },
            "404": { description: "No such incident, or no post-mortem yet (`no_post_mortem`)" },
            ...errors,
          },
        },
      },
      "/incidents/{number}/investigation": {
        get: {
          summary: "The root cause analysis (RCA) of an incident",
          description:
            "What the assistant established from the incident's evidence: the triage, the synthesis (what is going on, what caused it, what to do next), the hypotheses with their confidence — speculation, plausible, likely, strong, validated — and the reviewer's objections, the findings with the evidence ids they cite, the evidence index, the checks that ran, and the grade a person gave against the documented cause. `404 no_analysis` until the first assessment.",
          parameters: [numberParam],
          responses: {
            "200": { description: "The analysis" },
            "404": { description: "No such incident, or no analysis yet (`no_analysis`)" },
            ...errors,
          },
        },
        post: {
          summary: "Ask for a new assessment (scope write)",
          description:
            "Queues one assessment; a running one is not interrupted, the request is served right after it. The result lands in the incident's timeline and channel, and is read back with GET.",
          parameters: [numberParam],
          responses: {
            "202": { description: 'Queued (`{ status: "queued" | "running" }`)' },
            "404": { description: "No such incident" },
            "409": {
              description:
                "Root cause analysis is not available on this workspace (edition, provider or AI governance)",
            },
            ...errors,
          },
        },
      },
      "/incidents/{number}/follow-ups": {
        post: {
          summary: "Create a follow-up (scope write)",
          parameters: [numberParam],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string" },
                    priority: { type: "string", example: "P1" },
                    assignee_email: { type: "string", format: "email" },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created" }, ...errors },
        },
      },
      "/follow-ups": {
        get: {
          summary: "Follow-ups across incidents",
          parameters: [
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["open", "done", "cancelled"] },
            },
          ],
          responses: { "200": { description: "Follow-ups" }, ...errors },
        },
      },
      "/change-events": {
        get: {
          summary: "Deploys, flags and config changes (7 days by default)",
          parameters: [
            { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
          ],
          responses: { "200": { description: "Change events" }, ...errors },
        },
        post: {
          summary:
            "Record a change event (scope write) — what the assistant reads to explain an incident",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    kind: { type: "string", enum: ["deploy", "flag", "config", "other"] },
                    title: { type: "string" },
                    description: { type: "string" },
                    service: {
                      type: "string",
                      description: "The service this changed, by key (`checkout-api`) or id",
                    },
                    environment: { type: "string" },
                    actor: { type: "string" },
                    external_ref: { type: "string", format: "uri" },
                    occurred_at: { type: "string", format: "date-time" },
                    payload: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created" },
            "422": { description: "Invalid body or unknown service" },
            ...errors,
          },
        },
      },
      "/services": {
        get: {
          summary: "The estate, as the product learned it",
          description:
            'Most rows here were never created by anybody: a service appears the first time a trace, a log or an alert names it. `confirmed` and `seen_in` are the difference between "a human said this exists" and "something called itself this once at 3 a.m.".',
          responses: { "200": { description: "Services" }, ...errors },
        },
      },
      "/services/{key}": {
        get: {
          summary: "One service, by its key or its id",
          description:
            "Both are accepted on the same path because both are what a caller has: a CI job knows the key it puts in its traces, a webhook payload carries the id.",
          parameters: [
            {
              name: "key",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "The service key (`checkout-api`) or its UUID.",
            },
          ],
          responses: {
            "200": { description: "Service" },
            "404": { description: "No such service" },
            ...errors,
          },
        },
      },
      "/teams": {
        get: {
          summary: "Teams, their people and the path they escalate on",
          description:
            "Membership is included rather than being a second call: a team with no members routes an alert to nobody and looks configured, and a list that hides that behind another request lets it stay hidden.",
          responses: { "200": { description: "Teams" }, ...errors },
        },
      },
      "/members": {
        get: {
          summary: "Who is in the workspace",
          description:
            "Read-only, and it stays that way — accounts arrive by invitation, in the product. This exists to resolve the member ids the other endpoints return into names.",
          responses: { "200": { description: "Members" }, ...errors },
        },
      },
      "/on-call": {
        get: {
          summary: "Who to wake, right now",
          description:
            "Computed from the rotations, their active windows and any override laid over the top — there is no table to read, and a cached answer is wrong the moment somebody takes a cover. An empty `on_call` array is the answer that matters most: nobody is on call on that schedule at that moment.",
          parameters: [
            {
              name: "at",
              in: "query",
              schema: { type: "string", format: "date-time" },
              description: "Defaults to now.",
            },
            {
              name: "schedule",
              in: "query",
              schema: { type: "string" },
              description: "One schedule, by id or by name. Omit for all of them.",
            },
          ],
          responses: {
            "200": { description: "Who is on call" },
            "404": { description: "No such schedule" },
            "422": { description: "`at` is not a timestamp" },
            ...errors,
          },
        },
      },
      "/schedules": {
        get: {
          summary: "The rotas, with the shape of each rotation",
          responses: { "200": { description: "Schedules" }, ...errors },
        },
      },
      "/schedules/{id}": {
        get: {
          summary: "One rota and its rotations",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": { description: "Schedule" },
            "404": { description: "No such schedule" },
            ...errors,
          },
        },
      },
      "/schedules/{id}/overrides": {
        get: {
          summary: "Covers in force or still to come",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: { "200": { description: "Overrides" }, ...errors },
        },
        post: {
          summary: "Put somebody else on (scope write)",
          description:
            "The one write the on-call model really needs from an API. Everything else about a rota is decided once and lived with; a cover is decided at eight in the morning because a person is ill.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["rotation_id", "member", "start_at", "end_at"],
                  properties: {
                    rotation_id: { type: "string", format: "uuid" },
                    member: {
                      type: "string",
                      description: "The member taking the shift, by id or by email.",
                    },
                    start_at: { type: "string", format: "date-time" },
                    end_at: { type: "string", format: "date-time" },
                    reason: {
                      type: "string",
                      enum: ["override", "cover"],
                      default: "override",
                      description:
                        "`cover` is somebody standing in for the person whose turn it is; `override` replaces the shift outright. The pay report counts them differently.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created" },
            "404": { description: "No such schedule" },
            "422": { description: "Unknown rotation or member, or end before start" },
            ...errors,
          },
        },
      },
      "/escalation-policies": {
        get: {
          summary: "The paths an alert can take",
          description:
            "The published version, never the draft: a workspace can be halfway through rewriting a path, and answering with the draft would describe behaviour nothing is using. `graph` is null for a path created and never published — which routes nothing.",
          responses: { "200": { description: "Policies" }, ...errors },
        },
      },
      "/alerts": {
        get: {
          summary: "The noise, as it arrived",
          description:
            "Alerts, not incidents. Hundreds fire, a handful become incidents, and conflating them is how a tool ends up paging somebody for a disk that is 81 % full. `occurrences` is how many times the same alert fired before anybody looked.",
          parameters: [
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["firing", "resolved"] },
              description:
                "Two, not four: acknowledged and snoozed are states of the escalation that followed, carried as `acked_at` and `snoozed_until`.",
            },
            { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
            {
              name: "cursor",
              in: "query",
              schema: { type: "string", format: "date-time" },
              description: "`next_cursor` from the previous page.",
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            },
          ],
          responses: {
            "200": { description: "Alerts" },
            "422": { description: "Unknown status, or `since` is not a timestamp" },
            ...errors,
          },
        },
      },
      "/alerts/{id}": {
        get: {
          summary: "One alert, its payload and what happened to it",
          description:
            "The payload is what the sender actually sent, kept whole: an alert nobody can explain is an alert nobody can silence, and the payload is usually the explanation.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": { description: "Alert" },
            "404": { description: "No such alert" },
            ...errors,
          },
        },
      },
      "/monitors": {
        get: {
          summary: "The checks, and what each one last saw",
          description:
            '`state` is the current verdict and `last_check_at` is when it was reached; both are needed, because a monitor saying "up" that was last checked two hours ago says nothing about now. A paused monitor keeps its last state rather than reporting healthy.',
          responses: { "200": { description: "Monitors" }, ...errors },
        },
      },
      "/heartbeats": {
        get: {
          summary: "The jobs that are supposed to check in",
          description:
            "The ping token is never returned. It is the credential that lets anybody holding it assert a backup ran, so handing it back would turn a read key into a write one.",
          responses: { "200": { description: "Heartbeats" }, ...errors },
        },
      },
      "/slos": {
        get: {
          summary: "Objectives, and how much budget is left",
          description:
            "`budget_left` is a share and it goes negative: past zero the objective is overspent, and clamping at zero would hide the difference between just missing and missing by a factor of fifteen.",
          responses: { "200": { description: "SLOs" }, ...errors },
        },
      },
      "/runbooks": {
        get: {
          summary: "What somebody wrote down for the next person",
          description:
            'The content is included: the caller most likely to ask is an assistant trying to answer "what do we do about this", which needs the text. `fetch_error` is returned rather than hidden, so a stale copy can be recognised as one.',
          responses: { "200": { description: "Runbooks" }, ...errors },
        },
      },
      "/status-pages": {
        get: {
          summary: "Status pages and their current state",
          responses: { "200": { description: "Pages" }, ...errors },
        },
      },
      "/status-pages/{slug}/incidents": {
        get: {
          summary: "Public incidents and maintenances of a page (90 days)",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Public incidents" },
            "404": { description: "No such page" },
            ...errors,
          },
        },
      },
    },
    "x-webhooks": {
      description:
        "Outbound webhooks carry `x-oi-event`, `x-oi-timestamp` and `x-oi-signature: sha256=HMAC-SHA256(secret, raw body)`. Events: incident.created, incident.updated, incident.update_published, incident.resolved, follow_up.created, alert.created, alert.resolved, escalation.triggered, escalation.acknowledged, status_page.incident_published. Payload: `{ event, occurred_at, incident, … }`.",
    },
  };
  // Tagged on the way out, from the path. See TAGS above for why it is not
  // written on each operation by hand.
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, { tags?: string[] } | undefined>)[method];
      if (operation) operation.tags = [tagFor(path)];
    }
  }
  return doc as unknown as OpenApiDocument;
}

/** Every documented operation, flattened — what the site renders and the test checks. */
export function operations(
  doc: OpenApiDocument,
): { path: string; method: HttpMethod; operation: OpenApiOperation }[] {
  const out: { path: string; method: HttpMethod; operation: OpenApiOperation }[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, OpenApiOperation | undefined>)[method];
      if (operation) out.push({ path, method, operation });
    }
  }
  return out;
}
