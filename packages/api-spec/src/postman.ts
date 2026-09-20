/**
 * OpenAPI → Postman Collection v2.1.
 *
 * Generated from the same document the API serves, for the same reason the
 * reference is: a collection exported by hand starts lying the first time a
 * route changes, and nobody notices until an integrator opens it.
 *
 * Deliberately NOT published to Postman's cloud. The official "Run in Postman"
 * button requires the collection to live in a public Postman workspace, which
 * would mean a copy of our API surface on someone else's servers, re-published
 * by hand on every change — the drift this whole arrangement exists to avoid.
 * The button hands over a file instead: Postman imports it in two clicks, no
 * account, and it is always the collection of the version you are reading.
 */

type Json = Record<string, unknown>;

type PostmanRequest = {
  name: string;
  request: Json;
  response: unknown[];
};

type PostmanFolder = {
  name: string;
  description?: string;
  item: PostmanRequest[];
};

const METHODS = ["get", "post", "patch", "put", "delete"] as const;

/** `{workspace}` in a server URL becomes a Postman variable of the same name. */
function toPostmanUrl(serverUrl: string, path: string) {
  const full = `${serverUrl}${path}`.replace(/\{(\w+)\}/g, "{{$1}}");
  const [base, query] = full.split("?");
  return {
    raw: full,
    // Postman parses `raw` itself, but a split host/path makes the request
    // editable in the UI instead of being one opaque string.
    host: ["{{baseUrl}}"],
    path: path
      .replace(/^\//, "")
      .replace(/\{(\w+)\}/g, ":$1")
      .split("/")
      .filter(Boolean),
    query: query ? [{ key: query, value: "" }] : undefined,
    variable: [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      key: m[1]!,
      value: "",
      description: `The ${m[1]} in the path.`,
    })),
    _base: base,
  };
}

/** A JSON body from a request schema, using the examples the document carries. */
function exampleFromSchema(schema: Json | undefined, schemas: Json): unknown {
  if (!schema) return undefined;
  if (typeof schema["$ref"] === "string") {
    const name = (schema["$ref"] as string).split("/").pop()!;
    return exampleFromSchema(schemas[name] as Json, schemas);
  }
  const examples = schema["examples"];
  if (Array.isArray(examples) && examples.length > 0) return examples[0];
  if (schema["type"] === "array") {
    const inner = exampleFromSchema(schema["items"] as Json, schemas);
    return inner === undefined ? [] : [inner];
  }
  if (schema["type"] === "object" || schema["properties"]) {
    const props = (schema["properties"] ?? {}) as Record<string, Json>;
    const required = (schema["required"] as string[] | undefined) ?? Object.keys(props);
    const out: Json = {};
    for (const key of required) {
      if (!props[key]) continue;
      const value = exampleFromSchema(props[key]!, schemas);
      out[key] = value === undefined ? placeholder(props[key]!) : value;
    }
    return out;
  }
  return placeholder(schema);
}

function placeholder(schema: Json): unknown {
  const enums = schema["enum"];
  if (Array.isArray(enums) && enums.length) return enums[0];
  switch (schema["type"]) {
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return schema["format"] === "email" ? "someone@example.com" : "";
  }
}

export function toPostmanCollection(doc: Json): Json {
  const paths = (doc["paths"] ?? {}) as Record<string, Json>;
  const components = (doc["components"] ?? {}) as Json;
  const schemas = (components["schemas"] ?? {}) as Json;
  const info = (doc["info"] ?? {}) as Json;
  const servers = (doc["servers"] ?? []) as { url: string }[];
  const serverUrl = servers[0]?.url ?? "";

  const tags = ((doc["tags"] ?? []) as { name: string; description?: string }[]).map((t) => ({
    name: t.name,
    description: t.description,
    item: [] as PostmanRequest[],
  }));
  const other: PostmanFolder = { name: "Other", item: [] };
  const folderFor = (tag: string | undefined) => tags.find((f) => f.name === tag) ?? other;

  for (const [path, itemRaw] of Object.entries(paths)) {
    const item = itemRaw as Json;
    const sharedParams = (item["parameters"] ?? []) as Json[];

    for (const method of METHODS) {
      const op = item[method] as Json | undefined;
      if (!op) continue;

      const url = toPostmanUrl(serverUrl, path);
      // One `??`, not two: the first already yields an array, so a second
      // would be dead code the compiler now refuses (TS2869).
      const params = [...sharedParams, ...((op["parameters"] ?? []) as Json[])];
      const query = params
        .filter((p) => p["in"] === "query")
        .map((p) => ({
          key: String(p["name"]),
          value: "",
          description: p["description"] ? String(p["description"]) : undefined,
          // Query parameters arrive disabled: a request that fires with every
          // filter blank returns something confusing rather than nothing.
          disabled: true,
        }));

      const body = (op["requestBody"] as Json | undefined)?.["content"] as Json | undefined;
      const schema = (body?.["application/json"] as Json | undefined)?.["schema"] as
        Json | undefined;
      const example = schema ? exampleFromSchema(schema, schemas) : undefined;

      const request: Json = {
        method: method.toUpperCase(),
        header: [
          ...(example !== undefined ? [{ key: "Content-Type", value: "application/json" }] : []),
        ],
        url: {
          raw: `{{baseUrl}}${path.replace(/\{(\w+)\}/g, ":$1")}`,
          host: ["{{baseUrl}}"],
          path: url.path,
          query: query.length ? query : undefined,
          variable: url.variable.length ? url.variable : undefined,
        },
        description: [op["description"], op["summary"]].filter(Boolean).join("\n\n") || undefined,
      };
      if (example !== undefined) {
        request["body"] = { mode: "raw", raw: JSON.stringify(example, null, 2) };
      }

      const tag = ((op["tags"] as string[] | undefined) ?? [])[0];
      folderFor(tag).item.push({
        name: String(op["summary"] ?? `${method.toUpperCase()} ${path}`),
        request,
        response: [],
      });
    }
  }

  const folders = [...tags, ...(other.item.length ? [other] : [])].filter((f) => f.item.length);

  return {
    info: {
      name: String(info["title"] ?? "API"),
      description:
        "Generated from the OpenAPI document this API serves. " +
        "Set `token` to an API key from Settings → API keys, and `baseUrl` to your workspace.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      version: { major: 1, minor: 0, patch: 0 },
    },
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{token}}", type: "string" }],
    },
    item: folders,
    variable: [
      {
        key: "baseUrl",
        value: serverUrl.replace(/\{(\w+)\}/g, "{{$1}}"),
        description: "Your workspace's API root.",
      },
      {
        key: "workspace",
        value: "skylark",
        description: "The subdomain of your workspace.",
      },
      {
        key: "token",
        value: "",
        type: "string",
        description: "An API key: Settings → API keys. Keep it out of source control.",
      },
    ],
  };
}
