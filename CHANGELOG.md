# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Alert configuration, from zero to paged in four steps.** A new screen
  says where the alerting stands and gets a workspace live: decide who gets
  paged (one click makes a published path for you, a colleague or a schedule
  and names it on the route that catches everything), connect a source from a
  grid of tools, receive a first alert (the source page waits for it live),
  check that an alert paged someone. Each source has its page: setup steps
  and a curl command, the secret rotated and shown once, the payload of the
  last alerts, the attribute mapping edited against a real sample with a
  value preview and suggestions, the priority rule, the ingest filter, and a
  tester that says what any payload would do — route, who it pages, the
  incident — before sending it as a test or for real. An attributes page
  owns the vocabulary, with a coverage column. Routes are edited on a page of
  their own — sources, conditions, stackable paging rules with one-click
  paths, incident template, grouping, Slack channel, options — and previewed
  against the last alerts before saving; the list shows their order and
  reorders it. Priorities take aliases and a default. Alerts get a search box
  and notes; the alert's history names who a route paged and why a rule was
  skipped. The team's escalation path is picked from a list in the catalog.
- **The post-mortem is a document now.** Three columns: the contents and the
  checklists on the left, the document in the centre — its own title, the
  incident's metadata and metrics, sections written in Markdown with a toolbar
  and a live preview, blocks that insert the timeline, the follow-ups or the
  impact metrics where the cursor is, comments under each section — and on the
  right the history of every change, with restore. Sections are renamed,
  reordered, added and removed; a workspace edits its template in the
  post-incident settings, hints included. The assistant still works one section
  at a time — regenerate, tighten, enrich with facts, rewrite — and a new
  **Check against the facts** reads the whole document once and marks where a
  section misses a fact or contradicts the timeline, without touching a word.
  Export as Markdown (file or clipboard), open as a printable page, read it
  through `GET /api/v1/incidents/{ref}/post-mortem`; a **Post-mortems** page
  lists every document with its status, owner and what is still open under it.
- **Root cause analysis (RCA), the agentic way.** A live incident now gets an
  assessment the moment it is declared: the assistant gathers the evidence —
  timeline, linked alerts, changes recorded around it, similar past incidents
  with the cause their post-mortem documented, runbooks, ownership, what
  responders said — states findings that must cite it, proposes hypotheses of
  what broke and why with an explicit confidence on five levels, and has a
  second, adversarial pass try to break them before anyone reads them. One
  synthesis (what is going on, what caused it, what to do next) lands in the
  incident's Slack channel and is updated in place; the timeline records each
  assessment. A person steers it with notes, pauses it, grades it against the
  documented cause, and sends the surviving hypothesis into the post-mortem's
  RCA section as a draft. It re-assesses when a new signal lands and never
  executes anything. Enterprise edition (`aiInvestigations`), its own switch in
  AI governance, `GET`/`POST /api/v1/incidents/{ref}/investigation`.

### Changed

- **SMS and voice are two operators, not one.** A new `@openincident/notify`
  package holds the transports, and the two channels are resolved separately:
  the texts go through Brevo as soon as `BREVO_SMS_SENDER` is set — it reuses
  the key the mail already uses and costs less per message — and fall back to
  Twilio, while the calls stay on Twilio, the one operator of the shortlist
  that hands the keypress back so an escalation can be acknowledged. An
  instance can therefore text without being able to call: the phone field
  offers only SMS, and a dead row says which operator is missing. A call
  without a token to come back to no longer says "press 4", because nothing
  was listening for the 4.

