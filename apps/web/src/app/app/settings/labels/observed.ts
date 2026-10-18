/**
 * The labels a workspace's alerts actually carry — observed, never declared:
 * every key found in `alerts.attributes` over the last ninety days, how many
 * alerts carry it, and its most frequent values. Server only.
 *
 * The pipeline writes a few keys of its own on every alert — which source it
 * came from, the severity it was given, the ids a service or team name was
 * matched to. They are the product's bookkeeping, not labels a tool sent, and
 * are left out; a rule still reads them by their own names.
 */
import { sql } from "drizzle-orm";
import { alerts, type Tx } from "@openincident/db";

export const LABEL_WINDOW_DAYS = 90;

/** Keys the pipeline itself adds to every alert. */
export const PIPELINE_KEYS = ["source", "source_name", "service_id", "team_id", "priority"];

export type ObservedLabel = {
  key: string;
  /** Alerts carrying the key in the window. */
  alerts: number;
  /** Distinct values in the window. */
  distinct: number;
  /** Up to 200 values, most frequent first. */
  values: string[];
};

export async function observedLabels(tx: Tx, tenantId: string): Promise<ObservedLabel[]> {
  const since = new Date(Date.now() - LABEL_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = (await tx.execute(sql`
    with kv as (
      select k.key, a.attributes ->> k.key as v
        from ${alerts} a, jsonb_object_keys(a.attributes) as k(key)
       where a.tenant_id = ${tenantId} and a.first_at > ${since}::timestamptz
    ), vc as (
      select key, v, count(*)::int as n from kv group by key, v
    )
    select key,
           sum(n)::int as alerts,
           count(*)::int as distinct_values,
           (array_agg(v order by n desc, v))[1:200] as vals
      from vc
     group by key
     order by sum(n) desc, key
  `)) as unknown as Array<{ key: string; alerts: number; distinct_values: number; vals: string[] }>;
  return rows
    .filter((r) => !PIPELINE_KEYS.includes(r.key))
    .map((r) => ({
      key: r.key,
      alerts: Number(r.alerts),
      distinct: Number(r.distinct_values),
      values: (r.vals ?? []).filter((v): v is string => typeof v === "string"),
    }));
}
