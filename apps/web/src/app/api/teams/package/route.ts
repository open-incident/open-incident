/**
 * GET /api/teams/package — the Teams app package of this instance (manifest,
 * colour and outline icons, zipped): "Download the app package" of the
 * pairing step. A team owner uploads it (Apps › Manage your apps › Upload an
 * app) and adds it to the team, then types the pairing code. Needs the bot's
 * app id; managers only.
 */
import { isManagerRole, originFor } from "@openincident/config";
import { colorIcon, outlineIcon, teamsAppId, teamsAppManifest, zip } from "@openincident/chat";
import { currentMember } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const current = await currentMember();
  if (!current) return new Response("Sign in first.", { status: 401 });
  if (!isManagerRole(current.member)) return new Response("Forbidden", { status: 403 });
  const appId = teamsAppId();
  if (!appId)
    return new Response("TEAMS_APP_ID is not set on this instance: there is no bot to package.", {
      status: 503,
    });
  const origin =
    process.env.PUBLIC_ORIGIN ??
    (process.env.BASE_DOMAIN
      ? originFor(process.env.BASE_DOMAIN)
      : requestOrigin({ headers: request.headers, nextUrl: new URL(request.url) }));
  const site = process.env.PUBLIC_SITE_URL ?? origin;
  const manifest = teamsAppManifest({
    appId,
    origin,
    version: process.env.TEAMS_APP_VERSION ?? "1.0.0",
    name: process.env.TEAMS_APP_NAME,
    developer: {
      name: process.env.TEAMS_DEVELOPER_NAME ?? "Open Incident",
      websiteUrl: site,
      privacyUrl: process.env.PRIVACY_URL ?? `${site}/legal/confidentialite`,
      termsOfUseUrl: process.env.TERMS_URL ?? `${site}/legal/conditions`,
    },
  });
  const body = zip([
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: "color.png", data: colorIcon() },
    { name: "outline.png", data: outlineIcon() },
  ]);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="open-incident-teams.zip"',
      "cache-control": "no-store",
    },
  });
}