- **Routing no longer needs the catalog.** A route names who to page directly —
  an escalation path, or a path found from an alert attribute through the
  catalog when a workspace has one, with a fallback — and stacks several rules,
  each with its own conditions. Conditions replace the three filter lines:
  groups ORed, conditions ANDed, with contains, matches, one of, missing.
  Routes choose their sources, carry an incident template (type, start in
  triage or active, severity from the priority or fixed, private, custom fields
  from attributes, decline the triage incident when the alert resolves), a
  grouping rule (attributes, fixed or extending window, page again on every
  alert or on a priority rise, a grace period) and a Slack channel to notify.
  Alert attributes are a registry the workspace owns — text, list, priority or
  a catalog type, required or not, with a merge strategy for repeats — and every
  source maps its payload onto it, with light transforms and a match guard. A
  source decides the alert's priority, statically or from a payload field, and
  filters what it ingests; priorities carry aliases and a default. Every new
  workspace starts with P1–P3, the five usual attributes and one route that
  catches everything and opens triage incidents — name who to page and it is
  live. Existing routes were converted; the team's escalation path became a
  validated reference; the pipeline now decides first and applies second, so a
  payload can be previewed without being ingested.
- **The product now says "root cause analysis (RCA)".** The post-mortem's
  _Root cause_ section is _Root cause analysis (RCA)_ in every language, the
  guide and the glossary explain the term, and the new analysis is named after
  it — the words the rest of the industry uses.

- **Integrations screen: the whole catalog, with marks.** Seven families
  instead of five — alert sources, chat and video, trackers, documentation,
  identity, catalog and infrastructure as code, migration and business — and
  fourteen cards that were missing, including four already shipped and simply
  not shown: the Google, Microsoft and GitHub sign-in providers, Backstage
  imports, the catalog importer and SCIM provisioning. Every tile now carries a
  drawn mark rather than two letters, and enterprise sign-on stopped announcing
  itself as a future milestone: it ships.
- **`@openincident/api-spec`,** the OpenAPI document as a package. The route
  serves it, the developer site renders its reference from it, and a test
  compares it with the routes `apps/web` really exposes — in both directions.
  Documentation can no longer drift from the product without failing the build.

## [0.0.3-alpha] - 2026-09-05

### Added

- **A certificate gate for custom status-page domains** (`GET /api/tls`). Status
  pages answer on the customer's own domain, and that domain is only known at
  the first TLS handshake, so the proxy has to be allowed to request a
  certificate for a hostname it has never seen. Doing that without a filter
  lets anyone pointing DNS at the server mint certificates in the instance's
  name; the endpoint answers 200 only for a domain a published page actually
  carries, 404 for the rest. `STATUS_TLS_ASK_KEY` restricts who may ask. The
  install chapter shows how to wire it as a proxy's `ask` URL.

### Changed

- **Sign-in sends an already signed-in member straight in.** The session is
  global and its cookie can be set on the parent domain, so landing on a
  workspace's sign-in page with a valid session and a membership is common;
  the page asked for a password again, which nobody can answer differently.

## [0.0.2-alpha] - 2026-09-05

The seam a control plane plugs into. The product still sells nothing and keeps
no card: in the cloud edition it asks its control plane what to show.

### Added

- **Settings → Subscription & invoices (cloud edition).** The workspace's plan
  and trial, the seats it covers, this month's usage against the plan's
  ceilings, the public offers as the control plane sells them (monthly or
  yearly, seat stepper), the invoice history it mirrors from the payment
  provider, and the checkout, customer portal and "re-check now" actions —
  every one of them a redirect to a session the control plane opens. Owners
  act; other managers read. A paused workspace keeps this one screen reachable
  so the owner can subscribe again. Reached through `CLOUD_GATEWAY_URL` and
  `CLOUD_GATEWAY_SECRET`; without them the screen says the instance has no
  control plane, and a self-hosted instance does not have the screen at all.
- **`purgeWorkspace` exported by `@openincident/db`**, so a control plane can
  run the very same verified purge the `workspace:purge` command runs.

## [0.0.1-alpha] - 2026-09-05

The first public release: the whole product as it stands after its first
milestones — incident response end to end, alerting and on-call with a real
escalation engine, public and internal status pages served by a separate app,
reports, a governed assistant, Slack and Microsoft Teams, trackers and
documentation tools, a catalog you shape from the screen or from code, the
enterprise edition's single sign-on, SCIM provisioning and custom roles, a
user guide inside the product and a QA screen that runs the repository's own
suites. Alpha: the product works end to end and is covered by a smoke suite of
sixty-five journeys, but APIs, schema and screens still move, and no vendor
account (Slack, Teams, Twilio, S3, an inference provider) has been exercised
beyond mocks. Not production-ready yet — a very good time to try it and open
issues.

