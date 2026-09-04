---
title: Slack
section: integrations
order: 17
summary: One Slack app per instance, one connection per workspace, a channel per incident, commands, reactions, announcements and direct-message paging.
---

## For the operator: the Slack app

Create one Slack app for the instance (api.slack.com → _Create New App_) and give it:

| Feature                 | Setting                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Slash command**       | `/incident`, request URL `https://<any workspace host>/api/slack/commands`                                                                                                                       |
| **Interactivity**       | Request URL `https://<any workspace host>/api/slack/interactions`                                                                                                                                |
| **Event subscriptions** | Request URL `https://<any workspace host>/api/slack/events`; bot events `reaction_added`, `pin_added`                                                                                            |
| **OAuth redirect URL**  | `https://<workspace host>/api/slack/oauth/callback` for each workspace host, or one fixed `SLACK_REDIRECT_URI`                                                                                   |
| **Bot scopes**          | `channels:manage`, `channels:read`, `channels:history`, `chat:write`, `chat:write.public`, `commands`, `pins:write`, `pins:read`, `reactions:read`, `users:read`, `users:read.email`, `im:write` |

Then set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET` on the instance. Without them, the Slack card in **Settings → Integrations** says the instance is not configured.

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
