---
title: Migrate from Opsgenie
section: configuration
order: 16.5
summary: Seven steps from an Opsgenie account to Open Incident — read with a read-only key, import inactive, prove in shadow mode that the same people would have been paged, switch team by team, archive the history. Opsgenie shuts down on 5 April 2027.
---

Atlassian shuts Opsgenie down on **5 April 2027**. **Settings → Platform → Migrate from Opsgenie** (`/app/settings/migrate`) moves a workspace across without a big bang: everything is read from Opsgenie, created here **inactive**, compared with what Opsgenie actually does for as long as you like, then switched on **one team at a time**, with a one-click rollback until the team confirms.

Two rules hold throughout:

- **Opsgenie is only ever read.** The key you give needs no write right, and the product never sends anything but `GET` requests to Opsgenie.
- **Nothing pages anybody until a team is switched.** The import creates schedules as drafts, policies without a published version, alert sources and rules switched off, heartbeats paused.

The screen is a column of seven steps on the left, with the number of days left before the shutdown at the top. A step you have reached stays open: you can go back to the inventory or the people at any time.

![The migration wizard](img/migrate-switch.png "Seven steps on the left, the countdown to 5 April 2027 at the top, the current step on the right.")

Only administrators who hold the **Platform** permission see the screen.

## 1. Connect

In Opsgenie, open **Settings → App settings → API key management → Add new API key** and tick **Read** and **Configuration Access** — nothing else. Paste the key, choose the region your account lives in (**EU** `api.eu.opsgenie.com` or **US** `api.opsgenie.com`) and press **Check the key**. Four checks run:

| Check                              | What it proves                                                     | When it fails                                                      |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Reach the region                   | The instance can talk to Opsgenie                                  | A firewall or a proxy is in the way                                |
| Read access                        | The key can read alerts                                            | `401`: the key is wrong, or belongs to the other region            |
| Configuration Access               | The key can read users, schedules, policies                        | `403`: tick Configuration Access on the key                        |
| Account-level key (not a team key) | The key sees the whole account (its name and every team are shown) | It is a team's or an integration's key — it only sees its own team |

The key is stored encrypted and never shown again; only its last four characters are. When all four checks pass, **Start the inventory →**.

## 2. Inventory

The account is read in the background — users and their notification rules, teams and their routing rules, schedules with their rotations, overrides and an eight-week timeline, escalations, alert policies, integrations, heartbeats and the size of the alert history. A progress bar follows it; you can close the page, the read carries on.

Eight counters sum it up, and the **Incoming integrations** list classifies each integration by its last alert: **Live** (in the last 7 days), **Quiet** (in the last 90), **No alert in 90 d**. Each line says what it becomes here: a Datadog, Prometheus, Grafana, Sentry, CloudWatch, email or HTTP alert source; an API integration becomes an HTTP source whose callers must replace the GenieKey; a heartbeat becomes a heartbeat monitor that waits for its first ping. Integrations without an alert in 90 days are not imported.

**Read again** reads the account afresh — useful while people keep editing Opsgenie — until a team is switched.

## 3. Match people

Every Opsgenie user is matched to a member **by email**. What remains is a list of conflicts, each to settle in its row:

- **email conflict** — someone with the same name exists here under another email: pick the member, or invite the Opsgenie email.
- **blocked, still scheduled** — the user is blocked in Opsgenie but still holds future slots: hand their slots to a member, or **leave a gap (flagged)** — the import then covers each of their turns with an explicit "nobody" override.
- **not a member** — invite them (the invitation is sent at once) or hand their slots to a member.

**Nothing is imported while a future on-call slot has nobody behind it**: the chip at the top counts those slots until they are all settled.

Below, **Translations to confirm** shows, side by side and on your own data, the four places where the two products count differently:

| Translation                 | Opsgenie                                | Open Incident                                                                                                 |
| --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Escalation delays           | Counted from the alert: 0 · 10 · 25 min | Counted from the previous level: now · +10 · +15 min                                                          |
| Overlapping rotation layers | The last layer wins                     | An explicit order: a working-hours condition ahead of each upper layer in the policies that page the schedule |
| Priority P5                 | Five priorities                         | Four alert severities: P5 becomes the lowest one (P4, low urgency — never wakes)                              |
| Escalation repeat           | Repeat after the last rule, ×N          | A retry node after the last level, N loops                                                                    |

Only the translations your account needs are shown, and each must be confirmed. A routing rule whose only purpose was to tell P5 from P4 cannot be kept: it is not imported, and shadow mode shows what that changes.

## 4. Preview

