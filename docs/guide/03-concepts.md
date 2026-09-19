---
title: Concepts
section: getting-started
order: 3
summary: The dozen ideas the whole product is built on — read once, then everything else follows.
---

## Instance, workspace, member

An **instance** is one deployment: one database, one `BASE_DOMAIN`, one set of provider credentials (SMTP, Twilio, Slack app, inference endpoint…). An instance serves one or many **workspaces**.

A **workspace** is an organisation's space: its own members, services, incidents, settings. Each workspace answers on its own subdomain — `acme.your-domain.example` — or on the bare domain when `DEFAULT_TENANT_SLUG` names it. Everything a workspace stores carries its id, and the database enforces the separation with row-level security: the application role cannot read another workspace's rows even by mistake.

A **member** is a person in a workspace, identified by email. Sign-in identities are global to the instance (one account can belong to several workspaces); membership is what a workspace says about that email.

## Roles and permissions

Four built-in roles:

| Role          | What it may do                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**     | Everything, including appointing other owners and importing status page subscribers.                                                                            |
| **Admin**     | Everything in the settings and the product.                                                                                                                     |
| **Responder** | Declare, update and resolve incidents; act on alerts; confirm a service and give it an owner team. Reads the settings' outcome but does not enter the settings. |
| **Viewer**    | Reads everything the workspace shows; acts on nothing.                                                                                                          |

Underneath, the product asks one question everywhere: _may this member do this here?_ The answer comes from a set of ten permissions (respond to incidents, manage on-call, manage each settings area, read the audit log…). The four built-in roles are fixed sets of those permissions. The enterprise edition lets you define [custom roles](custom-roles) as any other set.

## Services, teams, labels

Nothing has to be declared before the routing works. A route says who to page — an escalation path, chosen once — and a fresh workspace pages someone the moment a person clicks **Page me** in **Settings → Alert configuration**.

A **service** is never created by hand: it appears under **Services** the first time a signal names it — a label on an alert, a monitor. Its **key** _is_ its name (`checkout-api`); there is no second field to fill in. It waits in **Seen in traffic** until a member gives it an **owner team**, which confirms it in the same gesture.

A **team** is a row of its own: its members, a chat channel, and the escalation path it is paged through. Teams live in the **Services** area, and the enterprise edition mirrors your identity provider's groups onto them through [provisioning](scim).

That chain is what lets a route page the right people without naming them: bind an alert attribute to the type `service` or `team` and a route can page _the path the named row leads to_ — the service's owner team, or the team itself — with a fallback when the chain does not resolve:

```
alert  →  attribute "service" = checkout-api
       →  service checkout-api, owner = team Payments
       →  team Payments, escalation path = "Payments escalation"
       →  the path pages whoever is on call
```

Change a service's owner and every alert about it follows, on the next event. Nobody had to describe the organisation first.

Everything else an alert used to be described by — environment, region, tier, customer — is now simply a **label** on the alert: a value a route reads and a screen filters on, nothing more. There is no list of environments to declare and no types of your own to design.

## Alert, incident, escalation

Three words that are often confused, and that the product keeps apart on purpose.

- An **alert** is what a monitoring tool sent: one payload, stored raw, deduplicated by key and grouped over a five-minute window. Alerts have a **priority** (P1, P2…) and an **urgency** (high wakes people up, low stays silent). An alert can be acknowledged, snoozed, resolved — by a person or by the source.
- An **escalation** is the act of paging: a path names levels, each level names who gets notified, through which channels, and how long they have to acknowledge before the next level fires. An alert route decides whether an alert escalates, and how. An incident can also be escalated by hand.
- An **incident** is what the team runs: a title, a **severity** (SEV1, SEV2…), a **status** within a lifecycle, roles, updates, a timeline, follow-ups. An alert may open an incident (always, never, or conditionally in triage); a responder may declare one from nothing.

> Severity ≠ priority ≠ urgency. Severity qualifies the incident; priority qualifies the alert; urgency picks the notification channel. A P2 alert can open a SEV1 incident.

## The incident lifecycle

Every incident moves through four **phases**, in this order, and every transition is a timeline event:

| Phase             | Enters when                                                                                                   | Leaves when                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Triage**        | An alert or the API created the incident and the route asked for a conditional incident. Nobody is paged yet. | A responder accepts it (it becomes active), declines it, or merges it into another incident. |
| **Active**        | Declared by a person, accepted from triage, or opened directly by a route.                                    | An explicit update sets a resolving status. Nothing advances silently.                       |
| **Post-incident** | The incident is resolved and its severity asks for the flow (configured per severity).                        | Every task of the flow is done, or skipped with a reason.                                    |
| **Closed**        | The flow is complete, or the incident was resolved without a flow.                                            | Reopening is possible for 30 days.                                                           |

**Statuses** are the workspace's own words inside the active phase (Investigating, Identified, Monitoring…) and are configured per incident type. **Severities** are shared by every type and ordered; each says whether it starts the post-incident flow.

An incident also has a **mode** — live, retrospective (written after the fact) or test (a drill, excluded from reports and from announcements) — and a **visibility**: public to the workspace, or private to role holders and explicit guests.

## Updates, subscribers, publication

A **status update** is the unit of communication: a message, optionally a new status and severity, and the delay before the next update is due. Updates land in the timeline, reach the incident's subscribers, and — only when you tick it — are published on a status page. Announcements can also be posted automatically by rules (see [Response settings](settings-response)).

## Working hours, schedules, paths

**Working hours** are named sets (Mon–Fri 09:00–18:00…) consumed by the conditions of escalation paths. **Schedules** say who is on call when: ordered members, a handover time, overrides for the exceptions. **Escalation paths** say what happens when an alert needs a human: levels, conditions on hours, priority or urgency, delays, retries, hand-overs to another path. Paths are versioned; a running escalation finishes on the version it started with.

## The assistant proposes, never publishes

When an inference provider is configured, an assistant drafts titles, summaries, status updates, follow-ups and post-mortem sections from the incident's own timeline. Every output is labelled **AI DRAFT** and a person reads it before anything is shared. Emails, phone numbers, IPs, hostnames and secrets are redacted before a prompt leaves the instance. What it may do, and which sources it may read, is decided per workspace in **Settings → AI governance**. In the enterprise edition, the **root cause analysis (RCA)** goes further: at declaration it gathers the evidence, states findings that cite it and proposes hypotheses with their confidence, challenged before you read them.

## Where the truth lives

- Incidents, alerts, services, schedules, settings: in your database, under your workspace's id.
- Public status pages: a separate application that reads a snapshot and nothing else, so it keeps answering when the product is down.
- Emails, SMS, pushes, chat messages: written to an outbox with an honest status (queued, sent, delivered, failed) before they leave.
- Exports to Jira, GitHub, Confluence, Notion: copies with a link back; the record here stays the source.
