---
title: Alerting settings
section: configuration
order: 15
summary: Alert configuration in four steps; sources with their page, attributes, priorities, routes, heartbeats — the Alerting group of the settings.
---

## Alert configuration

**Settings → Alert configuration** is the one screen that says where the alerting stands, and gets a workspace from nothing to "an alert paged someone" in four steps. Each step is real; nothing is simulated.

1. **Decide who gets paged.** **Page me** creates a published escalation path that pages you — one level, five minutes to acknowledge, two retries — and names it on the route that catches every alert. **Page whoever is on call…** does the same for a schedule, **Page someone…** for a colleague, **Use an existing path…** for one you built. Refine it later in **On-call → Paths**.
2. **Connect an alert source.** The tool grid, a name, then the endpoint and the secret shown once.
3. **Receive a first alert.** **Test** sends a real alert through the whole pipeline in test mode; or send one from the tool — the source page waits for it live.
4. **Check that an alert paged someone.** The step turns green when an alert started an escalation.

Under the steps: tiles for sources, routes, paths, priorities and attributes; the sources with their last day (alerts, firing) and their last alert; the routes in order, each in one line — _when_ and _then_.

No catalog is required. Every new workspace starts with three priorities (P1–P3 with the usual aliases), five attributes (service, team, environment, region, the tool's severity) and one route — **Every alert** — that catches everything and opens a triage incident when the priority pages. Name who to page and it is live.

## Alert sources

![Alert sources](img/settings-alert-sources.png "One row per source with its mark, its last day, its last alert, and the way to its page.")

One source = one dedicated endpoint + one secret compared in constant time. **+ New source** picks the **tool** in a grid (Datadog, Prometheus/Alertmanager, Grafana, Sentry, CloudWatch, Uptime Kuma; **HTTP** for anything that can post JSON), a name, and shows the endpoint and the secret once. Only the secret's SHA-256 is stored; **Rotate the secret** on the source page gives a new one, shown once, and the old one stops working at once. The secret travels as the `x-oi-secret` header or the `?secret=` query parameter.

### The source page

Each source has a page — **Configure** — with everything about it:

- **Connect the tool**: the endpoint, the secret, the steps for this kind of tool, a `curl` command that sends a first alert, and a line that waits for it and turns green when alerts arrive.
- **Attributes**: how this source's payload becomes the workspace's attributes. One row per attribute: the payload field (picked from the fields of a real alert the source sent, or a fixed value), a light transform (lower case, after the colon, first word…), an optional guard (keep the value only if it matches a regular expression), and the value that comes out of the chosen sample. **Suggest from the payload** proposes fields for the attributes not yet mapped, from the names tools usually use. Required attributes the source does not map are flagged.
- **Priority**: none (the payload's own label, else the default), always the same, or from a field with a value map — `critical → P1` — and a fallback. Labels not listed still match a priority by its name or aliases.
- **Filter incoming alerts**: only alerts matching the conditions are ingested; resolutions always pass, so nothing stays firing forever.
- **Preview and test**: paste a payload and read what the pipeline would do — attributes, priority, the route that catches it, who it pages, the incident it opens, the group it would join — then **Send as a test alert** (routed, nobody paged) or **Send for real**.
- The **routes** reading this source, in order.

### Per tool

| Tool                          | In the tool                                                                                                                                                      | How the payload is read                                                                                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Datadog**                   | Integrations → Webhooks: a webhook with the endpoint URL and a custom header `x-oi-secret`; attach it to the monitors' notifications (`@webhook-open-incident`). | Title from `title` / `event_title`, body from `body`; the monitor's `scope` (`env:prod,service:checkout-api`) becomes attributes (`env` → `environment`); `priority` kept; deduplicated by `monitor_id` (or `alert_id`); a _Recovered_ / _OK_ transition resolves. |
| **Prometheus / Alertmanager** | A `webhook_configs` receiver with the endpoint URL and the secret in a header.                                                                                   | One alert per entry of the batch; labels become attributes; deduplicated by the fingerprint; `status: resolved` resolves.                                                                                                                                          |
| **Grafana**                   | A contact point of type Webhook with the URL and the secret in a header.                                                                                         | Same as Alertmanager (Grafana sends the same shape), deduplicated by the rule id; annotations land in the description.                                                                                                                                             |
| **Sentry**                    | Project → Alerts → an alert rule with a webhook action (or the Webhooks integration) to the URL with the secret.                                                 | Issue title and culprit; the issue's tags become attributes (`env` → `environment`); deduplicated by the issue id; the _resolved_ action resolves; link back to the issue.                                                                                         |
| **CloudWatch**                | An SNS topic subscribed by HTTPS to the endpoint (the secret in the URL); alarms notify the topic.                                                               | The alarm inside the SNS envelope: `AlarmName` as title, `NewStateReason` as description, `Region` as attribute; deduplicated by the alarm ARN; `OK` resolves.                                                                                                     |
| **Uptime Kuma**               | A Webhook notification with the URL; the secret in a custom header.                                                                                              | Monitor name and URL; the monitor name is the `service` attribute; up resolves, down fires; deduplicated by the monitor id.                                                                                                                                        |
| **HTTP**                      | Any tool that can post JSON.                                                                                                                                     | Free schema: `title`, `description`, a `dedup_key` / `fingerprint` / `id` as deduplication key (the title otherwise), a status field matching _resolved / ok / recovered / closed / up_ resolves; every string field becomes an attribute the mappings can rename. |

Adding a dedicated tool is a parser plus default mappings, not a connector — that is how the long tail is covered; and any tool is one HTTP source away.

## Attributes

**Settings → Attributes** is the vocabulary every source maps its payload onto and every route reasons about — so a route says _environment is production_ without knowing which tool said `env=prod`. Each attribute has a **key** (fixed once created), a label, a **type** — text, list, alert priority, or a **catalog entry** of a chosen type — whether it is **required** on every alert (sources missing it are flagged, alerts lacking it say so in their history), and what a **repeat** of the same alert does to its value: first wins, last wins, accumulate (lists), highest priority wins. The **coverage** column says how many of the last 200 alerts carry it and how many sources map it.

Bind an attribute to a catalog type only when you want the catalog to route: the value is then canonicalised to the entry it names, and a route can page _the path the entry leads to_.

## Priorities

Priorities qualify the alert and choose the urgency of the page (high pages now; low notifies quietly). Each has a name, a colour, a description, **aliases** — what the tools call it, `critical`, `sev1`, `warning`… matched case-insensitively — and one is the **default**, given to alerts nothing names. Escalation paths branch on priority.

## Routes

![Routes](img/settings-routes.png "Ordered routes, each in one line — what it catches, what it does.")

Routes are tried **in order**; the first whose conditions hold decides. Keep the one that catches everything last; the arrows on the list reorder them. No route matching means the alert is logged and nobody is paged — and the alert's history says so.

Each route is edited on a page of its own:

- **Sources**: every source, or only some.
- **Which alerts**: conditions on any attribute, or on the source, its name, the priority, the title — _is, is not, is one of, is none of, contains, matches (regex), is set, is missing_. Lines in a group are ANDed; groups are ORed. No condition catches everything.
- **Who to page**: rules that stack. **Page a path** names one; **Page from an attribute** follows a catalog-bound attribute to the entry's escalation path — or its owner team's — with a fallback when the chain does not resolve. **Page me**, a schedule or a colleague make a published one-level path in one click.
- **Incident**: never, always, or when the priority pages; the type, whether it starts in triage or active, the severity (from the priority, fixed, or none), private or not, custom fields filled from attributes, and whether a triage incident is declined when the alert resolves.
- **Grouping**: the attributes the key is built from, the window in minutes — fixed, or restarting at each alert that joins — what a joining alert does to paging (nothing, page again, page again if the priority rises), and a grace before the first page.
- **Slack channel**: where every alert this route catches is posted, with its attributes and the way in.
- **Options**: a priority when the source decides none, an urgency override, a wait before the first page, whether the escalation is cancelled when the alert resolves, **test mode** (logs everything, pages nobody, opens no incident), active.

On the right, **Against the last alerts** previews the draft: which recent alerts it would catch and who it would page — before saving.

## Heartbeats

**Settings → Heartbeats**: a dead man's switch per job. Each heartbeat has a URL; a ping resets it; silence beyond the interval plus the grace raises an alert through the workspace's own managed _Heartbeats_ source, routed like any other alert. See [Alerts](alerts#heartbeats).
