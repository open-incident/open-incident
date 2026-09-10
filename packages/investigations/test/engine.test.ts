import { describe, expect, it } from "vitest";
import type { Hypothesis } from "@openincident/db";
import {
  applyChallenge,
  composeSummary,
  normaliseAnalysis,
  rankHypotheses,
  stepDown,
} from "../src/engine";

const known = new Set(["E1", "E2", "A1", "C1", "S1"]);

describe("normaliseAnalysis", () => {
  it("keeps only findings that cite evidence the material contains", () => {
    const out = normaliseAnalysis(
      {
        findings: [
          {
            id: "F1",
            check: "changes",
            statement: "A deploy preceded the alert",
            citations: ["C1", "Z9"],
          },
          { id: "F2", check: "alerts", statement: "Made up", citations: ["X1"] },
          { id: "F3", statement: "No citation at all", citations: [] },
        ],
        hypotheses: [],
        whatsGoingOn: "Latency is up.",
      },
      known,
    );
    expect(out.findings).toEqual([
      { id: "F1", check: "changes", statement: "A deploy preceded the alert", citations: ["C1"] },
    ]);
  });

  it("flags a hypothesis that rests on no surviving finding, as speculation", () => {
    const out = normaliseAnalysis(
      {
        findings: [{ id: "F1", check: "alerts", statement: "Errors spiked", citations: ["A1"] }],
        hypotheses: [
          {
            id: "H1",
            whatBroke: "The pool",
            why: "Exhausted",
            confidence: "strong",
            findings: ["F9"],
          },
        ],
      },
      known,
    );
    expect(out.hypotheses[0]).toMatchObject({
      id: "H1",
      confidence: "speculation",
      state: "flagged",
      findings: [],
    });
  });

  it("caps the confidence a single finding can carry at plausible", () => {
    const out = normaliseAnalysis(
      {
        findings: [{ id: "F1", check: "changes", statement: "Deploy at 14:20", citations: ["C1"] }],
        hypotheses: [
          {
            id: "H1",
            whatBroke: "payments-api",
            why: "the deploy",
            confidence: "validated",
            findings: ["F1"],
          },
        ],
      },
      known,
    );
    expect(out.hypotheses[0]!.confidence).toBe("plausible");
    expect(out.hypotheses[0]!.state).toBe("open");
  });

  it("renumbers findings and keeps the hypothesis pointing at the right one", () => {
    const out = normaliseAnalysis(
      {
        findings: [
          { id: "F1", check: "alerts", statement: "Dropped, bad citation", citations: ["Q1"] },
          { id: "F2", check: "changes", statement: "Deploy", citations: ["C1"] },
          { id: "F3", check: "timeline", statement: "Rollback", citations: ["E2"] },
        ],
        hypotheses: [
          { id: "H1", whatBroke: "x", why: "y", confidence: "likely", findings: ["F2", "F3"] },
        ],
      },
      known,
    );
    expect(out.findings.map((f) => f.id)).toEqual(["F1", "F2"]);
    expect(out.hypotheses[0]!.findings).toEqual(["F1", "F2"]);
    expect(out.hypotheses[0]!.confidence).toBe("likely");
  });

  it("survives garbage", () => {
    expect(normaliseAnalysis(null, known).hypotheses).toEqual([]);
    expect(normaliseAnalysis("nope", known).findings).toEqual([]);
  });
});

const h = (
  id: string,
  confidence: Hypothesis["confidence"],
  state: Hypothesis["state"] = "open",
): Hypothesis => ({
  id,
  whatBroke: `broke ${id}`,
  why: `why ${id}`,
  confidence,
  state,
  findings: ["F1", "F2"],
  nextSteps: [`step ${id}`],
  challenge: null,
  challengeCitations: [],
});

describe("applyChallenge", () => {
  it("contradicts only with cited evidence; otherwise it merely weakens", () => {
    const out = applyChallenge(
      [h("H1", "strong"), h("H2", "likely")],
      {
        verdicts: [
          {
            id: "H1",
            verdict: "contradicted",
            note: "The alert predates the deploy",
            citations: ["A1"],
          },
          { id: "H2", verdict: "contradicted", note: "No proof", citations: [] },
        ],
      },
      known,
    );
    const byId = Object.fromEntries(out.map((x) => [x.id, x]));
    expect(byId.H1).toMatchObject({
      state: "contradicted",
      confidence: "strong",
      challengeCitations: ["A1"],
    });
    expect(byId.H2).toMatchObject({ state: "flagged", confidence: "plausible" });
    // Contradicted goes last.
    expect(out.map((x) => x.id)).toEqual(["H2", "H1"]);
  });

  it("leaves a hypothesis the reviewer did not mention untouched", () => {
    const out = applyChallenge([h("H1", "likely")], { verdicts: [] }, known);
    expect(out[0]).toMatchObject({ state: "open", confidence: "likely", challenge: null });
  });

  it("steps down but never below speculation", () => {
    expect(stepDown("speculation")).toBe("speculation");
    expect(stepDown("validated")).toBe("strong");
  });
});

describe("composeSummary", () => {
  it("names the surest surviving hypothesis, skipping contradicted ones", () => {
    const s = composeSummary(
      "Checkout is slow.",
      [h("H1", "validated", "contradicted"), h("H2", "likely"), h("H3", "plausible")],
      "INC-1",
    );
    expect(s.topHypothesisId).toBe("H2");
    expect(s.whatCaused).toBe("broke H2 — why H2");
    expect(s.nextSteps).toEqual(["step H2"]);
  });

  it("says nothing caused it when nothing survives, and falls back to the title", () => {
    const s = composeSummary("", [h("H1", "strong", "contradicted")], "INC-42 — Latency");
    expect(s.whatCaused).toBeNull();
    expect(s.whatsGoingOn).toBe("INC-42 — Latency");
    expect(s.nextSteps).toEqual([]);
  });
});

describe("rankHypotheses", () => {
  it("orders by state, then confidence", () => {
    const out = rankHypotheses([
      h("H1", "plausible"),
      h("H2", "strong", "contradicted"),
      h("H3", "likely"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["H3", "H1", "H2"]);
  });
});
