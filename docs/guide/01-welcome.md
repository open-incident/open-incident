---
title: Welcome
section: getting-started
order: 1
summary: What Open Incident is, who this guide is for, and how to read it.
---

Open Incident is an incident management platform: it takes an alert from your monitoring, wakes the right person, gives the team one place to run the incident, tells customers what is happening, and turns what was learnt into follow-ups and a post-mortem. It is open source (the core is AGPL-3.0) and self-hosted; an enterprise edition adds single sign-on, provisioning and custom roles.

This guide is written for three readers:

- **Operators** who install and run an instance — start with [Install and configure](install) and [Operations](operations).
- **Workspace administrators** who shape the product for their organisation — the [Configuration](settings-workspace) chapters and the [Integrations](slack) chapters.
- **Responders and on-call engineers** who use it every day — [Incidents](incidents), [Alerts](alerts), [On-call](on-call).

The [Use cases](use-cases) chapter walks through complete scenarios, from a Datadog alert at 3 a.m. to the post-mortem exported to Confluence. If you learn by example, start there and come back to the reference chapters when a step needs detail.

## How the product is organised

A signed-in member sees a rail on the left with seven sections. Each one is a chapter of this guide.

| Section          | What lives there                                                              | Chapter                                                |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Incidents**    | Declaring, triaging and running incidents; follow-ups; the post-incident flow | [Incidents](incidents), [Post-incident](post-incident) |
| **Alerts**       | What monitoring tools sent, how it was routed, who was paged                  | [Alerts](alerts)                                       |
| **On-call**      | Schedules, overrides, escalation paths, your own notification rules           | [On-call](on-call)                                     |
| **Status pages** | Public or internal pages, components, maintenances, subscribers               | [Status pages](status-pages)                           |
| **Catalog**      | Teams, services, environments and your own types — the spine of the routing   | [Catalog](catalog)                                     |
| **Reports**      | Incidents, alerts, on-call load, follow-ups and on-call pay over a period     | [Reports](reports)                                     |
| **Settings**     | Everything an administrator configures                                        | [Configuration](settings-workspace)                    |

![The incidents list, the first screen after sign-in](img/shell-incidents.png "The shell: top bar with the command palette, the rail on the left, the screen in the middle.")

## Conventions in this guide

- Screen labels are written **in bold**, exactly as they appear in the English interface: **Settings → Alert sources → + New source**. The product is also available in French and German; the labels then follow your language.
- A path like `/app/settings/api` is the address in the browser, relative to your workspace's own address (`https://acme.your-domain.example`).
- `Code` denotes something you type: a command, an environment variable, a JSON body.
- Blockquotes carry notes and warnings:

> A note explains a behaviour that is easy to miss. A warning says what cannot be undone.

## Two principles worth knowing before you start

**Nothing is simulated.** When a capability needs something the instance does not have — an SMS provider, an object storage bucket, an inference provider, an enterprise entitlement — the screen says "unavailable on this instance" and names the variable to set. No button is drawn that does nothing.

**Every change is traced.** Incidents have a timeline; the workspace has an audit log; the catalog, the escalation paths and the status pages version their changes. When something happened, you can find who did it and when.

## The demo workspace

A fresh instance can start with the demo workspace **Skylark Systems** (`SEED_DEMO=true`, the default of `.env.example`): teams, services, an on-call rotation, a reference incident INC-217 with its full history, alerts, a status page. Sign in as `amelie@skylark.dev` with the password `demo-openincident`. Every screenshot of this guide was taken there. Once your own workspace exists, set `SEED_DEMO=false` and remove the demo with the purge command described in [Operations](operations).

## Where else to look

- `README.md` at the root of the repository: the feature list and the three-command install.
- `CHANGELOG.md`: every capability, in the order it landed, with the reasoning behind it.
- `/api/v1/openapi.json` on your instance: the API contract, served by the instance itself.
- `CONTRIBUTING.md`: the development setup and the conventions of the code base.
