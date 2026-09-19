/**
 * Synthetic monitors — the vocabulary and the limits.
 *
 * A browser weighs 400 MB of image and several hundred megabytes of memory per
 * run, so it does not live in the worker: it lives in `apps/synthetic`, started
 * by its own compose profile, and it takes its work from the `synthetic-run`
 * queue. This module is the piece both sides read — the worker to enqueue, the
 * runner to execute, the web app to write and display a journey — so neither
 * can drift from the other's idea of what a step is.
 *
 * A journey is a LIST, not a script. Eight verbs, each with a selector, a value
 * and a timeout. Three reasons, in the order they matter: a list can be read
 * and diffed in review, it executes nothing arbitrary on our machines, and it
 * gives a time per step — which is what the screens show.
 *
 * This half imports NOTHING. The step editor is a client component, and a
 * single `bullmq` in its import chain would drag Redis and half of Node into a
 * browser bundle. The queue lives next door in `synthetic.ts`, which re-exports
 * everything here so a server-side caller still reads one module.
 */

/**
 * A browser run is expensive: a few hundred megabytes and several seconds of
 * CPU, every time. Five minutes is the floor the product offers — below it an
 * instance spends more on watching than on serving.
 */
export const SYNTHETIC_MIN_INTERVAL_SECONDS = 300;

/** How many journeys one runner plays at once. Each is a Chromium context. */
export const SYNTHETIC_DEFAULT_CONCURRENCY = 2;
export const SYNTHETIC_MAX_CONCURRENCY = 8;

/** A journey long enough to need more than this is a test suite, not a monitor. */
export const SYNTHETIC_MAX_STEPS = 30;
export const SYNTHETIC_DEFAULT_STEP_TIMEOUT_MS = 15_000;
export const SYNTHETIC_MAX_STEP_TIMEOUT_MS = 60_000;
export const SYNTHETIC_DEFAULT_BUDGET_MS = 60_000;
export const SYNTHETIC_MAX_BUDGET_MS = 300_000;

/**
 * The key the runner keeps alive in Redis, and the window it keeps it for.
 *
 * The web app reads this one key to answer "can this instance run a browser?".
 * A TTL rather than a flag: a runner that was killed stops answering within the
 * minute, without anyone having to clean up after it.
 */
export const SYNTHETIC_LIVE_KEY = "oi:synthetic:live";
export const SYNTHETIC_LIVE_TTL_SECONDS = 60;
export const SYNTHETIC_HEARTBEAT_MS = 20_000;

/** What a runner publishes about itself while it is alive. */
export type SyntheticLiveness = {
  /** Playwright version, so a mismatch with the product is visible. */
  version: string;
  concurrency: number;
  startedAt: string;
};

/* ---------- The steps ---------- */

export const SYNTHETIC_STEP_KINDS = [
  "goto",
  "click",
  "fill",
  "select",
  "waitFor",
  "expectText",
  "expectUrl",
  "expectStatus",
] as const;

export type SyntheticStepKind = (typeof SYNTHETIC_STEP_KINDS)[number];

/** The verbs that need a selector, and the ones that need a value. */
const NEEDS_SELECTOR: Record<SyntheticStepKind, boolean> = {
  goto: false,
  click: true,
  fill: true,
  select: true,
  waitFor: true,
  expectText: false,
  expectUrl: false,
  expectStatus: false,
};

const NEEDS_VALUE: Record<SyntheticStepKind, boolean> = {
  goto: true,
  click: false,
  fill: true,
  select: true,
  waitFor: false,
  expectText: true,
  expectUrl: true,
  expectStatus: true,
};

export function stepNeedsSelector(kind: SyntheticStepKind): boolean {
  return NEEDS_SELECTOR[kind];
}

export function stepNeedsValue(kind: SyntheticStepKind): boolean {
  return NEEDS_VALUE[kind];
}

/**
 * One step of a journey.
 *
 * `selector` is a CSS selector or one of Playwright's text engines
 * (`text=Sign in`); `value` is the URL to open, the text to type, the option to
 * choose or the thing to assert. A value may name a credential as
 * `{{secrets.NAME}}` — the runner substitutes it, nothing else ever sees it.
 */
export type SyntheticStep = {
  kind: SyntheticStepKind;
  selector?: string;
  value?: string;
  /** This step's patience. Absent means the default. */
  timeoutMs?: number;
};

/** A journey, as it is stored in `monitors.config`. */
export type SyntheticConfig = {
  steps: SyntheticStep[];
  /** The whole journey's budget: past it the run is cut and reported as such. */
  budgetMs: number;
  viewport: { width: number; height: number };
};

export const SYNTHETIC_DEFAULT_VIEWPORT = { width: 1280, height: 800 };

/* ---------- The result ---------- */

export type SyntheticStepOutcome = "passed" | "failed" | "skipped";

/**
 * What one step did.
 *
 * A step that never ran carries no duration — not a zero, not a dash the reader
 * could mistake for "instant". `durationMs` is absent, and the screens show it
 * absent.
 */
