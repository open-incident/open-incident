/**
 * The autonomy ladder and Atlas's policy — pure functions, no I/O, safe in a
 * browser bundle (imported by the web app through `@openincident/investigations/atlas-rules`).
 *
 *   L0 Observe       reads, says nothing unless asked
 *   L1 Investigate   investigates, findings, drafts
 *   L2 Propose       prepares a fix from the allowed actions; one-tap approval
 *   L3 Act & tell    runs reversible actions at once AND pages at the same time
 *   L4 Resolve       resolves end to end, tells afterwards, undo for 24 h
 *
 * A service climbs one level at a time on graded evidence and falls back on
 * its own; an admin can only cap. Everything that decides what Atlas may do
 * with a fix it found is `decidePolicy` — the engine asks it, the screens
 * explain its answer.
 */
import type { AutonomyLevel } from "@openincident/db";

export type { AutonomyLevel };

export type LevelDef = {
  level: AutonomyLevel;
  /** "Observe", "Investigate", "Propose", "Act & tell", "Resolve" — dictionary key atlas.level.<n>.name */
  key: "observe" | "investigate" | "propose" | "act" | "resolve";
  /** Defaults to reach this level from the one below. */
  reach: {
    incidentsSeen?: number;
    gradedRuns?: number;
    rightPct?: number;
    backtestPct?: number;
    proposalsOk?: number;
    l3FixesOk?: number;
    /** No Miss in the last N days. */
    noMissDays?: number;
  };
};

export const LEVELS: readonly LevelDef[] = [
  { level: 0, key: "observe", reach: {} },
  { level: 1, key: "investigate", reach: { incidentsSeen: 5 } },
  { level: 2, key: "propose", reach: { gradedRuns: 10, rightPct: 80 } },
  {
    level: 3,
    key: "act",
    reach: { gradedRuns: 20, rightPct: 90, backtestPct: 85, proposalsOk: 5 },
  },
  {
    level: 4,
    key: "resolve",
    reach: { gradedRuns: 40, rightPct: 95, l3FixesOk: 10, noMissDays: 30 },
  },
] as const;

/** After a fall, the service climbs back only with this many right runs graded since. */
export const RIGHT_RUNS_AFTER_DROP = 5;

/** An admin can only cap: the level that applies is the lower of the two. */
export function effectiveLevel(level: number, cap: number | null | undefined): AutonomyLevel {
  const l = Math.max(0, Math.min(4, level));
  return (cap == null ? l : Math.min(l, Math.max(0, Math.min(4, cap)))) as AutonomyLevel;
}

/** Undo of an autonomous action, or a Miss: one level down. Nowhere near, or a reopen: back to L1. */
export function levelAfter(
  level: number,
  cause: "undo" | "miss" | "nowhere_near" | "reopen",
): AutonomyLevel {
  if (cause === "undo" || cause === "miss") return Math.max(0, level - 1) as AutonomyLevel;
  return Math.min(level, 1) as AutonomyLevel;
}

/** Undo stays possible this long after an autonomous resolution. */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

export type CriterionKey = keyof LevelDef["reach"] | "rightSinceDrop";

export type Criterion = {
  key: CriterionKey;
  target: number;
  current: number | null;
  met: boolean;
};

export type AutonomyRecord = {
  level: number;
  incidentsSeen: number;
  gradedRuns: number;
  rightPct: number | null;
  backtestPct: number | null;
  proposalsOk: number;
  l3FixesOk: number;
  lastMissAt: Date | null;
  /**
   * Right runs graded since the service last went down. Null (or absent):
   * it never went down, and the rule does not apply.
   */
  rightSinceDrop?: number | null;
};

