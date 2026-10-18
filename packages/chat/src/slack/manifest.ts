import { SLACK_BOT_SCOPES } from "../install";

/**
 * The Slack app, as a manifest: every URL, scope, event and command the
 * product expects, in the one format Slack accepts to create or update an app.
 *
 * It replaces the twelve-line table operators used to copy by hand, and it is
 * the configuration of the published app on the Cloud. `origin` is the one
 * fixed address the app calls — the bare domain on a multi-workspace
 * deployment, where the middleware lets these endpoints through, since they
 * find their workspace from the payload and never from the host.
 */
export type SlackManifest = ReturnType<typeof slackAppManifest>;

export function slackAppManifest({
  origin,
  name = "Open Incident",
}: {
  origin: string;
  name?: string;
}) {
  const base = origin.replace(/\/$/, "");
  return {
    display_information: {
      name,
      description: "Incident response and on-call, where your team already talks.",
      background_color: "#0b4a6f",
      long_description:
        "Declare and run incidents from Slack: a channel per incident with a living header, " +
        "updates mirrored both ways, pinned messages on the timeline, announcements kept current, " +
        "and on-call pages delivered as direct messages you acknowledge in one click. " +
        "Open Incident is open source and can be self-hosted.",
    },
    features: {
      bot_user: { display_name: name, always_online: true },
      slash_commands: [
        {
          command: "/incident",
          url: `${base}/api/slack/commands`,
          description: "Declare, update and follow incidents",
          usage_hint:
            "declare | update | escalate | lead | status | atlas stop | atlas approve | help",
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      redirect_urls: [`${base}/api/slack/oauth/callback`],
      scopes: { bot: [...SLACK_BOT_SCOPES] },
    },
    settings: {
      event_subscriptions: {
        request_url: `${base}/api/slack/events`,
        bot_events: ["reaction_added", "pin_added", "app_uninstalled", "tokens_revoked"],
      },
      interactivity: { is_enabled: true, request_url: `${base}/api/slack/interactions` },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

/** A link that opens Slack's "create app" flow with the manifest already filled in. */
export function slackManifestCreateUrl(manifest: SlackManifest): string {
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`;
}
