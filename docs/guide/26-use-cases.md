---
title: Use cases
section: use-cases
order: 26
summary: Eight complete scenarios, step by step, from the first alert to the exported post-mortem, from a new team to a full SSO roll-out.
---

Each case is a story you can replay in the demo workspace. Steps name the screens as they are; the reference chapters give the detail behind each step.

## Case 1 — A Datadog alert becomes a paged incident

**Goal**: a monitor fires at 02:14; the right person is woken, the incident is run, customers are told, and the incident is resolved with a post-mortem started.

**Preparation (once)**

1. **Catalog**: the service `checkout-api` exists with the owner team **Payments**; the team's **escalation path** attribute names _Payments escalation_.
2. **On-call → Escalation paths**: _Payments escalation_ is published with a level 1 paging the _Payments_ schedule (on call now, high urgency, ack 5 min, 2 retries) and a level 2 paging the _Platform primary_ schedule.
3. **On-call → Schedules**: the _Payments_ schedule is published with its rotation.
4. **Settings → Alert sources → + New source → Datadog**: copy the endpoint and secret into a Datadog webhook; attach it to the monitors' notifications.
5. **Settings → Routes → + New route**: filters `source equals datadog` and `service exists`; escalation **dynamic — service → owner team → its path**; incident **conditional — triage when urgency is high**; priority from the payload; urgency from the priority.
6. Each responder verified a phone number in **On-call → My notifications** and has _SMS immediately, voice after 3 min_ in the high-urgency rule.

**During the incident**

1. Datadog posts. The alert appears under **Alerts → Firing** with `service: checkout-api`, priority P1 (high urgency). The **History** reads _Routed by « Datadog → catalog »_, _Incident INC-231 created in triage_, _Level 1 notified — Karim_.
2. Karim receives an SMS with a one-tap link and taps **Acknowledge**. The alert's card reads _Acknowledged by Karim, 1 minute after the page — escalation timers stopped_; Karim is added to the incident.
3. In **Incidents → Triage**, Karim **accepts** INC-231 with severity SEV2. The incident becomes active; the announcement rule _Announce SEV1 / SEV2_ posts to the workspace and to the Slack announcement channel; the channel `#inc-231-…` is created.
4. Karim **assigns** himself incident lead, then **Share an update**: status _Investigating_, message _Checkout latency above 3 s in eu-west-1; investigating a deploy at 01:50_, next reminder 30 min. The incident's side panel lists the **Recent changes**: `checkout-api v2.41.0` deployed at 01:50 from CI.
5. The incident meets the publication threshold of the status page: in the next update, Karim ticks **Status page — Skylark status**, public status _Identified_; the _Checkout_ component turns to _degraded_; subscribers receive the update.
6. Rollback done, Karim publishes _Monitoring_, then **Resolved**. The time to resolve is fixed; subscribers are told; the status page shows _Resolved_; the announcement closes; the **post-incident** flow starts (SEV2 rule).

**Afterwards**: see Case 7.

## Case 2 — Onboarding a new team and its service

1. **Catalog → Teams → + New entry**: _Search_, escalation path _Search escalation_, chat channel `#team-search`.
2. **On-call → Escalation paths → + New path** _Search escalation_: level 1 → schedule _Search_ (on call now, high urgency, ack 5 min), a **condition** _Working hours "EU business"?_ — YES: level 2 pages the _Search_ team members; NO: **delay** until _EU business_ opens, then level 2. **Publish v1**. **Test the path** names who would be paged right now.
3. **On-call → Schedules → + New schedule** _Search_: weekly, handover Monday 09:00 Europe/Paris, members in order. **Publish**.
4. **Catalog → Services → + New entry** `search-indexer`, owner **Search**, repository `acme/search-indexer`, tier 2. The routing chain on the right shows _incoming alert → search-indexer → Search → Search escalation_.
5. **Catalog → search-indexer → Runbooks → Add**: title _Reindex procedure_, URL of the runbook in GitHub. It is fetched and shown on every incident of the service.
6. **Settings → Heartbeats → New heartbeat** _Nightly reindex_, service `search-indexer`, every 24 h, grace 1 h. Put the URL at the end of the cron. Nothing fires before the first ping.
7. **Status pages → Skylark status → + Component** _Search_, catalog service `search-indexer`.

No route was touched: the existing dynamic route follows the catalog.

## Case 3 — The weekly on-call review

1. **Reports → On-call load**, period 30 days: pages sent, median ack, **night pages 00–06** with the banner naming who carried the night load, the heat strip by hour.
2. **Reports → Alerts**: the **recurring alerts** — _Adjust the route_ on the noisy one: add a filter, or defer its notification by 10 minutes to let grouping absorb the burst, or route it to _none — log only_ while the monitor is tuned.
3. **On-call → Schedules**: **Coverage · next 60 days** shows _2 gaps · 16 h without anyone_ — cover them with **Add an override**.
4. **Reports → On-call pay**: **Generate the draft** for last month, check the lines, **Publish**. Members see their own lines; **Export CSV** goes to payroll.

