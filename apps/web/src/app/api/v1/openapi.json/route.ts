/**
 * The contract, written by hand and served by the instance — the server URL is
 * rebuilt from the Host header, so a self-hosted instance documents itself.
 */
import { requestOrigin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = requestOrigin({ headers: request.headers, nextUrl: new URL(request.url) });
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
        CatalogAttribute: {
          type: "object",
          required: ["key", "label", "type"],
          properties: {
            key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,39}$" },
            label: { type: "string" },
            type: { type: "string", enum: ["text", "link", "select", "entry", "member_list"] },
            refTypeKey: { type: "string", description: "For entry: the referenced type's key" },
            options: { type: "array", items: { type: "string" }, description: "For select" },
          },
        },
        CatalogTypeSpec: {
          type: "object",
          required: ["key", "name"],
          properties: {
            key: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            attributes: { type: "array", items: { $ref: "#/components/schemas/CatalogAttribute" } },
          },
        },
        CatalogEntrySpec: {
          type: "object",
          required: ["type", "name"],
          properties: {
            type: { type: "string", example: "service" },
            name: { type: "string" },
            description: { type: "string" },
            external_id: { type: "string" },
            attributes: { type: "object", additionalProperties: true },
          },
        },
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
                    service: { type: "string", description: "Catalog service name or id." },
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
      "/catalog/types": {
        get: {
          summary: "Catalog types and their attribute schemas",
          responses: { "200": { description: "Types" }, ...errors },
        },
        post: {
          summary: "Create or update a catalog type by key (scope write)",
          description:
            "Attributes: `text`, `link`, `select` (with `options`), `entry` (with `refTypeKey`), `member_list`. Removing an attribute that still holds values answers 409 unless `force` is true. `lock: true` makes the type read-only in the UI (managed by code).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["key", "name"],
                  properties: {
                    key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,39}$", example: "squad" },
                    name: { type: "string" },
                    description: { type: "string" },
                    attributes: {
                      type: "array",
                      items: { $ref: "#/components/schemas/CatalogAttribute" },
                    },
                    lock: { type: "boolean" },
                    force: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated" },
            "201": { description: "Created" },
            "409": { description: "An attribute still holds values (attribute_in_use)" },
            "422": { description: "Invalid body" },
            ...errors,
          },
        },
      },
      "/catalog/import": {
        post: {
          summary: "Apply a whole catalog bundle in one transaction (scope write)",
          description:
            "What the catalog-importer CLI sends. Types are upserted by key, entries by external_id then by name; one invalid item and nothing is written (422 lists every problem). `source` is `code` or `sync`; `lock` freezes the declared types in the UI.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    types: {
                      type: "array",
                      items: { $ref: "#/components/schemas/CatalogTypeSpec" },
                    },
                    entries: {
                      type: "array",
                      items: { $ref: "#/components/schemas/CatalogEntrySpec" },
                    },
                    lock: { type: "boolean" },
                    source: { type: "string", enum: ["code", "sync"] },
                    force: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Report: counts of created, updated and unchanged types and entries",
            },
            "413": { description: "More than 5000 items" },
            "422": { description: "Invalid bundle (details list every problem)" },
            ...errors,
          },
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
                    service: { type: "string", description: "Catalog service name or id" },
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
      "/catalog/entries": {
        get: {
          summary: "Catalog entries",
          parameters: [
            { name: "type", in: "query", schema: { type: "string", example: "service" } },
          ],
          responses: { "200": { description: "Entries" }, ...errors },
        },
        post: {
          summary: "Create or update entries (scope write)",
          description:
            "One entry, or `{ type, entries: [...] }`. Matched by external_id, then by name. `entry` attributes accept an id, an external_id or a name of the referenced type; `member_list` accepts emails. One invalid row and nothing is written.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/CatalogEntrySpec" },
                    {
                      type: "object",
                      required: ["type", "entries"],
                      properties: {
                        type: { type: "string" },
                        entries: {
                          type: "array",
                          items: { $ref: "#/components/schemas/CatalogEntrySpec" },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated (counts and ids)" },
            "201": { description: "Created (counts and ids)" },
            "422": { description: "Invalid body (details list every problem)" },
            ...errors,
          },
        },
      },
      "/catalog/entries/{id}": {
        get: {
          summary: "One entry and what references it",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Entry" },
            "404": { description: "No such entry" },
            ...errors,
          },
        },
        delete: {
          summary: "Delete an entry (scope write) — refused while anything references it",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "204": { description: "Deleted" },
            "404": { description: "No such entry" },
            "409": { description: "Still referenced (entry_in_use, with referenced_by)" },
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
  return Response.json(doc, { headers: { "cache-control": "public, max-age=300" } });
}
