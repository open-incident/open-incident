/**
 * "ATLAS ACTED · LEVEL N" in the incident channel (spec delta §13.5, §15.5),
 * with Undo, Stop Atlas and Open. CONTRACT: called by the Atlas engine
 * (atlas-core) after an autonomous action; implemented here for Slack and
 * Teams. Resolves quietly when the workspace has no chat installed or the
 * incident has no channel — the journal is the record, the message is a
 * courtesy.
 *
 * Undo and Stop Atlas are interactive buttons, not links: the chat tool says
 * who clicked, the handler matches them to a member, checks they may respond,
 * and calls the same functions as the web (lib/atlas/control). A clicker the
 * product cannot match is told so and nothing happens. `urls.undo` and
 * `urls.stop` stay in the contract for surfaces that cannot authenticate the
 * clicker (a mobile notification); the channel does not need them.
 */
import { postAtlasActedSlack } from "./adapter";
import { postAtlasActedTeams } from "./teams/adapter";

export type AtlasActedMessage = {
  tenantId: string;
  incidentId: string;
  actionId: string;
  level: number;
  title: string;
  detail?: string | null;
  reversible: boolean;
  /** Absolute URLs: signed where the chat cannot authenticate the clicker. */
  urls: { open: string; undo?: string; stop: string };
};

const quietly = (p: Promise<boolean>, label: string) =>
  p.catch((err) => {
    console.error(
      `[chat] atlas acted (${label}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  });

/** Posts to every incident channel the incident has; true when at least one tool was told. */
export async function postAtlasActed(msg: AtlasActedMessage): Promise<boolean> {
  const view = {
    level: msg.level,
    title: msg.title,
    detail: msg.detail ?? null,
    reversible: msg.reversible,
    actionId: msg.actionId,
    incidentId: msg.incidentId,
    openUrl: msg.urls.open,
  };
  const told = await Promise.all([
    quietly(postAtlasActedSlack(msg.tenantId, view), "slack"),
    quietly(postAtlasActedTeams(msg.tenantId, view), "teams"),
  ]);
  return told.some(Boolean);
}
