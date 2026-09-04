---
title: Microsoft Teams
section: integrations
order: 18
summary: One Azure bot per instance; each workspace pairs its own team with a code; then the same product gestures as Slack, as Adaptive Cards.
---

## For the operator: the bot

Register one bot for the instance in Azure (an app registration with a bot resource) and grant the Microsoft Graph **application** permissions `Channel.Create`, `Channel.ReadBasic.All`, `User.Read.All` (admin consent). Set `TEAMS_APP_ID` and `TEAMS_APP_SECRET` on the instance. The bot's **messaging endpoint** is `https://<any workspace host>/api/teams/messages` — any workspace host works, because the team pairs itself with a code afterwards.

Without the two variables the Teams card says _This instance has no Azure bot registered_.

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