## Case 4 — Rolling out Okta: SSO, SCIM and an "Alerting admin" role

Enterprise edition, `OI_ENTITLEMENTS=sso,customRoles`.

1. In Okta, create an OIDC web application; note the client id and secret.
2. **Settings → Single sign-on → + Add a connection**: OpenID Connect, label _Okta_, issuer `https://acme.okta.com`, client id and secret, email domains `acme.example`, role of a new member _responder_, **Create the member on first sign-in**. **Create the connection**; copy the **Redirect URI** into Okta; assign the engineering group.
3. Sign out; the sign-in page shows **Continue with Okta**. A first engineer signs in: a member is created as responder; **Settings → Audit log** shows _Okta SSO sign-in — new session for …_.
4. **Settings → Provisioning (SCIM) → Enable and issue a token**; in Okta, configure the SCIM integration with the base URL and the token; enable create, update and deactivate; push the _Payments_ and _Search_ groups. **Catalog → Teams** now mirrors the groups' members.
5. **Settings → Custom roles → + New role** _Alerting admin_: base responder, permissions `incidents.respond`, `catalog.entries`, `settings.alerting`. **Members & roles**: give it to the SRE. They now see **Settings** with the **Alerting** group only.
6. Once every owner has signed in through Okta at least once, edit the connection's intent by recreating it with **SSO only** — passwords are refused for `acme.example`; the guard refuses the change if it would lock every owner out.
7. An engineer leaves: Okta deactivates the user; the member is **disabled** in the product, refused at the door, and everything they did stays attributed.

## Case 5 — Migrating the service catalog from Backstage

1. **Settings → API & webhooks → + New key** _Catalog importer_, scope `write`.
2. From a laptop or CI: `pnpm catalog:import -- --source backstage --url https://backstage.acme.example --token … --api https://acme.your-domain.example --key oi_live_… --dry-run` prints what would be sent — groups as teams, components as services with owner, repository and tier.
3. Run without `--dry-run`: _entries: 42 created · 0 updated · 0 unchanged_. Run again: _0 created · 0 updated · 42 unchanged_.
4. Put the command in a nightly job. Add `--lock` if the catalog must be owned by Backstage: the **Team** and **Service** types show _Managed by code_ and the screen stops offering edits.
5. Squads are not in Backstage: **Catalog → + New type** _Squads_ with a _Team_ reference, then **Import CSV** from the HR export — matched by `external_id`, so re-imports update instead of duplicating.

## Case 6 — Running an incident from Slack

1. In `#platform`, `/incident declare`: the form opens; title _Elevated 5xx on web-storefront_, severity SEV3, service `web-storefront`. The incident and its channel `#inc-232-elevated-5xx-on-web-storefront` are created; the declarer and role holders are invited.
2. In the channel, `/incident lead @lea` names the lead; `/incident update` publishes _Investigating_.
3. Someone pastes a graph: a :pushpin: reaction pins it to the timeline. Someone writes _we should alert on the queue depth_: a :white_check_mark: reaction turns it into a follow-up.
4. `/incident escalate` → _Platform primary_: the preview names who is on call; confirming pages them; the acknowledgement arrives from a direct message with the **Acknowledge** button.
5. `/incident status` summarises for a newcomer; the pinned header already shows severity, status, lead and the next update due.
6. Resolution from the web or from `/incident update` with **Resolved** — the channel gets the final card; the channel stays as the record.

## Case 7 — Post-incident: follow-ups to Jira, post-mortem to Confluence

1. INC-231 is resolved (Case 1); the **Post-incident** tab shows phase **Document** with its tasks assigned to the lead, due in 3 days.
2. **Draft with AI** fills the six sections from the timeline, each labelled **AI DRAFT**. The lead edits _Root cause_ and _What to improve_; **Regenerate this section** redoes _Timeline_ alone.
3. **Suggest follow-ups** proposes three actions; the lead creates two: _Add a latency SLO alert on checkout-api_ (P1) and _Document the rollback procedure_ (P2), assigned to team Payments.
4. On each follow-up's row, **Export → Jira**: issues `PAY-412` and `PAY-413` are created with links back. When `PAY-413` moves to _Done_ in Jira, the follow-up is marked done here within five minutes, with a line in the timeline.
5. The debrief is scheduled from the tab; the invitations go to the role holders and active participants.
6. **Send to review**, then **Mark completed**. **Export to Confluence** creates the page in the _Incidents_ space; its address stays on the post-mortem.
7. Every task done, the incident **closes**. **Reports → Follow-ups** will show the closure against the policy.

## Case 8 — A maintenance on an internal status page

1. **Status pages → + New page** _internal-ops_, visibility **Internal — members of the workspace only**. Add components bound to the internal services.
2. **Schedule a maintenance**: title _Database failover test_, the window, the components, **automatic transitions**. Members opening the page from the product see it under _Maintenance in progress_ at the start and _Completed_ at the end; nobody outside the workspace can reach the page or its feeds.
3. During the window an incident on an internal service is declared as **Test** mode for the drill: it is excluded from reports and announcements, and never suggested for publication.
