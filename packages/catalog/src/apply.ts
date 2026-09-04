/**
 * One bundle, one transaction. Types first (in bundle order, so a type may
 * reference one declared above it), then entries grouped by type. Any error
 * throws `BundleError` — inside `withTenant`, that rolls everything back — and
 * the caller reports the whole list.
 */
import type { Tx } from "@openincident/db";
import type { Bundle } from "./spec";
import { upsertEntries, upsertType } from "./upsert";

export type ApplyOptions = {
  locked?: boolean;
  source?: "ui" | "code" | "sync";
  force?: boolean;
};

export type ApplyReport = {
  types: { created: number; updated: number; unchanged: number };
  entries: { created: number; updated: number; unchanged: number };
};

export class BundleError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.slice(0, 5).join("; ") + (errors.length > 5 ? ` (+${errors.length - 5})` : ""));
    this.name = "BundleError";
  }
}

export async function applyBundle(
  tx: Tx,
  tenantId: string,
  bundle: Bundle,
  options: ApplyOptions = {},
): Promise<ApplyReport> {
  const report: ApplyReport = {
    types: { created: 0, updated: 0, unchanged: 0 },
    entries: { created: 0, updated: 0, unchanged: 0 },
  };
  const errors: string[] = [];
  const knownTypeKeys = bundle.types.map((t) => t.key);
  for (const spec of bundle.types) {
    const r = await upsertType(tx, tenantId, spec, {
      locked: options.locked,
      source: options.source,
      force: options.force,
      knownTypeKeys,
    });
    if (!r.ok) errors.push(...r.errors);
    else if (r.created) report.types.created++;
    else if (r.changed) report.types.updated++;
    else report.types.unchanged++;
  }
  if (errors.length) throw new BundleError(errors);

  const byType = new Map<string, typeof bundle.entries>();
  for (const e of bundle.entries) {
    let list = byType.get(e.type);
    if (!list) byType.set(e.type, (list = []));
    list.push(e);
  }
  for (const [typeKey, rows] of byType) {
    const r = await upsertEntries(tx, tenantId, typeKey, rows);
    if (r.errors.length) errors.push(...r.errors);
    report.entries.created += r.created;
    report.entries.updated += r.updated;
    report.entries.unchanged += r.unchanged;
  }
  if (errors.length) throw new BundleError(errors);
  return report;
}
