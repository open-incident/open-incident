/**
 * Builds the Teams app package — manifest.json, color.png, outline.png in a
 * zip — for upload to Teams (Apps → Manage your apps → Upload) or to Partner
 * Center for the Teams Store.
 *
 *   TEAMS_APP_ID=<entra app id> PUBLIC_ORIGIN=https://open-incident.example \
 *     pnpm teams:package [out.zip]
 */
import { writeFileSync } from "node:fs";
import { originFor } from "@openincident/config";
import { colorIcon, outlineIcon, zip } from "../src/package-files";
import { teamsAppManifest } from "../src/teams/manifest";

const appId = process.env.TEAMS_APP_ID;
if (!appId || !/^[0-9a-f-]{36}$/i.test(appId)) {
  console.error("TEAMS_APP_ID must be the bot's Microsoft Entra application id (a GUID).");
  process.exit(1);
}
const origin = process.env.PUBLIC_ORIGIN ?? originFor(process.env.BASE_DOMAIN ?? "localhost:3100");
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
const out = process.argv[2] ?? "open-incident-teams.zip";
writeFileSync(
  out,
  zip([
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: "color.png", data: colorIcon() },
    { name: "outline.png", data: outlineIcon() },
  ]),
);
console.error(`Wrote ${out} for ${origin} (app ${appId}).`);
