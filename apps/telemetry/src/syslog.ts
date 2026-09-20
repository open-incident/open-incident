/**
 * Syslog, which is what everything that is not an application speaks.
 *
 * A load balancer, a firewall, a database, a switch, sshd — none of them will
 * ever carry an OpenTelemetry SDK, and all of them emit syslog. Accepting it
 * is the difference between "the logs of the services somebody instrumented"
 * and "the logs", and during an incident the line that explains everything is
 * as likely to come from the proxy as from the code.
 *
 * Both dialects are read. RFC 5424 is the one with structured data and a real
 * timestamp; RFC 3164 is the one from 1980-something that most hardware still
 * sends, whose date has no year and no timezone. Refusing the second would
 * refuse most of what actually arrives.
 */

export class SyslogError extends Error {}

export type SyslogMessage = {
  /** OTel's severity number, so it sorts beside everything else. */
  severityNumber: number;
  severityText: string;
  facility: string;
  ts: Date;
  host: string;
  /** What syslog calls the tag or app-name; becomes the service. */
  appName: string;
  procId: string;
  msgId: string;
  message: string;
  structured: Record<string, string>;
};

/**
 * Syslog severities are 0 (emergency) to 7 (debug); OTel's are 1 to 24 with
 * four steps per level. Mapped rather than passed through, so a `WARN` from a
 * firewall sorts with a `WARN` from an application — the whole point of having
 * them in one table.
 */
const SEVERITY: Array<[number, string]> = [
  [24, "FATAL"], // 0 emergency
  [23, "FATAL"], // 1 alert
  [22, "FATAL"], // 2 critical
  [17, "ERROR"], // 3 error
  [13, "WARN"], //  4 warning
  [10, "INFO"], //  5 notice
  [9, "INFO"], //   6 informational
  [5, "DEBUG"], //  7 debug
];

