/**
 * Writes the OpenAPI document, and the Postman collection beside it.
 *
 *   pnpm --filter @openincident/api-spec run emit -- --out openapi.json
 *
 * The developer site builds from this file, so the reference and the running
 * API come from one source. A hand-copied snapshot starts lying the first time
 * a route changes, and nobody notices until an integrator opens it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { openApiDocument } from "./index";
import { toPostmanCollection } from "./postman";

/**
 * Writes a file, creating its directory first.
 *
 * `writeFileSync` on its own is enough on a laptop and fails in CI, which is
 * the whole reason this is a function. The site wants the collection under
 * `apps/api-docs/public/`, that file is generated rather than committed, and
 * **git does not track empty directories** — so the directory exists on a
 * machine where the file has been generated once, and nowhere else.
 *
 * A build step that only works where its output already exists is not a build
 * step.
 */
function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const out = flag("out") ?? "openapi.json";
const origin = flag("origin") ?? "https://{workspace}.open-incident.com";
/**
 * `--local <origin>` adds a second server to the document. Used when serving
 * the site on a laptop: the reference's playground then offers the running
 * instance, and pressing "Test" does something.
 */
const local = flag("local");
const extra = local ? [local] : [];

const doc = openApiDocument(origin, extra);
write(out, JSON.stringify(doc, null, 2) + "\n");
console.log(
  `OpenAPI written to ${out} (servers: ${[origin, ...extra].map((o) => `${o}/api/v1`).join(", ")})`,
);

const postman = flag("postman");
if (postman) {
  const collection = toPostmanCollection(doc as unknown as Record<string, unknown>);
  write(postman, JSON.stringify(collection, null, 2) + "\n");
  const count = (collection["item"] as { item: unknown[] }[]).reduce(
    (n, f) => n + f.item.length,
    0,
  );
  console.log(`Postman collection written to ${postman} (${count} requests)`);
}
