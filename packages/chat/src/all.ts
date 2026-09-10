/**
 * Every connected chat tool at once. The product calls these; each provider
 * answers for itself and a workspace without one simply gets nothing back.
 */
import {
  ensureIncidentChannel,
  postIncidentNote,
  postIncidentUpdate,
  postInvestigation,
  refreshIncidentHeader,
  syncAnnouncement,
} from "./adapter";
import { investigationText, type InvestigationView } from "./slack/blocks";
import {
  ensureIncidentChannelTeams,
  postIncidentNoteTeams,
  postIncidentUpdateTeams,
  refreshIncidentHeaderTeams,
  syncAnnouncementTeams,
} from "./teams/adapter";

const quiet = <T>(p: Promise<T>, label: string, fallback: T): Promise<T> =>
  p.catch((err) => {
    console.error(`[chat] ${label} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  });

export async function ensureIncidentChannels(
  tenantId: string,
  incidentId: string,
  origin: string,
  opts: { force?: boolean } = {},
) {
  const [slack, teams] = await Promise.all([
    quiet(ensureIncidentChannel(tenantId, incidentId, origin, opts), "slack channel", null),
    quiet(ensureIncidentChannelTeams(tenantId, incidentId, origin, opts), "teams channel", null),
  ]);
  return { slack, teams };
}

export async function refreshIncidentHeaders(
  tenantId: string,
  incidentId: string,
  origin: string,
): Promise<void> {
  await Promise.all([
    quiet(refreshIncidentHeader(tenantId, incidentId, origin), "slack header", undefined),
    quiet(refreshIncidentHeaderTeams(tenantId, incidentId, origin), "teams header", undefined),
  ]);
}

export async function postIncidentUpdateAll(
  tenantId: string,
  incidentId: string,
  origin: string,
  update: { by: string; message: string; resolved?: boolean },
): Promise<boolean> {
  const r = await Promise.all([
    quiet(postIncidentUpdate(tenantId, incidentId, origin, update), "slack update", false),
    quiet(postIncidentUpdateTeams(tenantId, incidentId, origin, update), "teams update", false),
  ]);
  return r.some(Boolean);
}

export async function postIncidentNoteAll(
  tenantId: string,
  incidentId: string,
  text: string,
): Promise<boolean> {
  const r = await Promise.all([
    quiet(postIncidentNote(tenantId, incidentId, text), "slack note", false),
    quiet(postIncidentNoteTeams(tenantId, incidentId, text), "teams note", false),
  ]);
  return r.some(Boolean);
}

export async function syncAnnouncementAll(
  tenantId: string,
  announcementId: string,
  origin: string,
): Promise<void> {
  await Promise.all([
    quiet(syncAnnouncement(tenantId, announcementId, origin), "slack announcement", undefined),
    quiet(syncAnnouncementTeams(tenantId, announcementId, origin), "teams announcement", undefined),
  ]);
}

/**
 * The root cause analysis in every connected chat: Slack keeps one message
 * updated in place; Teams gets the synthesis once, as a note, the first time.
 * Returns the reference to keep on the investigation row.
 */
export async function postInvestigationAll(
  tenantId: string,
  incidentId: string,
  view: InvestigationView,
  ref: { channelId?: string; ts?: string; teamsPosted?: boolean } | null,
): Promise<{ channelId?: string; ts?: string; teamsPosted?: boolean } | null> {
  const [slackRef, teams] = await Promise.all([
    quiet(postInvestigation(tenantId, incidentId, view, ref), "slack investigation", null),
    ref?.teamsPosted
      ? Promise.resolve(true)
      : quiet(
          postIncidentNoteTeams(tenantId, incidentId, investigationText(view)),
          "teams investigation",
          false,
        ),
  ]);
  const next = {
    ...(slackRef ?? (ref?.ts ? { channelId: ref.channelId, ts: ref.ts } : {})),
    ...(teams ? { teamsPosted: true } : {}),
  };
  return Object.keys(next).length > 0 ? next : null;
}
