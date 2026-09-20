/**
 * What both ingestion paths need: the workspace's settings, the scrub, and the
 * expiry stamped on every row.
 *
 * Extracted for one reason: `ingest.ts` writes the exceptions a batch
 * contained, and the exception writer needs the scrub and the retention. Left
 * in place, the two modules import each other — a cycle that works under ESM
 * until the day the evaluation order changes and a constant is suddenly
 * undefined at module load.
 */
import { eq } from "drizzle-orm";
import { redactSecrets } from "@openincident/ai";
import { telemetrySettings, withTenant } from "@openincident/db";

export type Settings = {
  enabledSignals: string[];
  retentionLogsDays: number;
  retentionTracesDays: number;
  retentionMetricsDays: number;
  cardinalityBudget: number | null;
  scrubRules: RegExp[];
};

const DEFAULTS: Settings = {
  enabledSignals: ["logs", "traces", "metrics"],
  retentionLogsDays: 15,
  retentionTracesDays: 15,
  retentionMetricsDays: 30,
  cardinalityBudget: null,
  scrubRules: [],
};

export async function settingsFor(tenantId: string): Promise<Settings> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(telemetrySettings)
      .where(eq(telemetrySettings.tenantId, tenantId));
    if (!row) return DEFAULTS;
    return {
      enabledSignals: row.enabledSignals,
      retentionLogsDays: row.retentionLogsDays,
      retentionTracesDays: row.retentionTracesDays,
      retentionMetricsDays: row.retentionMetricsDays,
      cardinalityBudget: row.cardinalityBudget,
      // A workspace's own rule is data, and a bad regular expression is a
      // configuration mistake, not an outage: it is dropped, not thrown.
      scrubRules: row.scrubRules.flatMap((r) => {
        try {
          return [new RegExp(r, "g")];
        } catch {
          return [];
        }
      }),
    };
  });
}

export function scrub(text: string, rules: RegExp[]): string {
  let out = redactSecrets(text);
  for (const re of rules) out = out.replace(re, "[redacted]");
  return out;
}

/** Hashed rather than redacted: correlation survives, identity does not. */
const HASHED_ATTRS = ["enduser.id", "user.email", "user.id", "client.address"];

export function scrubAttributes(
  a: Record<string, string>,
  rules: RegExp[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) {
    out[k] = HASHED_ATTRS.includes(k) ? `sha256:${shortHash(v)}` : scrub(v, rules);
  }
  return out;
}

function shortHash(v: string): string {
  // 12 hex characters: enough to group by a user across a session, far too
  // little to walk back to the address.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < v.length; i++) {
    h1 = Math.imul(h1 ^ v.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + v.charCodeAt(i), 2654435761) >>> 0;
  }
  return (h1.toString(16) + h2.toString(16)).padStart(12, "0").slice(0, 12);
}

export function retentionAt(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