### Added

- **The foundation.** A pnpm + Turborepo monorepo with the web app, the worker
  and the shared packages (database, auth, mail, config, crypto, UI tokens).
- **Real tenant isolation from day one.** Workspaces are resolved from the
  `directory` schema before any tenant context is opened; every table of the
  `app` schema carries `tenant_id` and is protected by row-level security that
  the application role cannot bypass. An integration test tries to read across
  two workspaces and expects nothing back.
- **Complete authentication.** Sign-in with email and password or Google,
  Microsoft and GitHub; password reset; email invitations; email change with
  confirmation; account deletion — nothing behind a dead link.
- **Response core schema.** Incidents, incident types, severities, statuses,
  roles, timeline events, updates, participants, actions and follow-ups, plus
  the catalog types the routing will lean on (Team, Service, Environment).
- **The demo workspace.** "Skylark Systems" and its reference incident INC-217,
  replayable on an existing database.
- **Translations** in English (source), French and German, with dictionary
  parity enforced at compile time.
- **Response, end to end.** Declaring an incident (live, retrospective or as a
  drill), triage with accept, decline and merge, status updates with severity
  and reminders, roles, a live timeline over server-sent events, follow-ups
  and the post-incident flow with its two phases and tasks.
- **Public API v1.** Bearer keys created in the settings and shown once;
  scopes `read`, `write` and `incident:create`; cursor pagination; a fixed
  per-key rate limit; `{ error: { code, message } }` on every error; an
  OpenAPI document served by the instance itself. The API and the web forms
  share one write path, so an incident declared by an integration goes
  through exactly the same rules.
- **Signed outbound webhooks.** Endpoints subscribe to incident events, every
  delivery carries an HMAC-SHA256 signature, failures are retried, listed and
  can be resent by hand; an endpoint failing for a week is disabled.
- **Living announcements.** Rules publish a post when an incident matches,
  keep it updated at every status update and close it at resolution.
- **Settings.** Custom fields read by the declaration form, the post-incident
  flow and the workspace's own word for its post-mortem, announcement
  templates and rules, new incident types inheriting a base type.
- **Alert sources and routes.** One dedicated endpoint and secret per source
  (Datadog, Prometheus/Alertmanager, Grafana, Sentry, CloudWatch, Uptime Kuma,
  generic HTTP), payloads stored raw and parsed downstream, deduplication by
  key and a five-minute grouping window; routes filter on attributes, escalate
  statically or through the catalog (service → owner team → path), open an
  incident never, always or conditionally in triage, and can run in test mode.
- **Escalation paths.** Versioned graphs of levels, conditions (working hours,
  priority, urgency), delays, retries and hand-overs, edited as a draft and
  published; a persisted state machine advances them tick by tick with
  idempotent transitions, retries within a level, acknowledgement from the
  web, a one-tap link, or a voice call; a dry run names who would be paged.
- **Schedules.** Rotations with handover time, active hours, ordered members,
  overrides (including an assumed gap), "cover me" requests accepted in one
  click, week and month views, an iCal feed, and shift reminders.
- **Notifications.** Personal rules per urgency over email, SMS, voice and web
  push, verified contact methods, a real test, and an outbox with honest
  statuses. Channels without a provider on the instance are shown as
  unavailable, never faked.
- **Alerts in the product.** The alerts list and detail with the live
  escalation card, acknowledge / snooze / resolve, incidents created from an
  alert or escalated by hand with a preview of who gets paged.
- **Slack app.** Installed from Settings → Integrations in three steps
  (authorize, configure, test a real message); one channel per incident with a
  pinned header kept current, `/incident declare | update | escalate | lead |
  status`, a :pushpin: reaction that pins a message to the timeline, a
  :white_check_mark: that turns it into a follow-up, living announcements in a
  channel, direct-message paging with an Acknowledge button. Every gesture goes
  through the same write paths as the web. Tokens are encrypted at rest.
