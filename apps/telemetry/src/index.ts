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
import {
  decodeLogsProto,
  decodeMetricsProto,
  decodeSpansProto,
  encodeLogsResponse,
  encodeMetricsResponse,
  encodeTraceResponse,
} from "./protobuf";
import { decodeMetricsJson } from "./metrics";
import { ingestMetrics } from "./metrics-ingest";
import { decodeRemoteWrite, remoteWriteVersion, RemoteWriteError } from "./remote-write";
import { decodePprof, PprofError } from "./pprof";
import { ingestProfiles, parsePyroscopeName } from "./profiles-ingest";
import { SnappyError } from "./snappy";

const PORT = Number(process.env.TELEMETRY_PORT ?? 4318);
/** OTLP's own limit, and the one §15.4 names. */
const MAX_BODY = 16 * 1024 * 1024;

function sendProto(res: ServerResponse, status: number, body: Buffer): void {
  res.writeHead(status, {
    "content-type": "application/x-protobuf",
    "content-length": body.byteLength,
  });
  res.end(body);
}

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
async function record(caller: Caller, signal: Signal, outcome: Outcome, bytes: number) {
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

type Signal = "logs" | "traces" | "metrics" | "profiles";

const ROUTES: Record<string, Signal> = {
  "/v1/logs": "logs",
  "/v1/traces": "traces",
  "/v1/metrics": "metrics",
};

/*
 * Prometheus remote write, on the path Prometheus expects.
 *
 * `/api/v1/write` is not a path we chose — it is the one a `remote_write`
 * block appends to whatever URL it is given, and a sender cannot be told
 * otherwise. It is handled apart from the OTLP routes because everything about
 * it differs: snappy rather than raw protobuf, a response that carries nothing,
 * and a 204 rather than a 200.
 */
const REMOTE_WRITE = "/api/v1/write";

/*
 * Profiles, on two paths.
 *
 * `/v1/profiles` is ours and takes a pprof body with the service in the query
 * string. `/ingest` is Pyroscope's, and it is there because that is what the
 * agents already speak: Grafana Alloy, the Pyroscope agent and the Java and
 * Python SDKs all POST there, and accepting it means one line of their
 * configuration changes rather than their whole profiling setup.
 */
const PROFILE_PATHS = new Set(["/v1/profiles", "/ingest", "/ingest/v1/profiles"]);

/** Each signal answers a protobuf sender in its own response message. */
function protoResponse(signal: Signal, rejected: number, message: string): Buffer {
  if (signal === "logs") return encodeLogsResponse(rejected, message);
  if (signal === "metrics") return encodeMetricsResponse(rejected, message);
  return encodeTraceResponse(rejected, message);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0] ?? "";

  if (req.method === "GET" && path === "/healthz") {
    return send(res, telemetryInstalled() ? 200 : 503, {
      ok: telemetryInstalled(),
      // An instance without a column store is not broken, it is not installed.
      detail: telemetryInstalled() ? "ready" : "telemetry module not installed (CLICKHOUSE_URL)",
    });
  }

  if (req.method === "POST" && path === REMOTE_WRITE) return remoteWrite(req, res);
  if (req.method === "POST" && PROFILE_PATHS.has(path)) return profiles(req, res);

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

  // An OTLP sender must be answered in the encoding it used: a protobuf
  // exporter reading a JSON error body logs a parse failure and hides ours.
  const type = String(req.headers["content-type"] ?? "");
  const proto = type.includes("protobuf") || type.includes("octet-stream");
  const fail = (status: number, code: string, message?: string) =>
    proto
      ? sendProto(res, status, protoResponse(signal, 0, message ?? code))
      : send(res, status, { error: { code, ...(message ? { message } : {}) } });

  if (!proto && !type.includes("json")) {
    return send(res, 415, {
      error: {
        code: "unsupported_content_type",
        message: "send OTLP as application/x-protobuf or application/json",
      },
    });
  }

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    return fail(413, "payload_too_large");
  }

  const settings = await settingsFor(caller.tenantId);
  if (!settings.enabledSignals.includes(signal))
    return fail(403, "signal_disabled", `${signal} is turned off for this workspace`);

  let outcome: Outcome;
  try {
    if (signal === "logs") {
      const decoded = proto ? decodeLogsProto(body) : decodeLogs(JSON.parse(body.toString("utf8")));
      outcome = await ingestLogs(caller, settings, decoded);
    } else if (signal === "metrics") {
      const decoded = proto
        ? decodeMetricsProto(body)
        : decodeMetricsJson(JSON.parse(body.toString("utf8")));
      outcome = await ingestMetrics(caller, settings, decoded);
    } else {
      const decoded = proto
        ? decodeSpansProto(body)
        : decodeSpans(JSON.parse(body.toString("utf8")));
      outcome = await ingestSpans(caller, settings, decoded);
    }
  } catch (err) {
    if (!proto && err instanceof SyntaxError)
      return send(res, 400, { error: { code: "invalid_json" } });
    console.error(`[telemetry] ${signal} failed:`, err);
    // 503 rather than 500: the OTel SDKs retry on it, and the data is still
    // in the collector's queue. A 500 tells them to give up.
    return fail(503, "storage_unavailable");
  }

  const rejected = outcome.rejected.length;
  if (proto) {
    sendProto(res, 200, protoResponse(signal, rejected, outcome.rejected[0]?.reason ?? ""));
  } else {
    send(res, outcome.accepted > 0 || rejected === 0 ? 200 : 422, {
      accepted: outcome.accepted,
      rejected,
    });
  }
  void record(caller, signal, outcome, body.byteLength);
}

