/**
 * The shape the rule preview crosses the client boundary in — and nothing else.
 *
 * The evaluation itself lives in `settings-rule-preview.ts`, which reaches for
 * the database and the on-call engine. The editor is a client component: one
 * value imported from that module drags postgres, ioredis and nodemailer into
 * the browser bundle, so the constant and the row types live here, where a
 * client can import them without pulling a server graph behind them.
 */

/** The design's window: the last fifty alerts the workspace received. */
export const PREVIEW_ALERTS = 50;

export type RulePreviewRow = {
  id: string;
  title: string;
  source: string;
  /** ISO — the client formats it. */
  when: string;
  priority: string | null;
  priorityColor: string | null;
  /** The draft catches this alert. */
  matched: boolean;
  /** The draft would decide this alert differently from the rules as they stand. */
  changed: boolean;
  /** What happens today, in words. */
  before: string;
  /** What would happen, in words. */
  after: string;
};

export type RulePreview = { rows: RulePreviewRow[]; matches: number; changes: number };
