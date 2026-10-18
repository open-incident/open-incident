/**
 * GET /api/slack/manifest — the Slack app of this instance, as a manifest:
 * every URL, scope, event and command already in it. "Download the manifest"
 * of Settings › Slack & Teams; the operator creates the app from it once, then
 * sets SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET.
 * Managers only — it holds no secret, but it is an administration document.
 */
import { originFor, isManagerRole } from "@openincident/config";
import { slackAppManifest } from "@openincident/chat";
import { currentMember } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const current = await currentMember();
  if (!current) return new Response("Sign in first.", { status: 401 });
  if (!isManagerRole(current.member)) return new Response("Forbidden", { status: 403 });
  // The one fixed address Slack calls: the bare domain of a multi-workspace
  // deployment (its endpoints find the workspace from the payload), else this host.
  const origin =
    process.env.PUBLIC_ORIGIN ??
    (process.env.BASE_DOMAIN
      ? originFor(process.env.BASE_DOMAIN)
      : requestOrigin({ headers: request.headers, nextUrl: new URL(request.url) }));
  const manifest = slackAppManifest({ origin, name: process.env.SLACK_APP_NAME });
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="open-incident-slack-manifest.json"',
      "cache-control": "no-store",
    },
  });
}
