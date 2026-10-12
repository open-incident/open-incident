---
title: Slack
section: integrations
order: 17
summary: One Slack app per instance, one connection per workspace, a channel per incident, commands, reactions, announcements and direct-message paging.
---

## For the operator: the Slack app

One Slack app serves the whole instance. Generate its manifest — every URL, scope, event and command already in it — and let Slack create the app from it:

```bash
PUBLIC_ORIGIN=https://oi.example pnpm slack:manifest
```

The command prints the manifest and a link that opens Slack's **Create an app** flow with it filled in. `PUBLIC_ORIGIN` is the one fixed address Slack will call; on a multi-workspace deployment it is the bare domain, where the slash command, interactivity, events and OAuth callback are served because they find their workspace from Slack's payload, never from the host. Then set on the instance:

| Variable               | Value                                      |
| ---------------------- | ------------------------------------------ |
| `SLACK_CLIENT_ID`      | from the app's **Basic Information**       |
| `SLACK_CLIENT_SECRET`  | idem                                       |
| `SLACK_SIGNING_SECRET` | idem                                       |
| `SLACK_REDIRECT_URI`   | `<PUBLIC_ORIGIN>/api/slack/oauth/callback` |

Without them, the Slack card in **Settings → Integrations** says the instance is not configured.

To distribute the app beyond one Slack workspace — the published app of a cloud deployment — enable **public distribution** and set the **direct install URL** to `<PUBLIC_ORIGIN>/install/slack`. An installation started from the Slack Marketplace lands there signed out: the page asks for the Open Incident workspace, signs the person in, and continues to Slack's consent screen. The app also handles its own removal: when it is uninstalled from Slack, or its token is revoked, the workspace forgets the token at once, the integration card reads _not connected_, and the audit log records _slack.disconnected_.

## For the administrator: connecting a workspace

**Settings → Integrations → Slack → Configure**, three steps:

1. **Connection** — **Authorize in Slack ↗** opens Slack's consent screen with the minimal scopes; the token is encrypted at rest. The step confirms _Authorized — workspace « acme » connected_.
2. **Configuration** — **Incident channels**: _one channel per incident, created automatically_ or _no channel unless asked from the incident_; a **channel prefix** (`inc-`); an **announcement channel** (or none — announcements stay in the app); whether to **invite the declarer and role holders** to the channel.
3. **Test** — **Send a test message** posts a real message; no fake button. **Finish**.

**Disconnect** revokes the connection; incidents keep their history.

## For everyone: Slack during an incident

### The channel

Each incident gets `#inc-217-checkout-latency` (with automatic channels) or one created from the incident. A **pinned header** is kept current — severity, status, lead, next update due, war-room link. Every update, severity change and role assignment is mirrored; notes and pins from the channel land in the timeline as _Pinned from Slack by …_.

### Commands

| Command                   | Effect                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/incident declare`       | Opens the declaration form as a modal; the incident is created through the same path as the web form. |
| `/incident update`        | The update dialog: status, message, severity, next reminder.                                          |
| `/incident escalate`      | Choose a path and confirm who gets paged.                                                             |
| `/incident lead @someone` | Names the incident lead.                                                                              |
| `/incident status`        | A summary of the incident in the channel.                                                             |
| `/incident help`          | The list above.                                                                                       |

### Reactions

- :pushpin: on a message pins it to the incident's timeline.
- :white_check_mark: on a message turns it into a follow-up.

### Announcements

Rules that publish announcements (**Settings → Announcements**) post a living card in the announcement channel: created when an incident matches, updated at every status update, closed at resolution.

### Direct-message paging

In **On-call → My notifications**, **Link my Slack account** finds your Slack user by email in the connected workspace. From then on a page can reach you as a direct message with an **Acknowledge** button; the step is added at the front of your high-urgency rule.

> A viewer is refused in Slack as in the web: _Viewers cannot declare incidents._ Every gesture in Slack goes through the same write paths and the same role checks as the product.
