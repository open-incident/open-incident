---
title: Microsoft Teams
section: integrations
order: 18
summary: One Azure bot per instance, team-scoped consent and no global administrator; each workspace pairs its own team with a code in Settings › Slack & Teams; then the same gestures as Slack, as Adaptive Cards.
---

Teams is configured on the same page as Slack — **Settings › Slack & Teams** — with the same eight sections and the same preview (Teams draws round avatars, a coloured bar on each card and pill buttons). Read the Slack chapter for the sections; this one says what differs.

## For the operator: the bot

Register one bot for the instance in Azure: an **app registration** (multi-tenant if teams from other organisations will add it) with an **Azure Bot** resource, whose **messaging endpoint** is `<PUBLIC_ORIGIN>/api/teams/messages` — on a multi-workspace deployment the bare domain, which serves it because the workspace is found from the conversation, not from the host. Set `TEAMS_APP_ID` and `TEAMS_APP_SECRET` on the instance. Without them the Teams card reads **Unavailable on this instance**, names the two variables, and nothing is sent to Microsoft.

No Microsoft Graph application permission is needed, and so no global administrator. The app asks for **resource-specific consent**: `Channel.Create.Group` and `ChannelSettings.Read.Group`, granted by the owner of the team the app is added to, for that team only — enough to create the incident channels. People are found through the bot's own roster of the team, not through Graph.

The Teams app package — manifest, colour and outline icons — downloads from the pairing step (**Download the app package**), or is built from the command line for Partner Center and the Teams Store:

```bash
TEAMS_APP_ID=<the app registration's id> PUBLIC_ORIGIN=https://oi.example pnpm teams:package
```

## For the administrator: pairing a team

**Settings › Slack & Teams › Connect Microsoft Teams** issues a pairing code and opens a three-step dialog:

1. **Pairing** — the dialog confirms the Azure bot of the instance (its app id). Add the Open Incident app to your team (**Teams › Apps › Manage your apps › Upload an app**, then **Add to a team**), and type in any channel of that team `@Open Incident pair 4K7Q-2M` — the code is valid fifteen minutes, with or without its dash, and binds the team to this workspace and nothing else. **I've typed it** looks for the pairing (the dialog also looks by itself every few seconds); it then reads _Paired with the team « Incidents » — tenant skylark.io_, the domain read from the address of the person who typed the code. An expired code is replaced with **New code**.
2. **Configuration** — incident channels (standard channels of the paired team, created through Microsoft Graph, visible to every member of the team), the prefix, the announcement channel (read from the team), and whether the people of the incident are brought in.
3. **Test** — **Send a test card** posts a real card in the announcement channel (or the channel the pairing came from). **Finish** is greyed until it went through.

**Health › New pairing code** pairs again without disconnecting; **Disconnect** unbinds the team.

## What differs from Slack

- **No invitations.** A standard channel is open to the whole team, so the declarer, the role holders and — when asked — the person on call for the service are **mentioned** in the channel: Teams notifies them. Someone who is not in the team cannot be reached that way; **People** says _not in the team_.
- **Private incidents get no Teams channel**, since every member of the team would see it.
- **Pin the message**: the app's message action **Add to the timeline** (the **…** menu of any message in an incident channel) adds the message to the incident's timeline as a pinned note — the Teams counterpart of Slack's :pushpin: reaction.
- **Commands** are addressed to the bot: `@Open Incident declare`, `update`, `escalate`, `lead @Name`, `status`, `atlas stop` (this incident), `atlas stop all` (everywhere), `atlas approve` (the fix Atlas proposed), `help`.
- **Atlas acted** arrives as a card with **Undo**, **Stop Atlas** and **Open**; update drafts by Atlas as a card with **Publish** and **Edit**.
- **Rules** post alerts to Slack channels only; a Teams channel is not a destination of rules yet, and the section says so.

## For everyone: Teams during an incident

- A **channel per incident** in the paired team, with a **living header card** (severity, status, lead, service) and a card for each update and note.
- The **declare**, **update** and **escalate** forms as Adaptive Cards.
- **Announcements**: one living card per incident in the announcement channel, edited at every change.
- **Direct-message paging**: **Link my Teams account** in **My notifications** finds your user in the paired team; a page arrives as a personal card with an **Acknowledge** button.

Inbound activities are verified against the Bot Framework's published keys; outbound calls use the bot's client credentials. Slack and Teams can be connected at once — the product fans out to every chat tool it finds.
