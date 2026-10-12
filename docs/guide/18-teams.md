---
title: Microsoft Teams
section: integrations
order: 18
summary: One Azure bot per instance, team-scoped consent and no global administrator; each workspace pairs its own team with a code; then the same product gestures as Slack, as Adaptive Cards.
---

## For the operator: the bot

Register one bot for the instance in Azure: an **app registration** (multi-tenant if teams from other organisations will add it) with an **Azure Bot** resource, whose **messaging endpoint** is `<PUBLIC_ORIGIN>/api/teams/messages` — on a multi-workspace deployment the bare domain, which serves it because the workspace is found from the conversation, not from the host. Set `TEAMS_APP_ID` and `TEAMS_APP_SECRET` on the instance. Without them the Teams card says _This instance has no Azure bot registered_.

No Microsoft Graph application permission is needed, and so no global administrator. The app asks for **resource-specific consent**: `Channel.Create.Group` and `ChannelSettings.Read.Group`, granted by the owner of the team the app is added to, for that team only — enough to create the incident channels. People are found through the bot's own roster of the team, not through Graph.

Build the Teams app package — manifest, colour and outline icons — for upload to Teams (**Apps → Manage your apps → Upload an app**) or to Partner Center for the Teams Store:

```bash
TEAMS_APP_ID=<the app registration's id> PUBLIC_ORIGIN=https://oi.example pnpm teams:package
```

## For the administrator: pairing a team

**Settings → Integrations → Microsoft Teams → Configure**:

1. **Pairing** — **Generate a pairing code**: a six-character code valid for a short while. Add the bot to your team in Teams, then type in one of its channels: `@Open Incident pair <code>`. The team is bound to this workspace and nothing else — no OAuth dance, no shared tenant. The screen confirms _Paired with the team « Platform »_.
2. **Configuration** — incident channels (standard channels of the paired team, created through Microsoft Graph, visible to every team member), the announcement channel (the channel the pairing came from, by default).
3. **Test** — **Send a test card** posts a real card in the channel.

## For everyone: Teams during an incident

- A **channel per incident** in the paired team, with a **living header card** (severity, status, lead, next update) and a card for each update and note.
- The **declare**, **update** and **escalate** forms as Adaptive Cards; `lead`, `status` and `help` commands addressed to the bot.
- **Announcements**: one living card per incident in the announcement channel.
- **Direct-message paging**: **Link my Teams account** in **My notifications** finds your user in the paired tenant; a page arrives as a personal card with an **Acknowledge** button.

Inbound activities are verified against the Bot Framework's published keys; outbound calls use the bot's client credentials. Slack and Teams can be connected at once — the product fans out to every chat tool it finds.
