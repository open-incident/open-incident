/**
 * Microsoft Teams — the instance registers ONE Azure bot (app id + secret);
 * each workspace then pairs a Teams team with it from the settings. Base URLs
 * are overridable so the smoke suite can stand in for Microsoft.
 */
export function teamsConfigured(): boolean {
  return Boolean(process.env.TEAMS_APP_ID && process.env.TEAMS_APP_SECRET);
}

export function teamsAppId(): string {
  return process.env.TEAMS_APP_ID ?? "";
}

export function teamsAppSecret(): string {
  return process.env.TEAMS_APP_SECRET ?? "";
}

/** Azure AD login host — token endpoints live under it. */
export function teamsLoginBase(): string {
  return (process.env.TEAMS_LOGIN_BASE ?? "https://login.microsoftonline.com").replace(/\/$/, "");
}

/** Microsoft Graph — channels and users. */
export function teamsGraphBase(): string {
  return (process.env.TEAMS_GRAPH_BASE ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
}

/** Where the Bot Framework publishes the keys that sign inbound activities. */
export function teamsOpenIdConfigUrl(): string {
  return (
    process.env.TEAMS_OPENID_CONFIG ??
    "https://login.botframework.com/v1/.well-known/openidconfiguration"
  );
}

/** Tests only: force every conversation call onto one service URL (the mock). */
export function teamsServiceUrlOverride(): string | null {
  return process.env.TEAMS_SERVICE_URL_OVERRIDE ?? null;
}
