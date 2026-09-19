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
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
};

/** The HTTP methods a path may declare — anything else is not an operation. */
export const HTTP_METHODS = ["get", "post", "patch", "put", "delete"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export function openApiDocument(origin: string): OpenApiDocument {
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
    servers: [{ url: `${origin}/api/v1` }],
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