/** What separates a service from the next level — the ✓ / … list of the service card. */
export function nextLevelCriteria(
  row: AutonomyRecord,
  now: number = Date.now(),
): { next: LevelDef | null; criteria: Criterion[] } {
  const next = LEVELS[row.level + 1] ?? null;
  if (!next) return { next: null, criteria: [] };
  const daysSinceMiss = row.lastMissAt ? (now - row.lastMissAt.getTime()) / 86_400_000 : Infinity;
  const values: Record<keyof LevelDef["reach"], number | null> = {
    incidentsSeen: row.incidentsSeen,
    gradedRuns: row.gradedRuns,
    rightPct: row.rightPct,
    backtestPct: row.backtestPct,
    proposalsOk: row.proposalsOk,
    l3FixesOk: row.l3FixesOk,
    noMissDays: Number.isFinite(daysSinceMiss) ? Math.floor(daysSinceMiss) : null,
  };
  const criteria: Criterion[] = (
    Object.entries(next.reach) as Array<[keyof LevelDef["reach"], number]>
  ).map(([key, target]) => {
    const current = values[key];
    const met =
      key === "noMissDays"
        ? current == null || current >= target
        : current != null && current >= target;
    return { key, target, current, met };
  });
  if (row.rightSinceDrop != null)
    criteria.push({
      key: "rightSinceDrop",
      target: RIGHT_RUNS_AFTER_DROP,
      current: row.rightSinceDrop,
      met: row.rightSinceDrop >= RIGHT_RUNS_AFTER_DROP,
    });
  return { next, criteria };
}

/** The level a record has earned one step above where it stands, or null. One step at a time. */
export function promotionDue(row: AutonomyRecord, now: number = Date.now()): AutonomyLevel | null {
  const { next, criteria } = nextLevelCriteria(row, now);
  if (!next || criteria.length === 0) return null;
  return criteria.every((c) => c.met) ? next.level : null;
}

/** 0–1 progress toward the next level: the mean of each criterion's share, capped at 1. */
export function progressToNext(row: AutonomyRecord, now: number = Date.now()): number {
  const { next, criteria } = nextLevelCriteria(row, now);
  if (!next) return 1;
  if (criteria.length === 0) return 0;
  const share = (c: Criterion) =>
    c.met ? 1 : c.current == null || c.target === 0 ? 0 : Math.min(1, c.current / c.target);
  return criteria.reduce((s, c) => s + share(c), 0) / criteria.length;
}

/* ---------- Guardrails and the policy ---------- */

export type GuardrailKey =
  | "sev1"
  | "securityAndPrivate"
  | "firstUseOnService"
  | "changeFreeze"
  | "publicStatusPage"
  | "catalogOnly";

export const GUARDRAILS: readonly GuardrailKey[] = [
  "sev1",
  "securityAndPrivate",
  "firstUseOnService",
  "changeFreeze",
  "publicStatusPage",
  "catalogOnly",
];

export type Guardrails = Record<Exclude<GuardrailKey, "catalogOnly">, boolean> & {
  catalogOnly: true;
};

export const DEFAULT_GUARDRAILS: Guardrails = {
  sev1: true,
  securityAndPrivate: true,
  firstUseOnService: true,
  changeFreeze: true,
  publicStatusPage: true,
  catalogOnly: true,
};

/** A stored set, read defensively: anything absent is on, the last one cannot be off. */
export function readGuardrails(raw: unknown): Guardrails {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const on = (k: keyof Guardrails) => r[k] !== false;
  return {
    sev1: on("sev1"),
    securityAndPrivate: on("securityAndPrivate"),
    firstUseOnService: on("firstUseOnService"),
    changeFreeze: on("changeFreeze"),
    publicStatusPage: on("publicStatusPage"),
    catalogOnly: true,
  };
}

/** The facts about this incident and this fix the guardrails are checked against. */
export type GuardrailFacts = {
  sev1: boolean;
  /** SEV1 already acknowledged by a person — then Atlas may act within its level. */
  acknowledged: boolean;
  securityOrPrivate: boolean;
  firstUseOnService: boolean;
  changeFreeze: boolean;
};

/** Which guardrails stop Atlas from acting alone here — in the order a person reads them. */
export function guardrailHits(g: Guardrails, f: GuardrailFacts): GuardrailKey[] {
  const hits: GuardrailKey[] = [];
  if (g.sev1 && f.sev1 && !f.acknowledged) hits.push("sev1");
  if (g.securityAndPrivate && f.securityOrPrivate) hits.push("securityAndPrivate");
  if (g.firstUseOnService && f.firstUseOnService) hits.push("firstUseOnService");
  if (g.changeFreeze && f.changeFreeze) hits.push("changeFreeze");
  return hits;
}

