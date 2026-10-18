/**
 * The Teams app package's manifest — what the Teams Store reviews and what a
 * team owner sees when adding the app.
 *
 * Its permissions are resource-specific (RSC): granted by the owner of the
 * team the app is added to, for that team only. `Channel.Create.Group` and
 * `ChannelSettings.Read.Group` cover the incident channels; people are read
 * from the bot's roster. Nothing tenant-wide, so no global administrator — the
 * consent screen that kept such apps out of most organisations.
 */
export function teamsAppManifest({
  appId,
  origin,
  version = "1.0.0",
  name = "Open Incident",
  developer,
}: {
  /** The bot's Microsoft Entra application id; also the Teams app id. */
  appId: string;
  /** The product's public origin, for the valid domain and the links. */
  origin: string;
  version?: string;
  name?: string;
  developer: { name: string; websiteUrl: string; privacyUrl: string; termsOfUseUrl: string };
}) {
  const domain = new URL(origin).hostname;
  return {
    $schema:
      "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version,
    id: appId,
    developer,
    name: { short: name, full: `${name} — incident response and on-call` },
    description: {
      short: "Declare and run incidents, and get paged, in Microsoft Teams.",
      full:
        "Open Incident brings incident response into Teams: a channel per incident with a " +
        "living header card, updates and notes mirrored both ways, announcements kept current, " +
        "and on-call pages delivered as personal cards you acknowledge in one click. Pair a team " +
        "with your workspace by typing the code shown in Open Incident. Open source; can be self-hosted.",
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: "#0B4A6F",
    bots: [
      {
        botId: appId,
        scopes: ["team", "personal"],
        supportsFiles: false,
        isNotificationOnly: false,
        commandLists: [
          {
            scopes: ["team"],
            commands: [
              { title: "pair", description: "Pair this team with your workspace: pair <code>" },
              { title: "declare", description: "Declare an incident" },
              { title: "status", description: "The incident of this channel" },
              {
                title: "atlas stop",
                description: "Stop Atlas on this incident (atlas stop all: everywhere)",
              },
              { title: "atlas approve", description: "Approve the fix Atlas proposed" },
              { title: "help", description: "What I can do" },
            ],
          },
          {
            scopes: ["personal"],
            commands: [{ title: "help", description: "What I can do" }],
          },
        ],
      },
    ],
    // "Add to the timeline" on any message of an incident channel — the
    // Teams counterpart of Slack's :pushpin: reaction.
    composeExtensions: [
      {
        botId: appId,
        commands: [
          {
            id: "oi_pin",
            type: "action",
            title: "Add to the timeline",
            description: "Pin this message to the incident's timeline",
            context: ["message"],
            fetchTask: false,
            parameters: [
              {
                name: "note",
                title: "Note",
                description: "Optional — why it matters",
                inputType: "text",
              },
            ],
          },
        ],
      },
    ],
    permissions: ["identity", "messageTeamMembers"],
    validDomains: [domain],
    webApplicationInfo: { id: appId, resource: "https://RscBasedStoreApp" },
    authorization: {
      permissions: {
        resourceSpecific: [
          { name: "Channel.Create.Group", type: "Application" },
          { name: "ChannelSettings.Read.Group", type: "Application" },
        ],
      },
    },
  };
}