**What will be created** counts members, teams, schedules, rotations, policies, rules, alert sources and monitors. Then **Who is on call — next 8 weeks, both sides** compares every schedule slot by slot: Opsgenie's side is Opsgenie's own final timeline, Open Incident's side is computed by the product's rotation arithmetic over the converted schedules — the same code that pages people.

A slot that differs is explained, with the fix that applies, one click each:

- the person is invited but has not accepted yet — **Hand to** a member of the same rotation;
- an override in Opsgenie is not in the import — **Read overrides again**;
- the rotation could not be expressed exactly (an hourly rotation, an irregular restriction) — **Copy Opsgenie's slot**.

Fixes are kept with the schedule and become overrides at import. **Import, inactive →** is available at zero differences.

What the import creates, all inactive: one team per Opsgenie team (an existing team of the same name is reused); one schedule per Opsgenie schedule, or one per layer when layers take precedence or a layer is only on some days, with a working-hours set for each such window; one policy per escalation (drafts) and a one-level policy for each rule that paged a schedule directly; one alert source per live or quiet integration, whose own answer is the team's default policy; one rule per non-default routing rule, scoped to the team's sources and placed ahead of the workspace's own rules; one heartbeat per Opsgenie heartbeat.

## 5. Shadow mode

Shadow mode proves the import before anyone depends on it. In Opsgenie, add a **Webhook** integration, tick **Add alert description** and **Add alert details**, and paste the URL the step shows (`https://<workspace>/in/opsgenie/<token>` — it also works on the instance's bare domain). For every new alert Opsgenie forwards, Open Incident works out:

- who **Opsgenie** paged — its routing rule replayed, then the people its schedule had on call at that instant, asked to Opsgenie itself (so an override made since the inventory counts);
- who **Open Incident would have paged** — the imported rules through the product's own matcher, the policy's first level that reaches someone, the imported schedules.

**Nobody is paged by Open Incident**: no escalation is started, no notification written — the **Pages Open Incident sent** figure says so from the database. Four figures, the **Parity by team**, and **Where the two disagreed** follow, each disagreement with its cause and fix:

- an override was created in Opsgenie after the last read — **Read overrides again** reads it, imports it and compares again;
- a rule decided differently (a time window the rules here do not have, a condition that could not be translated) — **Edit the rule** opens it; the comparison runs again when you come back;
- the policy pages someone else — **Edit the policy**.

## 6. Switch teams

A team can be switched once it has no unresolved disagreement. **Switch to Open Incident** reads the team's overrides from Opsgenie once more, then activates exactly what the import created for the team: its schedules (and those its policies page) are published, its policies get a published version, its alert sources, rules and heartbeats are switched on, and the team's policy becomes the imported default when it had none. Opsgenie keeps observing that team.

**Roll back** undoes exactly that, as long as the team has not confirmed — what another switched team still needs stays on.

A switched team shows the checklist of its integrations to repoint, each with what changes in the tool: the webhook URL, the Alertmanager receiver URL, the Grafana contact point, the Sentry alert rule action, the CloudWatch SNS subscription, the GenieKey in API callers, the new email address, the heartbeat's ping URL. The endpoints and secrets are on each source's page under **Alerts → Sources**.

## 7. Archive history

**Archive history →** reads the whole alert history into the workspace, read-only. Opsgenie's search reaches 20 000 alerts at most, so the history is read in date windows (calendar quarters, halved until each holds fewer), a page of 100 at a time, then each alert's details one by one at the pace Opsgenie allows (it waits when Opsgenie answers 429). The cursor is stored after every page: closing the page stops nothing, and an interrupted archive resumes where it stopped.

The alerts land under a switched-off source named **Opsgenie history**, resolved, with their acknowledgement and resolution times and the member who acknowledged them, their service and team as labels, and Opsgenie's details kept as the payload. Insights and Services read them like any other alert. An alert still open in Opsgenie is left there.

**Mark the migration complete** is available once every team is switched and the history is archived. Then disable the Opsgenie integrations — disabling is reversible, deleting is not — and let the account lapse.

## For operators

- The inventory and the archive run in the web process right after you start them, and the worker's `migrate-opsgenie` queue (every 15 seconds, one run at a time) picks up any run whose work was interrupted.
- `OPSGENIE_API_BASE` points both regions at another host (`<base>/eu`, `<base>/us`) — the development stack and the smoke suite use it to talk to a mock. Leave it unset in production.
- Every action is in the audit log: the key saved, the inventory started, the import, each slot fixed, each team switched or rolled back, the archive, the completion.
