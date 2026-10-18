/**
 * Every connected chat tool at once. The product calls these; each provider
 * answers for itself and a workspace without one simply gets nothing back.
 */
import {
  ensureIncidentChannel,
  postAtlasDraftSlack,
  postIncidentNote,
  postIncidentUpdate,
  postInvestigation,
  refreshIncidentHeader,
  syncAnnouncement,
} from "./adapter";
import { investigationText, type InvestigationView } from "./slack/blocks";
import {
  ensureIncidentChannelTeams,
  postAtlasDraftTeams,
  postIncidentNoteTeams,
  postIncidentUpdateTeams,
  postInvestigationTeams,
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

export type InvestigationChatRef = {
  channelId?: string;
  ts?: string;
  /** Older rows: the Teams note was posted once, before it could be updated in place. */
  teamsPosted?: boolean;
  /** The Teams card of the analysis, updated in place. */
  teams?: { threadId: string; activityId: string };
  /** The assessment the last update draft was suggested for — one draft per assessment. */
  draftRun?: number;
};

/**
 * The root cause analysis in every connected chat, one message per tool,
 * updated in place at every assessment. Each tool honours its own "Post the
 * root cause analysis" switch; with "Suggest update drafts" on, Atlas also
 * offers the synthesis as an update draft — once per assessment, labelled,
 * published only by a person. Returns the reference to keep on the
 * investigation row.
 */
export async function postInvestigationAll(
  tenantId: string,
  incidentId: string,
  view: InvestigationView,
  ref: InvestigationChatRef | null,
): Promise<InvestigationChatRef | null> {
  const [slackRef, teamsRef] = await Promise.all([
    quiet(postInvestigation(tenantId, incidentId, view, ref), "slack investigation", null),
    ref?.teamsPosted && !ref.teams
      ? Promise.resolve(null)
      : quiet(
          postInvestigationTeams(tenantId, incidentId, investigationText(view), ref?.teams ?? null),
          "teams investigation",
          null,
        ),
  ]);
  let draftRun = ref?.draftRun;
  if (view.whatsGoingOn && view.runs > (ref?.draftRun ?? 0)) {
    const draft = { reference: view.reference, message: view.whatsGoingOn };
    const posted = await Promise.all([
      quiet(postAtlasDraftSlack(tenantId, incidentId, draft), "slack draft", false),
      quiet(postAtlasDraftTeams(tenantId, incidentId, draft), "teams draft", false),
    ]);
    if (posted.some(Boolean)) draftRun = view.runs;
  }
  const next: InvestigationChatRef = {
    ...(slackRef ?? (ref?.ts ? { channelId: ref.channelId, ts: ref.ts } : {})),
    ...(ref?.teamsPosted ? { teamsPosted: true } : {}),
    ...(teamsRef ? { teams: teamsRef } : ref?.teams ? { teams: ref.teams } : {}),
    ...(draftRun ? { draftRun } : {}),
  };
  return Object.keys(next).length > 0 ? next : null;
}
