import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HTTP_METHODS, openApiDocument, operations, type HttpMethod } from "../src/index";

/**
 * The documentation cannot drift from the product.
 *
 * A public endpoint that nobody documented is an endpoint nobody can use, and
 * a documented endpoint the product does not answer is a promise it breaks. So
 * this walks the route files of apps/web and compares them, method by method,
 * with the contract — and fails on either kind of gap. Adding a route means
 * writing it into `openApiDocument`, which is exactly the point.
 */

const API_ROOT = path.resolve(__dirname, "../../../apps/web/src/app/api/v1");

/** The routes the app really exposes, as OpenAPI-style paths. */
function routesOnDisk(): { path: string; method: HttpMethod }[] {
  const found: { path: string; method: HttpMethod }[] = [];

  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        // Next's [param] becomes OpenAPI's {param}; catch-alls are not v1 routes.
        const seg = entry.startsWith("[") ? `{${entry.slice(1, -1)}}` : entry;
        walk(full, [...segments, seg]);
        continue;
      }
      if (entry !== "route.ts") continue;
      // The contract documents itself nowhere: it is the contract.
      if (segments.join("/") === "openapi.json") continue;
      const source = readFileSync(full, "utf8");
      for (const method of HTTP_METHODS) {
        const verb = method.toUpperCase();
        if (new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b`).test(source)) {
          found.push({ path: `/${segments.join("/")}`, method });
        }
      }
    }
  };

  walk(API_ROOT, []);
  return found;
}

const doc = openApiDocument("https://acme.open-incident.example");
const documented = operations(doc)
  .map((o) => `${o.method.toUpperCase()} ${o.path}`)
  .sort();
const onDisk = routesOnDisk()
  .map((r) => `${r.method.toUpperCase()} ${r.path}`)
  .sort();

describe("the API contract covers the API", () => {
  it("documents every endpoint the product exposes", () => {
    const missing = onDisk.filter((r) => !documented.includes(r));
    expect(missing, `undocumented endpoints — add them to packages/api-spec`).toEqual([]);
  });

  it("documents nothing the product does not answer", () => {
    const extra = documented.filter((r) => !onDisk.includes(r));
    expect(extra, `documented but not implemented — remove them or ship them`).toEqual([]);
  });

  it("gives every operation a summary and an error path", () => {
    for (const { path: p, method, operation } of operations(doc)) {
      const where = `${method.toUpperCase()} ${p}`;
      expect(operation.summary, `${where} has no summary`).toBeTruthy();
      // Every endpoint is authenticated: 401 is always a possible answer.
      expect(Object.keys(operation.responses), `${where} documents no 401`).toContain("401");
    }
  });

  it("carries the pieces a reader needs before the first call", () => {
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBeTruthy();
    expect(doc.servers[0]!.url).toContain("acme.open-incident.example");
    expect(doc.components).toBeTruthy();
  });
});