- **War rooms.** A Google Meet or Zoom link template attached to every new
  incident, shown on the incident and in its channel.
- **Status pages.** A public page per workspace with components bound to the
  catalog, 30-day bars and 90-day uptime from the impact history, public
  incidents with their update timeline, scheduled maintenances with automatic
  transitions, email subscribers with double opt-in and one-click unsubscribe,
  RSS and Atom feeds, message templates, brand, language and a custom domain
  verified by DNS. Published from the incident's update dialog when the
  severity meets the page's threshold — never behind the agent's back.
- **`apps/status`.** The public pages are served by a separate, minimal app
  that reads one projection and nothing else of the product: no Redis, no
  session. If the product goes down, the last snapshot keeps being served; an
  unknown host is a 404, never a page.
- **Reports.** Four tabs — incidents, alerts, on-call load, follow-ups — over
  30, 90 or 365 days, each compared with the previous period: counts, median
  time to acknowledge and to resolve, incidents per week or month, by severity
  and by service, alert volume by source, recurring alerts with a shortcut to
  their route, pages by hour in the recipient's local time with a night-load
  warning, follow-up closure by team against the policy and what is overdue
  now. Every number comes from the workspace's own rows, test incidents are
  excluded, and the rows behind each tab export as CSV.
- **The assistant, governed.** One provider abstraction over any
  OpenAI-compatible endpoint (`AI_API_BASE`, `AI_MODEL`); without it every
  assistant function is shown as unavailable, nothing is simulated. Emails,
  phone numbers, IPs, internal hostnames and secrets are redacted before a
  prompt leaves. Settings → AI governance switches the whole thing or each
  capability, states the data boundaries, opts private incidents in or out
  of the knowledge layer and shows the log of every call — who, on what,
  which model, how many tokens, how long.
- **What the assistant does — and only proposes.** A title and summary at
  declaration, a summary of the timeline in the side panel, similar incidents
  (by meaning when embeddings are configured, by title otherwise, and it says
  which), a draft of the next status update in the update dialog, follow-up
  suggestions that become real only on click, and a post-mortem drafted from
  the timeline whose sections are edited in place, regenerated one by one and
  always labelled as a draft. The post-mortem now moves through in progress,
  in review and completed by hand.
- **Change events.** `POST /api/v1/change-events` records deploys, feature
  flags and configuration changes from CI or by hand, bound to a catalog
  service; the incident's side panel lists the changes recorded in the day
  before it and until its resolution, and the assistant reads them.
- **Workspace logo.** Uploaded in Settings → General (SVG or PNG, one file for
  light and one for dark backgrounds), stored in an S3-compatible bucket under
  the workspace's own prefix, served by the product with a sandboxing policy so
  an uploaded SVG can never run script, shown on the shell and on the public
  status page. Without `S3_*` on the instance the row says the upload is
  unavailable; a partial `S3_*` set stops the process at startup. A MinIO
  service ships in the compose files for local and small deployments.
- **Dark theme, per member.** Appearance in My account: follow the device,
  light or dark. Every design token has a dark value, so nothing is left
  unstyled; the choice is stamped on the document before the first paint.
- **Verified workspace purge.** `pnpm workspace:purge -- --slug <slug> --yes`
  erases a workspace: every `app` table, the directory rows, the sign-in
  accounts no other workspace still lists, and the storage prefix — then
  counts what remains in each table and lists the remaining objects, and
  fails if anything is left. A test provisions a throwaway workspace, purges
  it and checks the report.
- **The smoke suite works on a throwaway workspace.** Every run seeds a fresh
  `smoke-<id>` workspace with the demo data, tests against it and purges it
  afterwards with the operator's own command — so the demo workspace stays
  clean and the purge is proven on a full workspace at every run.
- **Issue trackers: GitHub Issues, Jira, Linear.** Connected per workspace in
  Settings → Integrations with credentials that are tested before being saved
  and encrypted at rest. A follow-up is exported as an issue from its row and
  keeps the link; every five minutes (or on demand) the issue's state comes
  back, and a closed issue marks the follow-up done with a line in the
  incident's timeline. Base URLs can be overridden for tests and proxies.