const FACILITIES = [
  "kern",
  "user",
  "mail",
  "daemon",
  "auth",
  "syslog",
  "lpr",
  "news",
  "uucp",
  "cron",
  "authpriv",
  "ftp",
  "ntp",
  "audit",
  "alert",
  "clock",
  "local0",
  "local1",
  "local2",
  "local3",
  "local4",
  "local5",
  "local6",
  "local7",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `<134>1 2026-09-20T15:00:00Z host app 123 ID [sd key="v"] message` */
const RFC5424 =
  /^<(\d{1,3})>(\d)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(?:-|(\[.*?\](?:\s*\[.*?\])*))\s*(.*)$/s;

/** `<134>Sep 20 15:00:00 host app[123]: message` */
const RFC3164 = /^<(\d{1,3})>([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)$/s;

export function parseSyslog(line: string, now = new Date()): SyslogMessage {
  const text = line.replace(/\0+$/, "").trim();
  if (!text) throw new SyslogError("empty line");

  const five = RFC5424.exec(text);
  if (five) {
    const [, pri, , stamp, host, app, procId, msgId, sd, message] = five;
    const { severityNumber, severityText, facility } = decodePriority(Number(pri));
    return {
      severityNumber,
      severityText,
      facility,
      ts: parseStamp(stamp!, now),
      host: nil(host),
      appName: nil(app),
      procId: nil(procId),
      msgId: nil(msgId),
      // A BOM is allowed before the message and is not part of it.
      message: (message ?? "").replace(/^\uFEFF/, ""),
      structured: parseStructured(sd),
    };
  }

  const three = RFC3164.exec(text);
  if (three) {
    const [, pri, stamp, host, rest] = three;
    const { severityNumber, severityText, facility } = decodePriority(Number(pri));
    // `app[123]: message`, and every part of it is optional in the wild.
    const tag = /^([^\s:[]+)(?:\[(\d+)\])?:?\s*(.*)$/s.exec(rest ?? "");
    return {
      severityNumber,
      severityText,
      facility,
      ts: parseOldStamp(stamp!, now),
      host: nil(host),
      appName: tag?.[1] ?? "",
      procId: tag?.[2] ?? "",
      msgId: "",
      message: tag?.[3] ?? rest ?? "",
      structured: {},
    };
  }

  // No priority at all. Not refused: plenty of things write bare lines to a
  // syslog socket, and a line without a severity is still a line — it is filed
  // as informational rather than thrown away.
  if (text.startsWith("<")) throw new SyslogError("a priority that is not a number");
  return {
    severityNumber: 9,
    severityText: "INFO",
    facility: "user",
    ts: now,
    host: "",
    appName: "",
    procId: "",
    msgId: "",
    message: text,
    structured: {},
  };
}

function decodePriority(pri: number): {
  severityNumber: number;
  severityText: string;
  facility: string;
} {
  const severity = pri & 7;
  const facility = pri >> 3;
  const [number, text] = SEVERITY[severity] ?? [9, "INFO"];
  return {
    severityNumber: number!,
    severityText: text!,
    facility: FACILITIES[facility] ?? `facility${facility}`,
  };
}

/**
 * RFC 3164's date has no year and no timezone.
 *
 * The year is taken as the current one, except in the days around New Year:
 * a line stamped December read on 1 January belongs to the year before, and
 * without this it lands twelve months in the future where nobody will look.
 */
function parseOldStamp(stamp: string, now: Date): Date {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(stamp);
  if (!m) return now;
  const month = MONTHS.indexOf(m[1]!);
  if (month < 0) return now;
  let year = now.getUTCFullYear();
  if (month === 11 && now.getUTCMonth() === 0) year -= 1;
  if (month === 0 && now.getUTCMonth() === 11) year += 1;
  return new Date(Date.UTC(year, month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])));
}

function parseStamp(stamp: string, now: Date): Date {
  if (stamp === "-") return now;
  const at = Date.parse(stamp);
  return Number.isFinite(at) ? new Date(at) : now;
}

/** `[origin ip="1.2.3.4"][meta x="y"]` into flat key/value pairs. */
function parseStructured(sd: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!sd) return out;
  for (const element of sd.matchAll(/\[([^\s\]]+)((?:\s+[^\s=]+="(?:\\.|[^"\\])*")*)\]/g)) {
    const id = element[1]!;
    for (const pair of (element[2] ?? "").matchAll(/([^\s=]+)="((?:\\.|[^"\\])*)"/g)) {
      // Prefixed by the element id: two elements are free to use the same
      // parameter name and mean different things.
      out[`${id}.${pair[1]}`] = (pair[2] ?? "").replace(/\\(["\\\]])/g, "$1");
    }
  }
  return out;
}

/** Syslog writes a bare `-` where a field is absent. */
function nil(value: string | undefined): string {
  return !value || value === "-" ? "" : value;
}

/**
 * A TCP stream into lines.
 *
 * Two framings, because both are in use and a receiver that knows only one
 * silently mangles the other. RFC 6587 octet counting puts the length in front
 * (`123 <134>1 …`), which is the only framing that survives a message
 * containing a newline; the older way is one message per line.
 */
export function frameSyslog(buffer: Buffer): { lines: string[]; rest: Buffer } {
  const lines: string[] = [];
  let at = 0;

  while (at < buffer.length) {
    // Octet counting: digits, a space, then exactly that many bytes.
    const head = buffer.subarray(at, at + 12).toString("latin1");
    const counted = /^(\d{1,9}) /.exec(head);
    if (counted) {
      const length = Number(counted[1]);
      const start = at + counted[0].length;
      if (start + length > buffer.length) break;
      lines.push(buffer.subarray(start, start + length).toString("utf8"));
      at = start + length;
      continue;
    }
    const newline = buffer.indexOf(0x0a, at);
    if (newline === -1) break;
    const line = buffer.subarray(at, newline).toString("utf8").replace(/\r$/, "");
    if (line.trim()) lines.push(line);
    at = newline + 1;
  }
  return { lines, rest: buffer.subarray(at) };
}
