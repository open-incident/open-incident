/**
 * Backstage entities → catalog bundle. The same mapping serves the live
 * Backstage API, a `catalog-info.yaml` fetched from GitHub and a local file:
 *
 *   Group      → team     (external_id `group:<namespace>/<name>`)
 *   Component  → service  (external_id `component:<namespace>/<name>`,
 *                          owner → the group's external_id,
 *                          repository ← github.com/project-slug annotation,
 *                          tier ← openincident.dev/tier annotation)
 *
 * Other kinds are ignored, and said so: nothing is invented for them.
 */
import type { Bundle, EntrySpec } from "./spec";

export type BackstageEntity = {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    title?: string;
    description?: string;
    annotations?: Record<string, string>;
  };
  spec?: {
    type?: string;
    owner?: string;
    profile?: { displayName?: string };
    [k: string]: unknown;
  };
};

export function isBackstageEntity(v: unknown): v is BackstageEntity {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as BackstageEntity).kind === "string" &&
    typeof (v as BackstageEntity).metadata?.name === "string"
  );
}

/** "group:default/search" | "search" | "user:jane" → "group:default/search" | null */
export function groupRef(owner: string | undefined, namespace = "default"): string | null {
  if (!owner) return null;
  const m = owner.match(/^(?:([a-z]+):)?(?:([^/]+)\/)?([^/]+)$/i);
  if (!m) return null;
  const kind = (m[1] ?? "group").toLowerCase();
  if (kind !== "group") return null;
  return `group:${(m[2] ?? namespace).toLowerCase()}/${m[3]!.toLowerCase()}`;
}

export function bundleFromEntities(entities: unknown[]): { bundle: Bundle; skipped: string[] } {
  const skipped: string[] = [];
  const entries: EntrySpec[] = [];
  for (const raw of entities) {
    if (!isBackstageEntity(raw)) {
      skipped.push("an item without kind/metadata.name");
      continue;
    }
    const kind = raw.kind!.toLowerCase();
    const ns = (raw.metadata?.namespace ?? "default").toLowerCase();
    const name = raw.metadata!.name!;
    const ann = raw.metadata?.annotations ?? {};
    if (kind === "group") {
      entries.push({
        type: "team",
        name: raw.spec?.profile?.displayName ?? raw.metadata?.title ?? name,
        description: raw.metadata?.description ?? null,
        external_id: `group:${ns}/${name.toLowerCase()}`,
        attributes: {
          ...(ann["slack.com/channel"] ? { chat_channel: ann["slack.com/channel"] } : {}),
        },
      });
    } else if (kind === "component") {
      const owner = groupRef(raw.spec?.owner, ns);
      const attributes: Record<string, unknown> = {};
      if (owner) attributes.owner = owner;
      if (ann["github.com/project-slug"]) attributes.repository = ann["github.com/project-slug"];
      if (ann["openincident.dev/tier"]) attributes.tier = ann["openincident.dev/tier"];
      entries.push({
        type: "service",
        name,
        description: raw.metadata?.description ?? null,
        external_id: `component:${ns}/${name.toLowerCase()}`,
        attributes,
      });
    } else skipped.push(`${raw.kind} ${name}`);
  }
  // Teams first: a component's owner must exist before the service is resolved.
  entries.sort((a, b) => (a.type === b.type ? 0 : a.type === "team" ? -1 : 1));
  return { bundle: { types: [], entries }, skipped };
}
