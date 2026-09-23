/** Sends an owner/admin to Slack's authorize page, with a signed state naming the workspace. */
import { NextResponse } from "next/server";
import {
  makeInstallState,
  pointsAtThisMachine,
  slackAuthorizeUrl,
  slackConfigured,
} from "@openincident/chat";
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
  const authorize = slackAuthorizeUrl(
    redirectUri,
    makeInstallState(current.tenant.id, current.member.id),
  );
  /*
   * Never eject somebody from the product.
   *
   * `SLACK_API_BASE` exists for the test double. Left set on an instance
   * people actually use, this button sent the administrator to
   * `127.0.0.1:3197` and the browser showed its own error page — outside the
   * application, with no way back. Send them to the screen they just left
   * instead, with the reason.
   *
   * The suite that runs against that double says so out loud
   * (`SLACK_ALLOW_LOCAL_ENDPOINT`), because the alternative is guessing which
   * loopback address is a test and which is a mistake — and the whole point of
   * this check is that it cannot tell.
   */
  if (pointsAtThisMachine(authorize) && process.env.SLACK_ALLOW_LOCAL_ENDPOINT !== "1")
    return NextResponse.redirect(
      `${origin}/app/settings/integrations?connect=slack&error=local-endpoint`,
    );
  return NextResponse.redirect(authorize);
}
