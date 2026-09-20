/**
 * Writing what a browser reported.
 *
 * One insert per batch, and no service resolution: a RUM application is not a
 * service, it is a page, and the thing it maps onto in this product is the
 * application row a person created on purpose. Inventing a service from a
 * hostname would fill the Services screen with every domain a customer owns.
 */
import { clickhouse } from "@openincident/telemetry";
import type { Outcome } from "./ingest";
import { retentionAt, scrub, scrubAttributes, type Settings } from "./shared";
import type { RumEvent } from "./rum";
import { scrubPayload, type ReplayChunk } from "./replay";

export async function ingestRum(
  tenantId: string,
  appId: string,
  settings: Settings,
  events: RumEvent[],
): Promise<Outcome> {
  const out: Outcome = { accepted: 0, rejected: [] };
  if (events.length === 0) return out;

  const until = retentionAt(settings.retentionRumDays);
  await clickhouse().insert({
    table: "rum_events",
    format: "JSONEachRow",
    values: events.map((e) => ({
      tenant_id: tenantId,
      app_id: appId,
      ts: e.ts,
      session_id: e.sessionId,
      view_id: e.viewId,
      event_type: e.type,
      // A URL is the likeliest place in a browser payload for a token: reset
      // links, magic links and a hundred APIs put one in a query string.
      url: scrub(e.url, settings.scrubRules),
      route: e.route,
      vital_name: e.vitalName,
      vital_value: e.vitalValue,
      vital_rating: e.vitalRating,
      browser: e.browser,
      os: e.os,
      device: e.device,
      country: e.country,
      trace_id: e.traceId,
      error_type: e.errorType,
      error_message: scrub(e.errorMessage, settings.scrubRules),
      error_stack: scrub(e.errorStack, settings.scrubRules),
      user_hash: e.userHash,
      attributes: scrubAttributes(e.attributes, settings.scrubRules),
      retention_at: until,
    })),
  });

  out.accepted = events.length;
  return out;
}

/**
 * One chunk of a session recording, written.
 *
 * Its own insert rather than a row in `rum_events`: a chunk is two orders of
 * magnitude larger than an event, and putting it in the wide table would make
 * every timeline query drag megabytes of DOM it does not read.
 */
export async function ingestReplay(
  tenantId: string,
  appId: string,
  settings: Settings,
  chunk: ReplayChunk,
): Promise<void> {
  const payload = scrubPayload(chunk.payload, (text) => scrub(text, settings.scrubRules));
  await clickhouse().insert({
    table: "rum_replay_chunks",
    format: "JSONEachRow",
    values: [
      {
        tenant_id: tenantId,
        app_id: appId,
        session_id: chunk.sessionId,
        seq: chunk.seq,
        first_ts: chTime(chunk.firstTs),
        last_ts: chTime(chunk.lastTs),
        events: chunk.events,
        has_snapshot: chunk.hasSnapshot,
        payload,
        retention_at: retentionAt(settings.retentionRumDays),
      },
    ],
  });
}

/** ClickHouse wants `YYYY-MM-DD hh:mm:ss.mmm`, not an ISO string with a `T`. */
function chTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 23).replace("T", " ");
}