export type PolicyInput = {
  level: number;
  cap: number | null;
  /** The rule's "✦ Never let Atlas act" / "✦ Let Atlas handle it", or null. */
  directive: "handle" | "never" | null;
  killSwitch: boolean;
  /** The fix: its lowest level to run without a person, and whether it can be undone. */
  action: { minLevel: number; reversible: boolean; enabled: boolean; available: boolean } | null;
  hits: GuardrailKey[];
  /** The adversarial pass on the fix. */
  challenger: "holds" | "weakened" | "contradicted";
};

export type PolicyMode =
  /** Nothing to do with a system: reads, findings, drafts at most. */
  | "observe"
  | "investigate"
  /** A person approves first (L2, a guardrail, a doubt, a fix above the level). */
  | "propose"
  /** L3: run it now and page a person at the same moment. */
  | "act_and_page"
  /** L4: run it, verify, resolve; people are told afterwards. */
  | "act_alone";

export type PolicyReason =
  | "kill_switch"
  | "directive_never"
  | "level"
  | "no_action"
  | "irreversible"
  | "unavailable"
  | "challenger"
  | "guardrail"
  | "action_level";

export type PolicyDecision = {
  mode: PolicyMode;
  effective: AutonomyLevel;
  reasons: PolicyReason[];
};

/**
 * What Atlas may do with the fix it found. The kill switch and a "never" rule
 * stop everything but reading; below L2 nothing is proposed; an irreversible
 * or unavailable action is never run; a guardrail, a doubt from the challenger
 * or a fix whose own level is above the service's turns an action into a
 * proposal. The effective level is min(level, cap).
 */
export function decidePolicy(p: PolicyInput): PolicyDecision {
  const effective = effectiveLevel(p.level, p.cap);
  const base = effective === 0 ? "observe" : "investigate";
  if (p.killSwitch) return { mode: base, effective, reasons: ["kill_switch"] };
  if (p.directive === "never") return { mode: base, effective, reasons: ["directive_never"] };
  if (effective < 2) return { mode: base, effective, reasons: ["level"] };
  if (!p.action) return { mode: base, effective, reasons: ["no_action"] };
  if (!p.action.reversible || !p.action.enabled)
    return { mode: base, effective, reasons: ["irreversible"] };
  if (!p.action.available) return { mode: base, effective, reasons: ["unavailable"] };
  if (p.challenger === "contradicted") return { mode: base, effective, reasons: ["challenger"] };
  const reasons: PolicyReason[] = [];
  if (effective < 3) reasons.push("level");
  if (effective >= 3 && p.action.minLevel > effective) reasons.push("action_level");
  if (p.hits.length > 0) reasons.push("guardrail");
  if (p.challenger === "weakened") reasons.push("challenger");
  if (reasons.length > 0) return { mode: "propose", effective, reasons };
  return { mode: effective >= 4 ? "act_alone" : "act_and_page", effective, reasons: [] };
}

/* ---------- Cost ---------- */

/**
 * Euros for a call, at the instance's prices (AI_PRICE_IN_EUR_PER_MTOK and
 * AI_PRICE_OUT_EUR_PER_MTOK, per million tokens). The defaults are a mid-size
 * hosted model's list price; an operator running their own model sets 0.
 */
export function costOf(
  inputTokens: number,
  outputTokens: number,
  prices: { inPerM: number; outPerM: number },
): number {
  return (inputTokens * prices.inPerM + outputTokens * prices.outPerM) / 1_000_000;
}

export function pricesFromEnv(env: Record<string, string | undefined> = process.env): {
  inPerM: number;
  outPerM: number;
} {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d;
  };
  return {
    inPerM: num(env.AI_PRICE_IN_EUR_PER_MTOK, 2),
    outPerM: num(env.AI_PRICE_OUT_EUR_PER_MTOK, 6),
  };
}

/** Median of a list, null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/* ---------- What a person sees of a fix ---------- */

/** A target the executor will send: letters, digits and a few separators, nothing else. */
export function safeTarget(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || t.length > 120) return null;
  return /^[A-Za-z0-9 ._:/@=+-]+$/.test(t) ? t : null;
}
