/**
 * Prints the Slack app manifest for this deployment, and the link that
 * creates the app with it already filled in.
 *
 *   PUBLIC_ORIGIN=https://open-incident.example pnpm slack:manifest
 *
 * PUBLIC_ORIGIN is the one fixed address Slack will call; it defaults to the
 * bare BASE_DOMAIN with the deployment's scheme.
 */
import { originFor } from "@openincident/config";
import { slackAppManifest, slackManifestCreateUrl } from "../src/slack/manifest";

const origin = process.env.PUBLIC_ORIGIN ?? originFor(process.env.BASE_DOMAIN ?? "localhost:3100");
const manifest = slackAppManifest({ origin, name: process.env.SLACK_APP_NAME });
console.log(JSON.stringify(manifest, null, 2));
console.error(`\nCreate the app from this manifest:\n${slackManifestCreateUrl(manifest)}\n`);
console.error(
  "Then set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET and " +
    `SLACK_REDIRECT_URI=${origin}/api/slack/oauth/callback on the instance.`,
);
