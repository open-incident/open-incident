---
title: Slack
section: integrations
order: 17
summary: One Slack app per instance, one connection per workspace in Settings › Slack & Teams; a channel per incident, commands, reactions, announcements, direct-message paging and Atlas in the channel.
---

Slack and Microsoft Teams share one settings page: **Settings › Slack & Teams**. The two tools sit side by side — each card says whether it is connected, which workspace, who installed it and when, and three figures read from the real records: the incident channels of the last 90 days, the members linked, the last event (a pin, an update, the test). Below the cards, the selected tool's eight sections, and on the right **What people see**: the messages each section makes Slack show, filled with the workspace's own latest incident, alert and Atlas action, following every setting as you change it.

A workspace can run Slack and Teams at once: each incident then gets a channel in both, and the same gestures work in both.

## For the operator: the Slack app

One Slack app serves the whole instance. Generate its manifest — every URL, scope, event and command already in it — and let Slack create the app from it:

```bash
PUBLIC_ORIGIN=https://oi.example pnpm slack:manifest
```

The same manifest downloads from the page itself (**Download the manifest**, administrators only). The command prints a link that opens Slack's **Create an app** flow with it filled in. `PUBLIC_ORIGIN` is the one fixed address Slack will call; on a multi-workspace deployment it is the bare domain, where the slash command, interactivity, events and OAuth callback are served because they find their workspace from Slack's payload, never from the host. Then set on the instance:

| Variable               | Value                                      |
| ---------------------- | ------------------------------------------ |
| `SLACK_CLIENT_ID`      | from the app's **Basic Information**       |
| `SLACK_CLIENT_SECRET`  | idem                                       |
| `SLACK_SIGNING_SECRET` | idem                                       |
| `SLACK_REDIRECT_URI`   | `<PUBLIC_ORIGIN>/api/slack/oauth/callback` |

Without them, the Slack card reads **Unavailable on this instance** and names the variables; there is no Connect button to press. A workspace that was connected before the variables were removed keeps its card, with a warning: messages still go out with the stored token, but Slack can no longer reach Open Incident — commands, buttons and reactions are refused — and the app cannot be reinstalled.

To distribute the app beyond one Slack workspace — the published app of a cloud deployment — enable **public distribution** and set the **direct install URL** to `<PUBLIC_ORIGIN>/install/slack`. An installation started from the Slack Marketplace lands there signed out: the page asks for the Open Incident workspace, signs the person in, and continues to Slack's consent screen. The app also handles its own removal: when it is uninstalled from Slack, or its token is revoked, the workspace forgets the token at once, the card reads _Not connected_, and the audit log records _slack.disconnected_.

## For the administrator: connecting a workspace

**Settings › Slack & Teams › Connect Slack** opens a three-step dialog:

