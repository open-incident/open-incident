---
title: Glossary
section: reference
order: 27
summary: The product's words, in one place.
---

| Term                   | Meaning                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Acknowledge**        | Tell the product a page reached a human. Stops the escalation timers.                                                           |
| **Alert**              | What a monitoring tool sent: one payload, deduplicated by key and grouped. Has a priority and an urgency.                       |
| **Alert source**       | One monitoring tool's endpoint and secret, with a mapping from payload to attributes.                                           |
| **Announcement**       | A living post published by a rule when an incident matches, updated with the incident, closed at resolution.                    |
| **Attribute**          | A value extracted from an alert's payload (service, environment, priority…), bound to the catalog when it names an entry.       |
| **Bundle**             | The catalog's exchange format: types and entries in one document, applied in one transaction.                                   |
| **Catalog**            | Teams, services, environments and your own types; the spine of the routing.                                                     |
| **Change event**       | A deploy, flag or configuration change recorded through the API and shown next to the incidents it may explain.                 |
| **Coverage**           | The share of the hours a schedule declares that has someone on call over the next 60 days.                                      |
| **Custom role**        | A named permission set on a built-in base (enterprise edition).                                                                 |
| **Deduplication key**  | The value a source repeats for the same problem; one alert per key.                                                             |
| **Entitlement**        | A capability switched on for a workspace: by `OI_ENTITLEMENTS` on a standalone install, by the control plane in cloud.          |
| **Escalation**         | A running instance of a path: levels reached, people paged, acknowledgement or exhaustion.                                      |
| **Escalation path**    | A versioned graph of levels, conditions, delays, retries and hand-overs that says how a page travels.                           |
| **External id**        | An entry's identifier in the system that owns it; what the importer and the API match on.                                       |
| **Follow-up**          | An action to take after an incident, with a priority, an assignee and a deadline; exportable to a tracker.                      |
| **Grouping**           | Alerts of the same route within a five-minute window are attached to the first one.                                             |
| **Heartbeat**          | A URL a job calls; silence beyond the interval and grace raises an alert.                                                       |
| **Incident**           | What the team runs: title, severity, status, roles, updates, timeline, follow-ups.                                              |
| **Incident type**      | A lifecycle and a declaration form; severities are shared across types.                                                         |
| **Just-in-time (JIT)** | Creating a member on first SSO sign-in.                                                                                         |
| **Mode**               | Live, retrospective or test. Test incidents are excluded from reports and announcements.                                        |
| **Outbox**             | Where every email, SMS, push and chat message is written with an honest status before it leaves.                                |
| **Override**           | A slot of a schedule given to someone else (or to nobody) without touching the rotation.                                        |
| **Phase**              | Triage, active, post-incident, closed — the fixed lifecycle every incident follows.                                             |
| **Post-mortem**        | The document written after an incident; the workspace picks its own word for it.                                                |
| **Priority**           | Qualifies an alert (P1, P2…); carries an urgency.                                                                               |
| **Private incident**   | Visible to role holders and explicit guests only.                                                                               |
| **Route**              | Filters on attributes → escalation → incident rule. Tried in order, first match wins.                                           |
| **Runbook**            | Documentation attached to a service, fetched from a URL or pasted, read by the assistant when allowed.                          |
| **Schedule**           | Who is on call when: rotations, handover time, overrides.                                                                       |
| **SCIM**               | System for Cross-domain Identity Management: the identity provider creates, updates and deactivates members through `/scim/v2`. |
| **Severity**           | Qualifies an incident (SEV1, SEV2…); decides announcements, publication suggestions and the post-incident flow.                 |
| **Status**             | The workspace's word inside the active phase (Investigating, Monitoring…), mapped to a public status.                           |
| **Status page**        | A public or internal page with components bound to catalog services, incidents and maintenances.                                |
| **Triage**             | The phase where alert- or API-born incidents wait for a responder to accept, decline or merge.                                  |
| **Urgency**            | High wakes people up; low stays silent. Picks the notification channels of a member's rules.                                    |
| **Working hours**      | A named set of days and hours used by escalation conditions and delays.                                                         |
| **Workspace**          | An organisation's space on an instance: its own members, catalog, incidents, settings, subdomain.                               |
