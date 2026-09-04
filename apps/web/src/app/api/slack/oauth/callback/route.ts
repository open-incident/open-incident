/**
 * Slack sends the admin back with a code. The state names the workspace; the
 * code becomes a bot token, encrypted at rest; the team id is registered in
 * the directory so callbacks can find their workspace; members are linked to
 * their Slack users by email.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  exchangeOAuthCode,
  linkSlackIdentity,
  readInstallState,
  saveSlackInstall,
  slack,
} from "@openincident/chat";
import { getTenantById, members, registerApiKeyLookup, withTenant } from "@openincident/db";
import { tenantOrigin } from "@openincident/oncall";
import { requestOrigin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = readInstallState(url.searchParams.get("state") ?? "");
  if (!state) return new Response("Invalid or expired state.", { status: 400 });
  const tenant = await getTenantById(state.tenantId);
  if (!tenant) return new Response("Unknown workspace.", { status: 404 });
  const back = `${tenantOrigin(tenant.slug, tenant.customDomain)}/app/settings/integrations`;
  if (!code)
    return NextResponse.redirect(
      `${back}?connect=slack&step=1&error=${encodeURIComponent(url.searchParams.get("error") ?? "denied")}`,
    );
  const origin = requestOrigin({ headers: request.headers, nextUrl: url });
  const redirectUri = process.env.SLACK_REDIRECT_URI || `${origin}/api/slack/oauth/callback`;
  const result = await exchangeOAuthCode(code, redirectUri);
  if ("error" in result)
    return NextResponse.redirect(
      `${back}?connect=slack&step=1&error=${encodeURIComponent(result.error)}`,
    );
  await withTenant(state.tenantId, async (tx) => {
    await saveSlackInstall(tx, state.tenantId, {
      teamId: result.teamId,
      teamName: result.teamName,
      botUserId: result.botUserId,
      accessToken: result.accessToken,
      memberId: state.memberId,
    });
    // Best effort: remember who is who, starting with the active members.
    const api = slack(result.accessToken);
    const rows = await tx
      .select({ id: members.id, email: members.email })
      .from(members)
      .where(and(eq(members.tenantId, state.tenantId), eq(members.status, "active")));
    for (const m of rows.slice(0, 50))
      await linkSlackIdentity(tx, state.tenantId, api, m).catch(() => null);
  });
  await registerApiKeyLookup(`slack:${result.teamId}`, state.tenantId);
  return NextResponse.redirect(`${back}?connect=slack&step=2&authorized=1`);
}
