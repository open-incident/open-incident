/**
 * Root cause analysis (RCA) of an incident, the agentic way: evidence gathered
 * from the incident's own rows and the sources the workspace allows, findings
 * that cite it, hypotheses with an explicit confidence, an adversarial pass
 * that tries to break them, and one synthesis message kept up to date in the
 * incident channel. A person decides; nothing here executes anything.
 */
export { gatherEvidence, type Evidence, type EvidenceItem } from "./evidence";
export {
  CONFIDENCE_ORDER,
  applyChallenge,
  composeSummary,
  confidenceRank,
  normaliseAnalysis,
  rankHypotheses,
  stepDown,
  type Analysis,
} from "./engine";
export {
  INVESTIGATION_QUEUE,
  ensureInvestigationRow,
  runInvestigation,
  type InvestigationJob,
} from "./run";
export { enqueueInvestigation, startInvestigation } from "./queue";
