/**
 * The ingestion service — separate from the web app, on purpose (D23).
 *
 * A burst of logs must never slow down an acknowledgement. `apps/web` serves
 * people who are handling an incident; this serves machines that are talking
 * about one, and the two scale on different curves. Keeping them apart also
 * means the ingestion process is stateless and replicable, and that a crash
 * here never takes a pager with it.
 *
 * Node's own http server, no framework: three routes, one authentication
 * check, no templating, no sessions. Anything more would be furniture.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { gunzipSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import {
  telemetryIngestionKeys,
  telemetryRejections,
  telemetryUsage,
  withTenant,
} from "@openincident/db";
import { telemetryInstalled } from "@openincident/telemetry";
import { callerFor, keyFromHeaders, type Caller } from "./auth";
import { ingestLogs, ingestSpans, settingsFor, type Outcome } from "./ingest";
import { decodeLogs, decodeSpans } from "./otlp";

const PORT = Number(process.env.TELEMETRY_PORT ?? 4318);
/** OTLP's own limit, and the one §15.4 names. */
const MAX_BODY = 16 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);
  return req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
}

/**
 * What the refusals and the volume become, once the request is answered.
 *
 * Both are written after the response on purpose: a collector waiting on its
 * 200 should not also wait on our bookkeeping. Neither may throw into the
 * request path — a full rejections table is not a reason to lose a span.
 */
async function record(caller: Caller, signal: string, outcome: Outcome, bytes: number) {
  try {
    await withTenant(caller.tenantId, async (tx) => {
      if (outcome.rejected.length) {
        await tx.insert(telemetryRejections).values(
          outcome.rejected.slice(0, 20).map((r) => ({
            tenantId: caller.tenantId,
            keyId: caller.keyId,
            signal,
            reason: r.reason,
            excerpt: r.excerpt,
          })),
        );
      }
      if (outcome.accepted > 0) {
        const day = new Date().toISOString().slice(0, 10);
        await tx
          .insert(telemetryUsage)
          .values({ tenantId: caller.tenantId, day, signal, rows: outcome.accepted, bytes })
          .onConflictDoUpdate({
            target: [telemetryUsage.tenantId, telemetryUsage.day, telemetryUsage.signal],
            set: {
              rows: sql`${telemetryUsage.rows} + ${outcome.accepted}`,
              bytes: sql`${telemetryUsage.bytes} + ${bytes}`,
              updatedAt: new Date(),
            },
          });
      }
      await tx
        .update(telemetryIngestionKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(telemetryIngestionKeys.id, caller.keyId));
    });
  } catch (err) {
    console.error("[telemetry] bookkeeping failed:", err);
  }
}

const ROUTES: Record<string, "logs" | "traces"> = {
  "/v1/logs": "logs",
  "/v1/traces": "traces",
};

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0] ?? "";

  if (req.method === "GET" && path === "/healthz") {
    return send(res, telemetryInstalled() ? 200 : 503, {
      ok: telemetryInstalled(),
      // An instance without a column store is not broken, it is not installed.
      detail: telemetryInstalled() ? "ready" : "telemetry module not installed (CLICKHOUSE_URL)",
    });
  }

  const signal = ROUTES[path];
  if (!signal || req.method !== "POST") return send(res, 404, { error: { code: "not_found" } });
  if (!telemetryInstalled())
    return send(res, 503, {
      error: { code: "module_not_installed", message: "this instance has no telemetry storage" },
    });

  const key = keyFromHeaders(req.headers);
  if (!key) return send(res, 401, { error: { code: "missing_key", message: "send x-oi-key" } });

  // The workspace is resolved before a single byte of the body is read.
  const caller = await callerFor(key);
  if (!caller) return send(res, 401, { error: { code: "invalid_key" } });
  if (!caller.signals.includes(signal))
    return send(res, 403, {
      error: { code: "signal_not_allowed", message: `this key may not send ${signal}` },
    });

  const type = String(req.headers["content-type"] ?? "");
  if (!type.includes("json")) {
    return send(res, 415, {
      error: {
        code: "protobuf_not_supported_yet",
        message:
          "this instance reads OTLP/JSON only for now — set OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
      },
    });
  }

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 413, { error: { code: "payload_too_large" } });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return send(res, 400, { error: { code: "invalid_json" } });
  }

  const settings = await settingsFor(caller.tenantId);
  if (!settings.enabledSignals.includes(signal))
    return send(res, 403, {
      error: { code: "signal_disabled", message: `${signal} is turned off for this workspace` },
    });

  let outcome: Outcome;
  try {
    outcome =
      signal === "logs"
        ? await ingestLogs(caller, settings, decodeLogs(payload))
        : await ingestSpans(caller, settings, decodeSpans(payload));
  } catch (err) {
    console.error(`[telemetry] ${signal} insert failed:`, err);
    // 503 rather than 500: the OTel SDKs retry on it, and the data is still
    // in the collector's queue. A 500 tells them to give up.
    return send(res, 503, { error: { code: "storage_unavailable" } });
  }

  send(res, outcome.accepted > 0 || outcome.rejected.length === 0 ? 200 : 422, {
    accepted: outcome.accepted,
    rejected: outcome.rejected.length,
  });
  void record(caller, signal, outcome, body.byteLength);
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[telemetry] unhandled:", err);
    if (!res.headersSent) send(res, 500, { error: { code: "internal" } });
  });
}).listen(PORT, () => {
  console.log(
    telemetryInstalled()
      ? `Open Incident telemetry ingestion on :${PORT} — OTLP/JSON logs and traces`
      : `Open Incident telemetry ingestion on :${PORT} — no storage configured, answering 503`,
  );
});