export type SyntheticStepResult = {
  index: number;
  kind: SyntheticStepKind;
  /** What the step was, in one line, for the screens. Never a secret's value. */
  label: string;
  outcome: SyntheticStepOutcome;
  durationMs?: number;
  error?: string;
};

/** The whole run, stored on the check row and read by the monitor's page. */
export type SyntheticRunResult = {
  kind: "synthetic";
  ok: boolean;
  totalMs: number;
  steps: SyntheticStepResult[];
  /** The step that broke, when one did. */
  failedStep?: { index: number; label: string; error: string };
  /** Object-storage key of the screenshot taken on failure, when one was taken. */
  screenshotKey?: string;
  /** Which runner played it, so a fleet is debuggable. */
  runner?: string;
};

/** The shape stored in `monitor_checks.result`. One union member so far. */
export type MonitorCheckResult = SyntheticRunResult;

export function isSyntheticResult(value: unknown): value is SyntheticRunResult {
  return !!value && typeof value === "object" && (value as { kind?: string }).kind === "synthetic";
}

/* ---------- Reading a stored journey back ---------- */

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function parseStep(raw: unknown): SyntheticStep | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = String(r.kind ?? "") as SyntheticStepKind;
  if (!SYNTHETIC_STEP_KINDS.includes(kind)) return null;
  const selector = typeof r.selector === "string" ? r.selector.trim() : "";
  const value = typeof r.value === "string" ? r.value.trim() : "";
  if (NEEDS_SELECTOR[kind] && !selector) return null;
  if (NEEDS_VALUE[kind] && !value) return null;
  const timeout = Number(r.timeoutMs);
  return {
    kind,
    ...(selector ? { selector } : {}),
    ...(value ? { value } : {}),
    ...(Number.isFinite(timeout) && timeout > 0
      ? { timeoutMs: clamp(Math.round(timeout), 500, SYNTHETIC_MAX_STEP_TIMEOUT_MS) }
      : {}),
  };
}

/**
 * Validates a journey coming from a form or from the database.
 *
 * Returns null rather than a half-read journey: a monitor that runs three of
 * the five steps someone wrote is worse than a monitor that refuses to be
 * created.
 */
export function parseSyntheticConfig(raw: unknown): SyntheticConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.steps) ? r.steps : null;
  if (!list || list.length === 0 || list.length > SYNTHETIC_MAX_STEPS) return null;
  const steps: SyntheticStep[] = [];
  for (const item of list) {
    const step = parseStep(item);
    if (!step) return null;
    steps.push(step);
  }
  const budget = Number(r.budgetMs);
  const viewport = (r.viewport ?? {}) as { width?: unknown; height?: unknown };
  const width = Number(viewport.width);
  const height = Number(viewport.height);
  return {
    steps,
    budgetMs: Number.isFinite(budget)
      ? clamp(Math.round(budget), 5_000, SYNTHETIC_MAX_BUDGET_MS)
      : SYNTHETIC_DEFAULT_BUDGET_MS,
    viewport: {
      width: Number.isFinite(width) ? clamp(Math.round(width), 320, 2560) : 1280,
      height: Number.isFinite(height) ? clamp(Math.round(height), 320, 2000) : 800,
    },
  };
}

/** The journey stored on a monitor, or null when the monitor is not one. */
export function syntheticConfigOf(monitor: {
  type: string;
  config: Record<string, unknown>;
}): SyntheticConfig | null {
  if (monitor.type !== "synthetic") return null;
  return parseSyntheticConfig(monitor.config);
}

/* ---------- Secrets, named but never carried ---------- */

const SECRET_REF = /\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g;
const SECRET_REF_ONCE = /\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/;

/** Valid name for a credential — what `{{secrets.NAME}}` may contain. */
export const SYNTHETIC_SECRET_NAME = /^[A-Za-z0-9_]{1,64}$/;

/** The credentials a journey asks for, in the order they first appear. */
export function secretsReferenced(steps: SyntheticStep[]): string[] {
  const names: string[] = [];
  for (const step of steps) {
    for (const match of (step.value ?? "").matchAll(SECRET_REF)) {
      const name = match[1]!;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

export function stepUsesSecret(step: SyntheticStep): boolean {
  return SECRET_REF_ONCE.test(step.value ?? "");
}

/**
 * Replaces `{{secrets.NAME}}` by its value.
 *
 * A name with no credential behind it is left as it is and reported by
 * `missing`: typing the password into the page as the literal text
 * "{{secrets.PASSWORD}}" and failing on the next step would send someone
 * hunting through the site rather than through their own configuration.
 */
export function injectSecrets(
  value: string,
  secrets: Record<string, string>,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = value.replace(SECRET_REF, (whole, name: string) => {
    const secret = secrets[name];
    if (secret === undefined) {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    return secret;
  });
  return { text, missing };
}

/**
 * Removes every credential's value from a string before it is stored, logged or
 * shown. Called on every error message the runner produces: a browser's error
 * quotes what it was given, and what it was given may be a password.
 */
export function redactSecrets(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const value of Object.values(secrets)) {
    if (value.length < 3) continue;
    out = out.split(value).join("••••");
  }
  return out;
}