/**
 * One Prometheus remote-write request.
 *
 * Prometheus is not an OTLP sender and must not be answered like one: it reads
 * the status code and nothing else, retries on 5xx, and gives up permanently
 * on 4xx. So a body it cannot use is a 400 it will not retry, and a store that
 * is briefly unavailable is a 503 it will — the write-ahead log holds the
 * samples in the meantime, and answering 500 there loses them.
 */
async function remoteWrite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!telemetryInstalled()) return send(res, 503, { error: { code: "module_not_installed" } });

  const key = keyFromHeaders(req.headers);
  if (!key) return send(res, 401, { error: { code: "missing_key", message: "send x-oi-key" } });
  const caller = await callerFor(key);
  if (!caller) return send(res, 401, { error: { code: "invalid_key" } });
  if (!caller.signals.includes("metrics"))
    return send(res, 403, { error: { code: "signal_not_allowed" } });

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 413, { error: { code: "payload_too_large" } });
  }

  const settings = await settingsFor(caller.tenantId);
  if (!settings.enabledSignals.includes("metrics"))
    return send(res, 403, { error: { code: "signal_disabled" } });

  let outcome: Outcome;
  try {
    const decoded = decodeRemoteWrite(body, remoteWriteVersion(req.headers));
    outcome = await ingestMetrics(caller, settings, decoded);
  } catch (err) {
    // A body we cannot read is the sender's problem and will not be fixed by
    // sending it again; anything else is ours and is worth retrying.
    const ours = !(err instanceof SnappyError || err instanceof RemoteWriteError);
    if (!ours) {
      console.warn(`[telemetry] remote write refused: ${(err as Error).message}`);
      return send(res, 400, { error: { code: "invalid_body", message: (err as Error).message } });
    }
    console.error("[telemetry] remote write failed:", err);
    return send(res, 503, { error: { code: "storage_unavailable" } });
  }

  // 204: Prometheus reads the status and discards the body, and sending one it
  // will not look at is bytes on every request for ever.
  res.writeHead(204).end();
  void record(caller, "metrics", outcome, body.byteLength);
}

/**
 * One profile upload, whichever path it arrived on.
 *
 * The service can be named three ways, and all three are read because all
 * three are what somebody will send: our own `service` parameter, Pyroscope's
 * `name` (which also carries the kind and a label set), and the key's pinned
 * name for a collector that cannot be trusted to say.
 */
async function profiles(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!telemetryInstalled()) return send(res, 503, { error: { code: "module_not_installed" } });

  const key = keyFromHeaders(req.headers);
  if (!key) return send(res, 401, { error: { code: "missing_key", message: "send x-oi-key" } });
  const caller = await callerFor(key);
  if (!caller) return send(res, 401, { error: { code: "invalid_key" } });
  if (!caller.signals.includes("profiles"))
    return send(res, 403, {
      error: { code: "signal_not_allowed", message: "this key may not send profiles" },
    });

  const query = new URL(req.url ?? "/", "http://localhost").searchParams;
  const pyroscope = query.get("name") ? parsePyroscopeName(query.get("name")!) : null;
  const serviceName = query.get("service") ?? pyroscope?.service ?? "";
  const hint = query.get("type") ?? pyroscope?.type;

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 413, { error: { code: "payload_too_large" } });
  }

  const settings = await settingsFor(caller.tenantId);
  if (!settings.enabledSignals.includes("profiles"))
    return send(res, 403, { error: { code: "signal_disabled" } });

  let outcome: Outcome;
  try {
    const decoded = decodePprof(body, hint);
    outcome = await ingestProfiles(
      caller,
      settings,
      {
        serviceName,
        environment:
          query.get("environment") ?? pyroscope?.labels.env ?? pyroscope?.labels.environment ?? "",
        release: query.get("release") ?? pyroscope?.labels.version ?? "",
        labels: pyroscope?.labels ?? {},
      },
      decoded,
    );
  } catch (err) {
    if (err instanceof PprofError) {
      console.warn(`[telemetry] profile refused: ${err.message}`);
      return send(res, 400, { error: { code: "invalid_profile", message: err.message } });
    }
    console.error("[telemetry] profile failed:", err);
    return send(res, 503, { error: { code: "storage_unavailable" } });
  }

  const rejected = outcome.rejected.length;
  // A Pyroscope agent reads the status and nothing else. 200 with a body the
  // others can read costs nothing and tells a person using curl what happened.
  send(res, outcome.accepted > 0 || rejected === 0 ? 200 : 422, {
    accepted: outcome.accepted,
    rejected,
    ...(rejected ? { reason: outcome.rejected[0]?.reason } : {}),
  });
  void record(caller, "profiles", outcome, body.byteLength);
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[telemetry] unhandled:", err);
    if (!res.headersSent) send(res, 500, { error: { code: "internal" } });
  });
}).listen(PORT, () => {
  console.log(
    telemetryInstalled()
      ? `Open Incident telemetry ingestion on :${PORT} — OTLP logs, traces, metrics and profiles, Prometheus remote write`
      : `Open Incident telemetry ingestion on :${PORT} — no storage configured, answering 503`,
  );
});
