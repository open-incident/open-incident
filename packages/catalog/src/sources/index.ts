/**
 * Where a bundle comes from. Every source ends in the same place — a `Bundle`
 * — so the importer and the API never care which one produced it.
 *
 * Text sources (local file, GitHub file, exec output, inline JSON) are
 * sniffed: an Open Incident bundle `{ types, entries }`, one or more Backstage
 * entities (`catalog-info.yaml`), or a CSV of one type.
 */
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { load, loadAll } from "js-yaml";
import { bundleFromEntities, isBackstageEntity } from "../entities";
import { entriesFromCsv } from "../csv";
import { parseBundle, type Bundle } from "../spec";

export type SourceResult = { bundle: Bundle; errors: string[]; notes: string[] };

export type TextSourceOptions = {
  /** For CSV: the type the rows belong to. */
  typeKey?: string;
  /** A hint for the sniffing: "csv", "yaml", "json" (from the file name). */
  format?: string;
};

function formatOf(name: string | undefined): string | undefined {
  const ext = name?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (ext === "yml") return "yaml";
  return ext;
}

/** Sniffs a text document and turns it into a bundle. */
export function bundleFromText(text: string, options: TextSourceOptions = {}): SourceResult {
  const notes: string[] = [];
  const format = options.format ?? (text.trimStart().startsWith("{") ? "json" : undefined);
  if (format === "csv") {
    if (!options.typeKey)
      return {
        bundle: { types: [], entries: [] },
        errors: ["csv: --type <key> is required"],
        notes,
      };
    const { entries, errors } = entriesFromCsv(text, options.typeKey);
    return { bundle: { types: [], entries }, errors, notes };
  }
  let docs: unknown[];
  try {
    docs = format === "json" ? [JSON.parse(text) as unknown] : loadAll(text);
  } catch (e) {
    return {
      bundle: { types: [], entries: [] },
      errors: [`parse: ${e instanceof Error ? e.message : String(e)}`],
      notes,
    };
  }
  docs = docs.filter((d) => d !== null && d !== undefined);
  if (docs.length === 1 && Array.isArray(docs[0])) docs = docs[0] as unknown[];
  if (docs.length > 0 && docs.every(isBackstageEntity)) {
    const { bundle, skipped } = bundleFromEntities(docs);
    if (skipped.length) notes.push(`ignored (not a Group or a Component): ${skipped.join(", ")}`);
    return { bundle, errors: [], notes };
  }
  if (docs.length === 1) {
    const { bundle, errors } = parseBundle(docs[0]);
    return { bundle, errors, notes };
  }
  return {
    bundle: { types: [], entries: [] },
    errors: ["unrecognised document: expected { types, entries } or Backstage entities"],
    notes,
  };
}

export async function fromLocalFile(path: string, typeKey?: string): Promise<SourceResult> {
  const text = await readFile(path, "utf8");
  return bundleFromText(text, { typeKey, format: formatOf(path) });
}

export function fromInline(json: string, typeKey?: string): SourceResult {
  return bundleFromText(json, {
    typeKey,
    format: json.trimStart().startsWith("{") ? "json" : "yaml",
  });
}

/** Runs a command; its stdout is the document. The shell is the operator's. */
export async function fromExec(command: string, typeKey?: string): Promise<SourceResult> {
  const run = promisify(execFile);
  const { stdout } = await run("/bin/sh", ["-c", command], { maxBuffer: 32 * 1024 * 1024 });
  return bundleFromText(stdout, { typeKey });
}

export type GithubFileOptions = {
  repo: string;
  path?: string;
  ref?: string;
  token?: string;
  apiBase?: string;
};

/** A file of a GitHub repository, through the contents API (private repos need a token). */
export async function fromGithub(o: GithubFileOptions, typeKey?: string): Promise<SourceResult> {
  const base = (o.apiBase ?? process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(
    /\/$/,
    "",
  );
  const path = o.path ?? "catalog-info.yaml";
  const url = `${base}/repos/${o.repo}/contents/${path.replace(/^\//, "")}${o.ref ? `?ref=${encodeURIComponent(o.ref)}` : ""}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "openincident-catalog-importer",
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${o.repo}/${path}`);
  const body = (await res.json()) as { content?: string; encoding?: string };
  if (!body.content) throw new Error(`GitHub returned no content for ${o.repo}/${path}`);
  const text =
    body.encoding === "base64"
      ? Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8")
      : body.content;
  return bundleFromText(text, { typeKey, format: formatOf(path) });
}

export type BackstageOptions = { url: string; token?: string };

/** The Backstage catalog API: groups and components, paginated. */
export async function fromBackstage(o: BackstageOptions): Promise<SourceResult> {
  const base = o.url.replace(/\/$/, "");
  const headers = {
    accept: "application/json",
    "user-agent": "openincident-catalog-importer",
    ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
  };
  const entities: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 200; page++) {
    const q = new URLSearchParams();
    q.append("filter", "kind=group");
    q.append("filter", "kind=component");
    q.set("limit", "500");
    if (cursor) q.set("cursor", cursor);
    const res = await fetch(`${base}/api/catalog/entities/by-query?${q.toString()}`, { headers });
    if (!res.ok) throw new Error(`Backstage answered ${res.status} at ${base}`);
    const body = (await res.json()) as {
      items?: unknown[];
      pageInfo?: { nextCursor?: string };
    };
    entities.push(...(body.items ?? []));
    cursor = body.pageInfo?.nextCursor;
    if (!cursor) break;
  }
  const { bundle, skipped } = bundleFromEntities(entities);
  const notes = skipped.length ? [`ignored: ${skipped.length} entities of other kinds`] : [];
  return { bundle, errors: [], notes };
}

export { load as parseYaml };
