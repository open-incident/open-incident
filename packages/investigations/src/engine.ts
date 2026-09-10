/**
 * The reasoning, in two model calls and a lot of arithmetic: an analysis that
 * must cite the evidence, an adversarial pass that tries to break each
 * hypothesis, and pure functions that keep only what the evidence supports.
 * The pure parts are what the tests pin down.
 */
import { ask, parseJson, type Completion } from "@openincident/ai";
import type {
  Confidence,
  Finding,
  Hypothesis,
  InvestigationCheckKind,
  InvestigationSummary,
  InvestigationTriage,
} from "@openincident/db";

export const CONFIDENCE_ORDER: readonly Confidence[] = [
  "speculation",
  "plausible",
  "likely",
  "strong",
  "validated",
];

const CHECKS: readonly InvestigationCheckKind[] = [
  "timeline",
  "alerts",
  "changes",
  "similar_incidents",
  "runbooks",
  "ownership",
  "notes",
];

export function confidenceRank(c: Confidence): number {
  return CONFIDENCE_ORDER.indexOf(c);
}

/** One notch less sure, never below speculation. */
export function stepDown(c: Confidence): Confidence {
  return CONFIDENCE_ORDER[Math.max(0, confidenceRank(c) - 1)]!;
}

export type Analysis = {
  triage: InvestigationTriage | null;
  findings: Finding[];
  hypotheses: Hypothesis[];
  blastRadius: string | null;
  whatsGoingOn: string;
};

const str = (v: unknown, max = 600): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const strList = (v: unknown, max: number, each = 300): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim().slice(0, each))
        .slice(0, max)
    : [];
const isConfidence = (v: unknown): v is Confidence =>
  typeof v === "string" && (CONFIDENCE_ORDER as readonly string[]).includes(v);

/** The check a citation id belongs to, from its letter. */
function checkFromCitation(id: string): InvestigationCheckKind {
  switch (id[0]) {
    case "A":
      return "alerts";
    case "C":
      return "changes";
    case "S":
      return "similar_incidents";
    case "R":
      return "runbooks";
    case "O":
      return "ownership";
    case "N":
      return "notes";
    default:
      return "timeline";
  }
}