- **Microsoft Teams.** One Azure bot per instance; each workspace pairs its
  own team by typing a six-character code the settings issued — no OAuth
  dance, no shared tenant. Then the same product words as Slack: a channel per
  incident (a standard channel of the team, through Microsoft Graph) with a
  living header card, update and note cards, a living announcement card, a
  personal card that pages someone with an Acknowledge button, the declare /
  update / escalate forms as Adaptive Cards, `lead`, `status` and `help`
  commands. Inbound activities are verified against the Bot Framework's
  published keys; outbound calls use client credentials. Both chat tools can
  be connected at once — the product fans out to every one it finds.
- **Heartbeats.** A URL per cron or job; silence beyond the interval plus the
  grace raises an alert through the workspace's own managed "Heartbeats"
  source — posted to the public ingest endpoint like any monitoring tool, so
  routes, priorities, grouping and escalation apply unchanged — and the next
  ping resolves it. Nothing is alerted before the first ping; pausing a
  heartbeat forgets its last ping so resuming waits for a fresh one. Tokens
  rotate; the worker sweeps every thirty seconds.
- **On-call coverage.** Every schedule shows how much of its next sixty days
  has someone on call, measured against the hours its rotations declare, and
  lists the gaps — an empty turn, a turn with nobody, an override that removes
  the only person. Managers get one digest a day at most for the gaps of the
  coming week. The reports' on-call tab carries the figure across schedules.
- **On-call pay reports.** The workspace sets its rules — hourly rates for
  standby, night, weekend and public holiday, the night window, the holiday
  dates — and computes a month into a draft: every quarter hour someone is on
  call for a published schedule, in the schedule's zone, priced by category.
  The draft is recomputed at will, then published and frozen with the rules it
  was computed with; a member sees their own lines of published months; the
  month exports as CSV. Availability pay, the obligation that matters in most
  EU countries.
- **GitLab Issues** joins GitHub Issues, Jira and Linear as a tracker for
  follow-ups: same export, same status sync back.
- **Internal status pages.** A page can be internal: to anyone outside it does
  not exist — 404 on the page and its feeds, no subscription form — while a
  signed-in member opens it from the product and gets a day's access through
  a signed token the status app verifies without a session or a database.
- **Post-mortems exported to Confluence and Notion.** Connected per workspace
  with credentials tested before being saved and encrypted at rest; from the
  post-incident tab a post-mortem's written sections become a page (Confluence
  storage format or Notion blocks) with a link back, and the page's address
  stays on the post-mortem and in the timeline. The post-mortem here remains
  the source.
- **Runbooks for the assistant.** A service carries runbooks: a GitHub or
  GitLab file fetched through the forge's API (with the workspace's tracker
  token when one is connected), any text address, or pasted text — refreshed
  every six hours, shown on the incident's side panel, and quoted to the
  assistant only when "Runbooks and documents" is switched on in AI
  governance, where it is now a real source rather than a promise.
- **A catalog you shape.** Custom types with free naming and their own
  attributes — text, link, choice, reference to another type, members —
  created and edited from the catalog screen; entries created, edited and
  deleted with a guard that refuses the deletion of anything still
  referenced (incidents, follow-ups, status components, heartbeats, runbooks,
  change events, other entries) and names the usages instead; a CSV import
  per type that writes nothing while a single row is wrong; the write API
  (`POST /catalog/types`, `POST /catalog/entries`, `DELETE /catalog/entries/{id}`,
  `POST /catalog/import`) with the same validation; and a `catalog-importer`
  CLI that reads Backstage (groups → teams, components → services), a
  `catalog-info.yaml` on GitHub, a local YAML, JSON or CSV file, a command's
  output or an inline document, then talks to the API — with `--lock` to make
  the declared types read-only on screen, since code owns them. Every change
  is an audit line, the API's included.
