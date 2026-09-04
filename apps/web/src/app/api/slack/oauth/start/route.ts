/** Sends an owner/admin to Slack's authorize page, with a signed state naming the workspace. */
import { NextResponse } from "next/server";
import { makeInstallState, slackAuthorizeUrl, slackConfigured } from "@openincident/chat";
import { currentMember } from "@/lib/session";
import { isManagerRole } from "@openincident/config";
import { requestOrigin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const current = await currentMember();
  if (!current || !isManagerRole(current.member)) return new Response("Forbidden", { status: 403 });
  if (!slackConfigured())
    return new Response("Slack is not configured on this instance.", { status: 503 });
  const origin = requestOrigin({ headers: request.headers, nextUrl: new URL(request.url) });
  const redirectUri = process.env.SLACK_REDIRECT_URI || `${origin}/api/slack/oauth/callback`;
  return NextResponse.redirect(
    slackAuthorizeUrl(redirectUri, makeInstallState(current.tenant.id, current.member.id)),
  );
}
