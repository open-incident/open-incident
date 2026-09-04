/**
 * Every connected chat tool at once. The product calls these; each provider
 * answers for itself and a workspace without one simply gets nothing back.
 */
import {
  ensureIncidentChannel,
  postIncidentNote,
  postIncidentUpdate,
  refreshIncidentHeader,
  syncAnnouncement,
} from "./adapter";
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
