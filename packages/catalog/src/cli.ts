/**
 * catalog-importer — feeds a workspace's catalog from where the truth lives.
 *
 *   pnpm catalog:import -- --source backstage --url http://backstage:7007 \
 *       --api https://acme.example.com --key oi_live_…
 *   pnpm catalog:import -- --source github --repo acme/platform --path catalog-info.yaml --ref main …
 *   pnpm catalog:import -- --source local --file ./catalog.yaml --lock …
 *   pnpm catalog:import -- --source local --file ./squads.csv --type squad …
 *   pnpm catalog:import -- --source exec --cmd "./bin/export-catalog" …
 *   pnpm catalog:import -- --source inline --json '{"types":[…],"entries":[…]}' …
 *
 * Options: --lock (the UI stops editing the types the bundle declares),
 * --dry-run (parse and print, send nothing), --token (GitHub / Backstage).
 * Environment fallbacks: OI_API_URL, OI_API_KEY, GITHUB_TOKEN, BACKSTAGE_TOKEN.
 *
 * The importer is a client of the public API (`POST /api/v1/catalog/import`)
 * and nothing more: it needs no database access and runs from anywhere.
 */
import {
  fromBackstage,
  fromExec,
  fromGithub,
  fromInline,
  fromLocalFile,
  type SourceResult,
} from "./sources/index";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function usage(code: number): never {
  console.error(
    [
      "Usage: pnpm catalog:import -- --source <backstage|github|local|exec|inline> [source options] --api <url> --key <oi_live_…> [--lock] [--dry-run]",
      "  backstage: --url <base> [--token]",
      "  github:    --repo owner/name [--path catalog-info.yaml] [--ref main] [--token]",
      "  local:     --file <path> [--type <key> for CSV]",
      "  exec:      --cmd <command> [--type <key>]",
      "  inline:    --json <document> [--type <key>]",
    ].join("\n"),
  );
  process.exit(code);
}

async function load(): Promise<SourceResult> {
  const source = arg("source");
  const typeKey = arg("type");
  switch (source) {
    case "backstage": {
      const url = arg("url");
      if (!url) usage(2);
      return fromBackstage({ url, token: arg("token") ?? process.env.BACKSTAGE_TOKEN });
    }
    case "github": {
      const repo = arg("repo");
      if (!repo) usage(2);
      return fromGithub(
        {
          repo,
          path: arg("path"),
          ref: arg("ref"),
          token: arg("token") ?? process.env.GITHUB_TOKEN,
        },
        typeKey,
      );
    }
    case "local": {
      const file = arg("file");
      if (!file) usage(2);
      return fromLocalFile(file, typeKey);
    }
    case "exec": {
      const cmd = arg("cmd");
      if (!cmd) usage(2);
      return fromExec(cmd, typeKey);
    }
    case "inline": {
      const json = arg("json");
      if (!json) usage(2);
      return fromInline(json, typeKey);
    }
    default:
      return usage(2);
  }
}

const api = (arg("api") ?? process.env.OI_API_URL ?? "").replace(/\/$/, "");
const key = arg("key") ?? process.env.OI_API_KEY ?? "";
const dryRun = flag("dry-run");
if (!dryRun && (!api || !key)) {
  console.error("Missing --api <url> and --key <oi_live_…> (or OI_API_URL / OI_API_KEY).");
  usage(2);
}

const { bundle, errors, notes } = await load();
for (const n of notes) console.log(`note: ${n}`);
if (errors.length) {
  console.error(`${errors.length} problem(s) in the source — nothing sent:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
const summary = `${bundle.types.length} type(s), ${bundle.entries.length} entr${bundle.entries.length === 1 ? "y" : "ies"}`;
if (dryRun) {
  console.log(`Dry run — would send ${summary}:`);
  for (const t of bundle.types)
    console.log(
      `  type ${t.key} (${t.attributes.map((a) => a.key).join(", ") || "no attributes"})`,
    );
  for (const e of bundle.entries)
    console.log(`  ${e.type} ${e.name}${e.external_id ? ` [${e.external_id}]` : ""}`);
  process.exit(0);
}

const source = arg("source") === "backstage" ? "sync" : "code";
const res = await fetch(`${api}/api/v1/catalog/import`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
  body: JSON.stringify({ ...bundle, lock: flag("lock"), source }),
});
const body = (await res.json().catch(() => ({}))) as {
  types?: { created: number; updated: number; unchanged: number };
  entries?: { created: number; updated: number; unchanged: number };
  error?: { code: string; message: string; details?: string[] };
};
if (!res.ok) {
  console.error(`The API refused the bundle (${res.status} ${body.error?.code ?? ""}):`);
  for (const d of body.error?.details ?? [body.error?.message ?? "no detail"])
    console.error(`  ${d}`);
  process.exit(1);
}
const fmt = (r: { created: number; updated: number; unchanged: number } | undefined) =>
  r ? `${r.created} created · ${r.updated} updated · ${r.unchanged} unchanged` : "—";
console.log(`Sent ${summary}.`);
console.log(`  types:   ${fmt(body.types)}`);
console.log(`  entries: ${fmt(body.entries)}`);
if (flag("lock"))
  console.log("  the declared types are now managed by code: the UI will not edit them.");
