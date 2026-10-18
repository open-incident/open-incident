/**
 * The autonomy ladder (spec delta §15.1) — pure data, safe on both sides.
 *
 * CONTRACT shared by the Atlas engine and every screen that shows a level.
 * Owner: atlas-core. Readers: everyone. Change a name here, not in a screen.
 *
 * The rules themselves live in the engine's package so that the worker, which
 * moves services up and down, and the screens, which explain why, read the
 * same thresholds. This file re-exports them under the names the screens use.
 */
export {
  LEVELS,
  RIGHT_RUNS_AFTER_DROP,
  UNDO_WINDOW_MS,
  effectiveLevel,
  levelAfter,
  nextLevelCriteria,
  progressToNext,
  promotionDue,
  GUARDRAILS,
  DEFAULT_GUARDRAILS,
  readGuardrails,
  decidePolicy,
  type AutonomyLevel,
  type AutonomyRecord,
  type Criterion,
  type CriterionKey,
  type GuardrailKey,
  type Guardrails,
  type LevelDef,
  type PolicyDecision,
  type PolicyMode,
  type PolicyReason,
} from "@openincident/investigations/atlas-rules";
