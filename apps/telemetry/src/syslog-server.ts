/**
 * The syslog listener: a TCP port, and the one thing it must never do.
 *
 * Syslog has no authentication. There is no header to put a key in, no
 * handshake, nothing — a sender opens a socket and writes. So the port itself
 * is the credential, and the only safe design is that **one port belongs to
 * one workspace**: the key is given when the listener is configured, not by
 * whoever connects. An instance serving several workspaces runs several ports,
 * and that is the honest shape rather than a protocol extension nobody else
 * speaks.
 *
 * It is therefore off unless configured. An open syslog port that files
 * everything it receives under whichever workspace happens to be first is the
 * kind of default that is discovered by reading somebody else's logs.
 */
import { createServer, type Socket } from "node:net";
import { createSocket } from "node:dgram";
import type { Caller } from "./auth";
import { callerFor } from "./auth";
import { ingestLogs, type Outcome } from "./ingest";
import { settingsFor } from "./shared";
import type { DecodedLog } from "./otlp";
import { frameSyslog, parseSyslog, type SyslogMessage } from "./syslog";

/** A line longer than this is a sender with a bug, not a log. */
const MAX_LINE = 64 * 1024;
/** How long a connection may hold unframed bytes before they are dropped. */
const MAX_BUFFER = 1024 * 1024;
/** Lines are written in batches: one insert per line would be one round trip per line. */
const FLUSH_EVERY_MS = 1_000;
const FLUSH_AT = 500;

export type SyslogConfig = {
  port: number;
  key: string;
  /** What to file lines under when the sender names no application. */
  fallbackService: string;
};

/**
 * The listener's configuration, from the environment.
 *
 * `OI_SYSLOG_PORT` and `OI_SYSLOG_KEY` together, or nothing. Half of it is a
 * misconfiguration rather than a default: a port with no key cannot resolve a
 * workspace, and a key with no port listens nowhere.
 */
export function syslogConfig(env = process.env): SyslogConfig | null {
  const port = Number(env.OI_SYSLOG_PORT ?? "");
  const key = env.OI_SYSLOG_KEY?.trim();
  if (!port || !key) return null;
  return {
    port,
    key,
    fallbackService: env.OI_SYSLOG_SERVICE?.trim() || "syslog",
  };
}

/** A parsed syslog line into the shape the log pipeline already writes. */
export function toDecodedLog(m: SyslogMessage, fallbackService: string): DecodedLog {
  const at = m.ts.toISOString().replace("T", " ").replace("Z", "");
  return {
    ts: at,
    // When the line was received, beside when the sender says it happened. On
    // syslog the two differ more than anywhere else: half the senders have no
    // timezone in their date and a good number have no working clock.
    observedTs: new Date().toISOString().replace("T", " ").replace("Z", ""),
    scopeName: "syslog",
    // The application name is the service. It is what syslog has that means
    // "which thing wrote this", and filing everything under one name would
    // make the Services screen useless the day a second host connects.
    serviceName: m.appName || fallbackService,
    environment: "",
    severityNumber: m.severityNumber,
    severityText: m.severityText,
    body: m.message,
    traceId: "",
    spanId: "",
    attributes: {
      ...m.structured,
      ...(m.host ? { "host.name": m.host } : {}),
      ...(m.procId ? { "process.pid": m.procId } : {}),
      ...(m.msgId ? { "syslog.msgid": m.msgId } : {}),
      "syslog.facility": m.facility,
    },
    resourceAttributes: {},
  };
}

/**
 * Starts the listener, TCP and UDP both.
 *
 * UDP because that is what a switch or a firewall sends and it cannot be told
 * otherwise; TCP because that is what anything with a choice uses, and it is
 * the only one where a message longer than a datagram survives.
 */
export function startSyslog(config: SyslogConfig): { close: () => Promise<void> } | null {
  let caller: Caller | null = null;
  let pending: SyslogMessage[] = [];
  let timer: NodeJS.Timeout | null = null;

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      caller ??= await callerFor(config.key);
      if (!caller) {
        console.error("[syslog] the configured key does not name a workspace; lines dropped");
        return;
      }
      const settings = await settingsFor(caller.tenantId);
      if (!settings.enabledSignals.includes("logs")) return;
      const outcome: Outcome = await ingestLogs(
        caller,
        settings,
        batch.map((m) => toDecodedLog(m, config.fallbackService)),
      );
      if (outcome.rejected.length) {
        console.warn(
          `[syslog] ${outcome.rejected.length} line(s) refused: ${outcome.rejected[0]?.reason}`,
        );
      }
    } catch (err) {
      // Lines are not put back. A syslog sender does not retry and cannot be
      // asked to, so holding them would grow a queue for ever against a store
      // that is already unhappy.
      console.error("[syslog] write failed:", err instanceof Error ? err.message : err);
    }
  };

  const take = (line: string): void => {
    try {
      pending.push(parseSyslog(line));
    } catch {
      // A line that is not syslog at all. Counted by its absence rather than
      // logged: a malformed sender would otherwise fill our own log with a
      // copy of everything it sends.
      return;
    }
    if (pending.length >= FLUSH_AT) void flush();
  };

  const tcp = createServer((socket: Socket) => {
    let buffer: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_BUFFER) {
        // Nothing framed in a megabyte: this is not a syslog sender.
        socket.destroy();
        return;
      }
      const { lines, rest } = frameSyslog(buffer);
      buffer = Buffer.from(rest);
      for (const line of lines) if (line.length <= MAX_LINE) take(line);
    });
    socket.on("error", () => socket.destroy());
    socket.setTimeout(300_000, () => socket.destroy());
  });

  const udp = createSocket({ type: "udp4", reuseAddr: true });
  udp.on("message", (datagram) => {
    if (datagram.length <= MAX_LINE) take(datagram.toString("utf8"));
  });
  udp.on("error", (err) => console.error("[syslog] udp:", err.message));

  tcp.on("error", (err) => console.error("[syslog] tcp:", err.message));
  tcp.listen(config.port, () =>
    console.log(`Open Incident syslog on :${config.port} (tcp and udp) — one port, one workspace`),
  );
  udp.bind(config.port);

  timer = setInterval(() => void flush(), FLUSH_EVERY_MS);

  return {
    close: async () => {
      if (timer) clearInterval(timer);
      await flush();
      tcp.close();
      udp.close();
    },
  };
}