1. **Connection** — **Authorize in Slack ↗** opens Slack's consent screen with the minimal scopes: create and read channels, post messages, pin, read reactions, look members up by email. The token is encrypted at rest. Back from Slack, the step reads _Authorized — workspace « acme » connected_, and the members whose email Slack knows are linked at once.
2. **Configuration** — **Incident channels**: _one per incident, automatically_ or _only when asked_ (from the incident page); the **channel prefix** (`inc-`, previewed as the next incident's channel); the **announcement channel**, read from the Slack workspace (or none — announcements stay in the app); whether to **invite the declarer and role holders**.
3. **Test** — **Send a test message** posts a real message in the announcement channel, or to you as a direct message when there is none. **Finish** is greyed until the test went through.

Right after, the card shows a fresh connection: _installed by you · just now_, no incident channel yet, the test as the last event.

## The eight sections

| Section                  | What it decides                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incident channels**    | When a channel is created (every incident, or when asked), its name, whether the declarer and role holders are invited, whether **the person on call for the service** is invited too — the first level of the owning team's policy, resolved now. The pinned header is kept current and edited in place. A private incident gets no channel: Slack's incident channels are public. |
| **Announcement channel** | Where the living announcement goes — one message per incident, edited at every change. Who hears about which incident is decided by the rules of **Settings › Announcements**, shared by Slack and Teams.                                                                                                                                                                           |
| **Pages in chat**        | Whether Slack is offered as a notification method. The list shows the members whose high-urgency rule pages them in Slack, at which step, and whether they can be reached; **Link by hand** picks the Slack account of someone no account matches by email. Turned off, a page that reaches a Slack step fails at once and the member's next step follows.                          |
| **Alerts in channels**   | The rules that post their alerts to a channel, with the alerts of the last seven days. One message per alert; its resolution edits the same message.                                                                                                                                                                                                                                |
| **Atlas in the channel** | Whether the root cause analysis is posted in the incident channel (updated in place at every assessment), and whether Atlas suggests **update drafts** — labelled _draft · Atlas_, published only when a person clicks **Publish** (or **Edit** to change it first).                                                                                                                |
| **Commands**             | What the slash command does — see below.                                                                                                                                                                                                                                                                                                                                            |
| **People**               | Who is linked to a Slack account — matched by email the first time they act, remembered after; a member Slack does not know reads _no Slack account for …_, and **Link** tries the email again or lets you pick the account.                                                                                                                                                        |
| **Health**               | The chat outbox: the last messages sent, each _delivered_ or with the error Slack answered (`user_disabled`, `not_in_channel`…). **Send a test message**, **Reinstall the app** (back through Slack's consent screen, every setting kept), **Disconnect** (click twice; channels stay in Slack, Open Incident stops posting).                                                       |

Every switch saves at once and says so; every change has its line in the audit log.

## For everyone: Slack during an incident

### The channel

Each incident gets `#inc-217` (with automatic channels) or one created from the incident. A **pinned header** is kept current — severity, status, lead, service, war-room link — and edited in place, never reposted. Every update is mirrored; notes and pins from the channel land in the timeline as _Pinned from Slack by …_.

### Commands

| Command                    | Effect                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/incident declare`        | Opens the declaration form as a modal; the incident is created through the same path as the web form.                   |
| `/incident update`         | The update dialog: status, message, severity. `/incident update <message>` publishes at once in the current status.     |
| `/incident escalate`       | Choose a path and confirm who gets paged.                                                                               |
| `/incident lead @someone`  | Names the incident lead.                                                                                                |
| `/incident atlas stop`     | Stops Atlas on this incident: it proposes and acts no more there, and the proposals still waiting are withdrawn.        |
| `/incident atlas stop all` | Stops Atlas everywhere — the kill switch; an admin resumes it in **Settings › Atlas**.                                  |
| `/incident atlas approve`  | Approves the fix Atlas proposed on this incident (services at level 2). If it cannot run, you are told and nothing ran. |
| `/incident status`         | A summary of the incident in the channel.                                                                               |
| `/incident help`           | The list above.                                                                                                         |

Every command goes through the same paths as the web: the same permissions (a viewer can neither declare nor stop Atlas), the same timeline events.

### Reactions

- :pushpin: on a message pins it to the incident's timeline.
- :white_check_mark: on a message turns it into a follow-up.

### Atlas in the channel

When Atlas acts on its own — at level 3 and above, and only through the allowed actions of **Settings › Atlas** — it says so in the incident channel at the same moment: **ATLAS ACTED · LEVEL 3**, what it did, with **Undo** (when the action is reversible), **Stop Atlas** and **Open**. Undo and Stop are the web's own gestures: the clicker is matched to a member and checked like any responder, and the channel reads who undid or stopped.

### Announcements

Rules that publish announcements (**Settings › Announcements**) post a living message in the announcement channel: created when an incident matches, edited at every status update, closed at resolution.

### Direct-message paging

In **On-call › My notifications**, **Link my Slack account** finds your Slack user by email in the connected workspace. From then on a page can reach you as a direct message with an **Acknowledge** button; the acknowledgement goes through the same path as the phone or the signed link, and the message turns into its acknowledged form. Health shows it as _Page to … — acknowledged from chat 21:59_.

> Someone Slack cannot match to a member is answered _Who are you in Open Incident?_ — an admin links their account once in **People**; after that their commands and acknowledgements count as theirs.
