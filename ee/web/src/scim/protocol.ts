/**
 * SCIM 2.0 wire format (RFC 7643/7644): schemas, the error envelope, list
 * responses, the filter subset identity providers actually send, and the
 * PATCH operations of Okta and Entra ID.
 */

export const SCIM_JSON = "application/scim+json; charset=utf-8";
export const SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCHEMA_GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCHEMA_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCHEMA_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCHEMA_PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCHEMA_SPC = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";
export const SCHEMA_RT = "urn:ietf:params:scim:schemas:core:2.0:ResourceType";
export const SCHEMA_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Schema";

export class ScimError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly scimType?: string,
  ) {
    super(message);
  }
}

export function scimJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": SCIM_JSON, ...headers },
  });
}

export function scimError(status: number, detail: string, scimType?: string) {
  return scimJson(
    { schemas: [SCHEMA_ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) },
    status,
  );
}

export function listResponse<T>(resources: T[], total: number, startIndex: number) {
  return {
    schemas: [SCHEMA_LIST],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

/** `attr eq "value"` — the one filter shape providers use to look a resource up. */
export type EqFilter = { attribute: string; value: string };

export function parseEqFilter(filter: string | null): EqFilter | null {
  if (!filter) return null;
  const m = filter
    .trim()
    .match(/^([A-Za-z][\w.:$-]*(?:\[[^\]]*\]\.\w+)?)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i);
  if (!m) throw new ScimError(400, `Unsupported filter: ${filter}`, "invalidFilter");
  return { attribute: m[1]!.toLowerCase(), value: m[2]!.replace(/\\"/g, '"') };
}

export function paging(url: URL): { startIndex: number; count: number } {
  const startIndex = Math.max(1, Number(url.searchParams.get("startIndex") ?? "1") || 1);
  const count = Math.min(200, Math.max(0, Number(url.searchParams.get("count") ?? "100") || 100));
  return { startIndex, count };
}

export type PatchOp = { op: "add" | "replace" | "remove"; path?: string; value?: unknown };

export function parsePatch(body: unknown): PatchOp[] {
  const ops = (body as { Operations?: unknown } | null)?.Operations;
  if (!Array.isArray(ops) || ops.length === 0)
    throw new ScimError(400, "PatchOp requires Operations", "invalidValue");
  return ops.map((raw) => {
    const o = raw as { op?: unknown; path?: unknown; value?: unknown };
    const op = String(o.op ?? "").toLowerCase();
    if (op !== "add" && op !== "replace" && op !== "remove")
      throw new ScimError(400, `Unsupported operation: ${String(o.op)}`, "invalidValue");
    return { op, path: typeof o.path === "string" ? o.path : undefined, value: o.value };
  });
}

/**
 * Flattens a PATCH into attribute assignments. Two shapes arrive in practice:
 * `{ op, path: "active", value: false }` (Okta) and
 * `{ op, value: { active: false, "name.givenName": "…" } }` (Entra ID).
 * Complex paths on members are handled by the groups module.
 */
export function assignments(
  ops: PatchOp[],
): Array<{ path: string; value: unknown; op: PatchOp["op"] }> {
  const out: Array<{ path: string; value: unknown; op: PatchOp["op"] }> = [];
  for (const o of ops) {
    if (o.path) out.push({ path: o.path, value: o.value, op: o.op });
    else if (o.value && typeof o.value === "object")
      for (const [k, v] of Object.entries(o.value as Record<string, unknown>))
        out.push({ path: k, value: v, op: o.op });
    else throw new ScimError(400, "An operation needs a path or an object value", "noTarget");
  }
  return out;
}

export function readJsonBody(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ScimError(400, "The body must be JSON", "invalidSyntax");
  }
}

/** The static resources a provider reads before it starts. */
export function serviceProviderConfig(base: string) {
  return {
    schemas: [SCHEMA_SPC],
    documentationUri: `${base.replace(/\/scim\/v2$/, "")}/api/v1/openapi.json`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Authorization: Bearer <token from Settings → Provisioning>",
        primary: true,
      },
    ],
    meta: { resourceType: "ServiceProviderConfig", location: `${base}/ServiceProviderConfig` },
  };
}

export function resourceTypes(base: string) {
  return [
    {
      schemas: [SCHEMA_RT],
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: SCHEMA_USER,
      meta: { resourceType: "ResourceType", location: `${base}/ResourceTypes/User` },
    },
    {
      schemas: [SCHEMA_RT],
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      schema: SCHEMA_GROUP,
      meta: { resourceType: "ResourceType", location: `${base}/ResourceTypes/Group` },
    },
  ];
}

export function schemas(base: string) {
  const attr = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
    name,
    type,
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: "readWrite",
    returned: "default",
    uniqueness: "none",
    ...extra,
  });
  return [
    {
      schemas: [SCHEMA_SCHEMA],
      id: SCHEMA_USER,
      name: "User",
      description: "A workspace member",
      attributes: [
        attr("userName", "string", { required: true, uniqueness: "server" }),
        attr("externalId", "string", { uniqueness: "server" }),
        attr("displayName", "string"),
        attr("active", "boolean"),
        attr("name", "complex", {
          subAttributes: [
            attr("givenName", "string"),
            attr("familyName", "string"),
            attr("formatted", "string"),
          ],
        }),
        attr("emails", "complex", {
          multiValued: true,
          subAttributes: [
            attr("value", "string"),
            attr("type", "string"),
            attr("primary", "boolean"),
          ],
        }),
        attr("roles", "complex", {
          multiValued: true,
          subAttributes: [
            attr("value", "string"),
            attr("display", "string"),
            attr("primary", "boolean"),
          ],
        }),
      ],
      meta: { resourceType: "Schema", location: `${base}/Schemas/${SCHEMA_USER}` },
    },
    {
      schemas: [SCHEMA_SCHEMA],
      id: SCHEMA_GROUP,
      name: "Group",
      description: "A catalog team",
      attributes: [
        attr("displayName", "string", { required: true }),
        attr("externalId", "string"),
        attr("members", "complex", {
          multiValued: true,
          subAttributes: [
            attr("value", "string"),
            attr("display", "string", { mutability: "readOnly" }),
          ],
        }),
      ],
      meta: { resourceType: "Schema", location: `${base}/Schemas/${SCHEMA_GROUP}` },
    },
  ];
}