- **Enterprise edition, first features (`ee/web`, commercially licensed).**
  Served by the app through one-line shells, switched on by entitlements
  (`OI_ENTITLEMENTS` on a standalone install; the control plane in cloud) and
  shown as unavailable otherwise:
  - **Single sign-on** — OpenID Connect and SAML 2.0 connections per
    workspace, configured from the settings with the redirect URI, ACS URL
    and service-provider metadata the provider needs; a sign-in button per
    connection; members created on first sign-in with the connection's role,
    from the allowed email domains; "SSO only" refusing a password for those
    domains, with a guard against locking every owner out; every sign-in an
    audit line.
  - **SCIM 2.0 provisioning** — one endpoint per workspace at `/scim/v2`
    behind a bearer token issued once and rotated from the settings: Users
    (created, renamed, deactivated, filtered by userName or externalId; PATCH
    in the Okta and Entra ID shapes; DELETE deactivates, never erases) and
    Groups mapped to catalog teams and their members.
  - **Custom roles** — named permission sets on a built-in base. The product
    now asks one question everywhere — may this member do this here? — with
    twelve permissions covering incidents, catalog, on-call, status pages,
    reports, each settings area and the audit log; the four built-in roles
    are fixed sets, so nothing changes for them. Assigned from Members &
    roles; a role in use cannot be deleted.
- **The user guide, inside the product.** Twenty-seven Markdown chapters under
  `docs/guide` — install and configure, concepts, every screen, the
  integrations, the enterprise edition, operations, eight end-to-end use
  cases (including the complete configuration for Open Helpdesk, our own
  support desk, with an honest assessment of what works as-is), a glossary —
  rendered under **Guide** in the rail for every member,
  with a table of contents per chapter and real screenshots captured from the
  demo workspace by `pnpm --filter @openincident/smoke guide-shots`. The files
  carry no product markup, so the public website can serve them as they are.
  The members list now shows where a member came from (SSO, SCIM).
- **QA from the admin.** Settings → QA (owners) runs the repository's own
  test suites from the product — the Playwright smoke suite on a throwaway
  workspace, the unit tests, the type check, the linter, the formatter —
  through the worker on the machine that has the source checkout. Each run
  is a row with its live log, exit code, counts and the list of what failed;
  a run can be stopped; prerequisites are checked on screen and an instance
  without a checkout says so instead of pretending.
- **Auth base URL derived per request.** Better Auth now resolves its base
  URL from the workspace host (checked against the instance's domains) unless
  `BETTER_AUTH_URL` pins it, so OAuth and SSO callbacks land on the workspace
  that started the flow.

### Fixed

- **The demo's public status page pointed at a domain nobody serves.** The
  demo seed declared `status.skylark.dev` as a _verified_ custom domain, so
  "View the public page", the incident's status page link and the API answered
  `https://status.skylark.dev` instead of the instance's own address. The
  demo's custom domain now stays pending, as a sample; a domain becomes the
  page's address only once its DNS is really verified.
- **The compose stack now names its own public addresses.** `BASE_DOMAIN` and
  `STATUS_BASE_DOMAIN` default to the compose ports (`localhost:3000`,
  `status.localhost:3001`) unless `.env` names real domains; previously the
  development values of `.env.example` (`localhost:3100`, `:3107`) leaked into
  the production stack and every link — and the workspace resolution — pointed
  at ports nothing listened on.
- **Workspace resolution after a server-action redirect.** Next.js renders the
  target of a redirect issued by a server action through an internal request
  whose `Host` is the listen address, with the real host in
  `x-forwarded-host`. The middleware read `Host` alone, so on an instance with
  `DEFAULT_TENANT_SLUG` set the page that followed a save could be rendered
  for the default workspace instead of the caller's. Found by running the
  smoke suite on a throwaway workspace next to the demo one; the middleware now
  prefers `x-forwarded-host`, which is also what any reverse proxy sends.
- **Origins built after a server-action redirect.** The same internal request
  made URLs rebuilt from `Host` point at the bare listen address (a heartbeat
  ping URL without its workspace, for instance). Origins now honour
  `x-forwarded-host` and `x-forwarded-proto` first.