/** Open and flagged first, the surest first, contradicted last. */
export function rankHypotheses(hyps: Hypothesis[]): Hypothesis[] {
  const stateRank = (s: Hypothesis["state"]) => (s === "contradicted" ? 1 : 0);
  return [...hyps].sort(
    (a, b) =>
      stateRank(a.state) - stateRank(b.state) ||
      confidenceRank(b.confidence) - confidenceRank(a.confidence) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Only what the evidence supports survives: a citation the material does not
 * contain is dropped, a finding left without citations too, and a hypothesis
 * resting on no finding is kept — flagged, as speculation — so the reader
 * sees what the model wanted to say and why it does not count. Confidence
 * cannot exceed what the findings allow: one finding is plausible at most.
 */
export function normaliseAnalysis(raw: unknown, known: Set<string>): Analysis {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const idMap = new Map<string, string>();
  const findings: Finding[] = [];
  (Array.isArray(r.findings) ? r.findings : []).slice(0, 8).forEach((f, i) => {
    if (!f || typeof f !== "object") return;
    const o = f as Record<string, unknown>;
    const statement = str(o.statement, 500);
    const citations = [...new Set(strList(o.citations, 12, 12).filter((c) => known.has(c)))];
    if (!statement || citations.length === 0) return;
    const check = CHECKS.includes(o.check as InvestigationCheckKind)
      ? (o.check as InvestigationCheckKind)
      : checkFromCitation(citations[0]!);
    const id = `F${findings.length + 1}`;
    findings.push({ id, check, statement, citations });
    idMap.set(str(o.id, 20) || `F${i + 1}`, id);
  });

  const hypotheses: Hypothesis[] = [];
  (Array.isArray(r.hypotheses) ? r.hypotheses : []).slice(0, 3).forEach((h) => {
    if (!h || typeof h !== "object") return;
    const o = h as Record<string, unknown>;
    const whatBroke = str(o.whatBroke, 300);
    const why = str(o.why, 800);
    if (!whatBroke) return;
    const supported = [
      ...new Set(
        strList(o.findings, 8, 12)
          .map((id) => idMap.get(id))
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    let confidence: Confidence = isConfidence(o.confidence) ? o.confidence : "speculation";
    let state: Hypothesis["state"] = "open";
    if (supported.length === 0) {
      confidence = "speculation";
      state = "flagged";
    } else if (supported.length === 1 && confidenceRank(confidence) > confidenceRank("plausible")) {
      confidence = "plausible";
    }
    hypotheses.push({
      id: `H${hypotheses.length + 1}`,
      whatBroke,
      why,
      confidence,
      state,
      findings: supported,
      nextSteps: strList(o.nextSteps, 3, 200),
      challenge: null,
      challengeCitations: [],
    });
  });

  const tr =
    r.triage && typeof r.triage === "object" ? (r.triage as Record<string, unknown>) : null;
  const triage: InvestigationTriage | null = tr
    ? {
        severityHint: str(tr.severityHint, 40) || null,
        scope: str(tr.scope, 300),
        escalate: tr.escalate === true,
        rationale: str(tr.rationale, 400),
      }
    : null;
  return {
    triage,
    findings,
    hypotheses: rankHypotheses(hypotheses),
    blastRadius: str(r.blastRadius, 400) || null,
    whatsGoingOn: str(r.whatsGoingOn, 700),
  };
}

/**
 * The reviewer's verdicts applied: a contradiction must cite evidence, or it
 * only weakens; weakened steps the confidence down and flags; contradicted
 * stays visible at the bottom. A hypothesis the reviewer did not mention is
 * left as it was.
 */
export function applyChallenge(hyps: Hypothesis[], raw: unknown, known: Set<string>): Hypothesis[] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const byId = new Map<string, Record<string, unknown>>();
  for (const v of Array.isArray(r.verdicts) ? r.verdicts : []) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const id = str(o.id, 20);
    if (id) byId.set(id, o);
  }
  return rankHypotheses(
    hyps.map((h) => {
      const v = byId.get(h.id);
      if (!v) return h;
      let verdict = str(v.verdict, 20);
      const note = str(v.note, 600) || null;
      const citations = [...new Set(strList(v.citations, 8, 12).filter((c) => known.has(c)))];
      if (verdict === "contradicted" && citations.length === 0) verdict = "weakened";
      if (verdict === "contradicted")
        return {
          ...h,
          state: "contradicted" as const,
          challenge: note,
          challengeCitations: citations,
        };
      if (verdict === "weakened")
        return {
          ...h,
          state: "flagged" as const,
          confidence: stepDown(h.confidence),
          challenge: note,
          challengeCitations: citations,
        };
      return { ...h, challenge: note, challengeCitations: citations };
    }),
  );
}

/** The three blocks a responder reads first, from the surest surviving hypothesis. */
export function composeSummary(
  whatsGoingOn: string,
  hyps: Hypothesis[],
  fallback: string,
): InvestigationSummary {
  const ranked = rankHypotheses(hyps);
  const alive = ranked.filter((h) => h.state !== "contradicted");
  const top = alive[0] ?? null;
  const steps = top?.nextSteps.length
    ? top.nextSteps
    : [...new Set(alive.flatMap((h) => h.nextSteps))].slice(0, 3);
  return {
    whatsGoingOn: whatsGoingOn || fallback,
    whatCaused: top ? `${top.whatBroke} — ${top.why}`.slice(0, 900) : null,
    topHypothesisId: top?.id ?? null,
    nextSteps: steps,
  };
}

const ANALYSE = `TASK: investigate. You are the root cause analyst of this incident. The material below is the evidence; every item is tagged with an id in square brackets. Answer with one JSON object:
{"triage": {"severityHint": string|null, "scope": string, "escalate": boolean, "rationale": string},
 "findings": [{"id": "F1", "check": "timeline"|"alerts"|"changes"|"similar_incidents"|"runbooks"|"ownership"|"notes", "statement": string, "citations": ["A1", "C2"]}],
 "hypotheses": [{"id": "H1", "whatBroke": string, "why": string, "confidence": "speculation"|"plausible"|"likely"|"strong"|"validated", "findings": ["F1"], "nextSteps": [string]}],
 "blastRadius": string,
 "whatsGoingOn": string}
Rules. A finding states one fact and cites at least one evidence id; never cite an id that is not in the material. A hypothesis names what broke and why, and rests only on the findings it lists. Confidence: speculation = no direct evidence; plausible = one supporting finding; likely = several findings converge; strong = they converge and nothing contradicts them; validated = the material confirms it (a fix restored service, a documented cause matches). Order hypotheses from the surest. At most 6 findings and 3 hypotheses. nextSteps are checks or mitigations a responder can do now — imperative, at most 3. whatsGoingOn: two or three sentences on the symptom, who is affected and where things stand. blastRadius: which services, customers or regions are affected as far as the material says. When the material supports no cause, return an empty hypotheses list and say so in whatsGoingOn.`;

const CHALLENGE = `TASK: investigate_challenge. You are the adversarial reviewer of a root cause analysis. Given the evidence (items tagged with ids) and the hypotheses below, try to break each one: evidence that contradicts it, an alternative the same findings fit equally well, timing that does not match. Answer with one JSON object {"verdicts": [{"id": "H1", "verdict": "holds"|"weakened"|"contradicted", "note": string, "citations": ["E3"]}]}. Use "contradicted" only when a cited item is incompatible with the hypothesis; "weakened" when a credible alternative remains unexcluded; "holds" otherwise. One or two sentences per note, citing ids from the material.`;

export async function analyse(text: string): Promise<{ raw: unknown; completion: Completion }> {
  const completion = await ask(ANALYSE, text, { json: true, maxTokens: 1600 });
  return { raw: parseJson<unknown>(completion.text), completion };
}

export async function challenge(
  text: string,
  findings: Finding[],
  hyps: Hypothesis[],
): Promise<{ raw: unknown; completion: Completion }> {
  const material = [
    text,
    "",
    "## Findings of the analysis",
    ...findings.map((f) => `[${f.id}] ${f.statement} (cites ${f.citations.join(", ")})`),
    "",
    "## Hypotheses to challenge",
    ...hyps.map(
      (h) =>
        `[${h.id}] ${h.whatBroke} — ${h.why} (confidence: ${h.confidence}; rests on ${h.findings.join(", ") || "no finding"})`,
    ),
  ].join("\n");
  const completion = await ask(CHALLENGE, material, { json: true, maxTokens: 700 });
  return { raw: parseJson<unknown>(completion.text), completion };
}
