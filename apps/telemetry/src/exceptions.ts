/**
 * Turning a stack trace into a group.
 *
 * The same bug fires ten thousand times a day. Shown as ten thousand lines it
 * is noise; shown once with a count and a first-seen it is a bug report. The
 * whole value of this file is the `fingerprint` — the key that makes those ten
 * thousand one — and the whole difficulty is that it must be **stable across
 * occurrences and different between bugs**.
 *
 * §15.4 fixes the recipe: type, plus the message with its variable parts
 * removed, plus the first three in-app frames. Each part earns its place:
 *
 *  - the **type** alone groups far too much (`Error` is not a bug);
 *  - the **raw message** groups far too little — `user 4821 not found` and
 *    `user 9134 not found` are one bug, so numbers, identifiers, paths, URLs
 *    and quoted strings are normalised away;
 *  - the **in-app frames** separate two different callers of the same library
 *    failure, and stopping at three keeps the key stable when the stack below
 *    changes.
 *
 * Frames from `node_modules`, the runtime or the standard library are not
 * in-app: including them would make every dependency upgrade look like a new
 * bug.
 */
import { createHash } from "node:crypto";

export type Frame = {
  function: string;
  file: string;
  line: number;
  col: number;
  in_app: boolean;
};

export type ExceptionEvent = {
  type: string;
  message: string;
  stacktrace: string;
  frames: Frame[];
  fingerprint: string;
  traceId: string;
  spanId: string;
};

const VENDOR =
  /(^|\/)(node_modules|vendor|site-packages|dist-packages|\.cargo|go\/pkg\/mod|usr\/lib|usr\/local\/lib)\//;

/** A frame is ours unless it obviously belongs to somebody else's code. */
export function isInApp(file: string): boolean {
  if (!file) return false;
  if (VENDOR.test(file)) return false;
  if (file.startsWith("node:") || file.startsWith("internal/")) return false;
  if (/^<.*>$/.test(file)) return false;
  return true;
}

/**
 * The message, with everything that varies between occurrences taken out.
 *
 * Order matters: URLs and paths before numbers, or the digits inside a path
 * are replaced first and the path stops looking like one.
 */
export function normaliseMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s'"]+/g, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/(^|\s)(\/[^\s'":]+)+/g, "$1<path>")
    .replace(/'[^']*'|"[^"]*"/g, "<str>")
    .replace(/\b\d[\d_.,]*\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Node, Python, Java, Go — four spellings of the same three facts. */
const FRAME_PATTERNS: RegExp[] = [
  // Node / V8:  at fn (/app/src/checkout.ts:42:13)
  /^\s*at\s+(?<fn>[^(]+?)\s*\((?<file>[^)]+?):(?<line>\d+):(?<col>\d+)\)/,
  /^\s*at\s+(?<file2>[^\s()]+?):(?<line2>\d+):(?<col2>\d+)/,
  // Python:  File "/app/checkout.py", line 42, in charge
  /^\s*File\s+"(?<pfile>[^"]+)",\s+line\s+(?<pline>\d+),\s+in\s+(?<pfn>\S+)/,
  // Java:  at com.acme.Checkout.charge(Checkout.java:42)
  /^\s*at\s+(?<jfn>[\w.$]+)\((?<jfile>[^:)]+):(?<jline>\d+)\)/,
];

export function parseFrames(stacktrace: string): Frame[] {
  const out: Frame[] = [];
  for (const raw of stacktrace.split("\n")) {
    for (const re of FRAME_PATTERNS) {
      const m = re.exec(raw);
      if (!m?.groups) continue;
      const g = m.groups;
      const file = g.file ?? g.file2 ?? g.pfile ?? g.jfile ?? "";
      out.push({
        function: (g.fn ?? g.pfn ?? g.jfn ?? "").trim() || "<anonymous>",
        file,
        line: Number(g.line ?? g.line2 ?? g.pline ?? g.jline ?? 0),
        col: Number(g.col ?? g.col2 ?? 0),
        in_app: isInApp(file),
      });
      break;
    }
    if (out.length >= 64) break;
  }
  return out;
}

export function fingerprintOf(type: string, message: string, frames: Frame[]): string {
  const inApp = frames.filter((f) => f.in_app).slice(0, 3);
  // Falling back to the first three frames of any kind rather than to nothing:
  // a stack entirely inside a dependency is still one bug, not all of them.
  const chosen = inApp.length > 0 ? inApp : frames.slice(0, 3);
  const key = [
    type,
    normaliseMessage(message),
    ...chosen.map((f) => `${f.function}@${f.file}:${f.line}`),
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/** Anything that looks like a stack trace, for a log that carries one unlabelled. */
const LOOKS_LIKE_STACK = /\n\s*(at\s+\S|File\s+"|Traceback\s)/;

export function exceptionFromAttributes(
  attributes: Record<string, string>,
  fallbackBody: string,
  ids: { traceId: string; spanId: string },
): ExceptionEvent | null {
  const type = attributes["exception.type"] ?? "";
  const message = attributes["exception.message"] ?? "";
  const stacktrace = attributes["exception.stacktrace"] ?? "";

  // Either the semantic attributes say so, or the body plainly is one. The
  // second case is what catches a logger that writes `err.stack` and nothing
  // else, which is most of them.
  const hasSemconv = Boolean(type || message || stacktrace);
  const looksLike = !hasSemconv && LOOKS_LIKE_STACK.test(fallbackBody);
  if (!hasSemconv && !looksLike) return null;

  const trace = stacktrace || (looksLike ? fallbackBody : "");
  const frames = parseFrames(trace);
  const firstLine = (trace.split("\n")[0] ?? "").trim();
  const resolvedType = type || guessType(firstLine) || "Error";
  // `*` and not `+`: the type is often the whole prefix (`Error: …`), and a
  // quantifier demanding at least one character before it never matches.
  const resolvedMessage =
    message ||
    firstLine.replace(/^[\w.$]*(?:Error|Exception)\s*:\s*/, "") ||
    fallbackBody.slice(0, 300);

  return {
    type: resolvedType,
    message: resolvedMessage,
    stacktrace: trace.slice(0, 16_000),
    frames,
    fingerprint: fingerprintOf(resolvedType, resolvedMessage, frames),
    traceId: ids.traceId,
    spanId: ids.spanId,
  };
}

function guessType(firstLine: string): string {
  const m = /^([\w.$]*(?:Error|Exception))\b/.exec(firstLine);
  return m?.[1] ?? "";
}
