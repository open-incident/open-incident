/**
 * "ATLAS ACTED · LEVEL N" in the incident channel (spec delta §13.5, §15.5),
 * with Undo, Stop Atlas and Open. CONTRACT: called by the Atlas engine
 * (atlas-core) after an autonomous action; implemented by the chat module
 * (chat-v2) for Slack and Teams. Resolves quietly when the workspace has no
 * chat installed or the incident has no channel — the journal is the record,
 * the message is a courtesy.
 */
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

export async function postAtlasActed(_msg: AtlasActedMessage): Promise<void> {
  // chat-v2 implements the Slack and Teams posts.
}
