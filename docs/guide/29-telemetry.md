---
title: Telemetry
section: operations
order: 29
summary: Logs and traces from your own services, in the product that already knows who is on call for them — the optional OpenTelemetry module, what it stores, and the four lines that start it.
---

Open Incident can receive the logs and traces your services already emit, and
read them next to the incidents and the on-call schedules they belong to. It is
an **optional module**: the product runs, pages people and publishes status
without it, and every telemetry screen says "not installed on this instance"
rather than drawing an empty chart.

## What it needs

A ClickHouse. Telemetry is a different shape of data from everything else the
product keeps — billions of rows nobody updates, queried by time range — and
putting it in PostgreSQL would ruin both. Configuration and state stay in
PostgreSQL; the signal goes to ClickHouse, never the other way round.

Both the store and the OTLP receiver sit behind a `telemetry` profile, off by
default. That is a choice rather than an omission: a column store is a second
database to run, back up and watch, and the incident product is whole without
one. An installation that only wants alerting and on-call should not be paying
for it.

**Self-hosting**, from `compose.yaml`. Set `CLICKHOUSE_URL` in `.env` first, or
the migrate service has nothing to migrate:

```
CLICKHOUSE_URL=http://clickhouse:8123   # in .env
docker compose --profile telemetry up -d
```

That starts ClickHouse and the ingestion service, and the migrate service
applies the column store's schema alongside the PostgreSQL migrations — one
place, so a deployment cannot end up with a schema on one side and not the
other.

**Developing on the host machine**, from the development stack:

```
docker compose -f docker/docker-compose.yml --profile telemetry up -d
pnpm ch:migrate
```

Then, on the instance:

| Variable                                                        | Meaning                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `CLICKHOUSE_URL`                                                | The store's address. Unset, the module is not installed — that is the whole switch.                                 |
| `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE` | Default to the compose values.                                                                                      |
| `TELEMETRY_PUBLIC_ORIGIN`                                       | The address collectors send to. The ingestion service is a separate process, so this is not the product's own host. |
| `TELEMETRY_PORT`                                                | What that service listens on. `4318`, the OTLP/HTTP default.                                                        |

## Collector packs

`docker/collector/` holds ready-made OpenTelemetry Collector configurations:
the host's own numbers, PostgreSQL, Docker containers, Kubernetes. Each takes
the endpoint and a key and nothing else, and the services it finds appear in
**Services** on their own. They are listed on **Telemetry → Connect**, beside
the key they need.

Its README says which of them have been started against a real daemon and
which have not — three of the four, and the fourth says so in its own header.
A pack that has never been run is documentation, not a pack, and finding that
out during an incident is the wrong time.

Two things running them taught us, both pinned into the files:

- The **PostgreSQL** receiver before collector 0.116 reads a column PostgreSQL
  17 removed. The scrape then fails every interval and sends nothing.
- The **Docker** receiver defaults to API version 1.25, which Docker 25 and
  later refuse; and the collector image runs unprivileged while the socket
  belongs to root, so it needs `--user 0` or the socket's group.

## Sending

**Telemetry → Connect** issues an ingestion key. It is shown once and stored as
a digest: there is no screen that can show it again, and the page says so
before the button rather than after.

Four environment variables on any service instrumented with OpenTelemetry:

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.your-instance
OTEL_EXPORTER_OTLP_HEADERS=x-oi-key=oi_otel_…
OTEL_SERVICE_NAME=checkout-api
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.version=2.31.0
```

Both OTLP encodings are accepted, protobuf and JSON, which covers the SDKs and
the OpenTelemetry Collector without any extra setting.

`service.name` is required. A payload without one is refused rather than filed
under `unknown_service`, and the refusal is kept — the last hundred are listed
at the bottom of **Connect**, with their excerpt scrubbed. That list is the
fastest way to find out why nothing is arriving.

## What happens to a signal on the way in

1. The key resolves its workspace **before** the body is decoded. An unknown
   sender never costs a parse.
2. Secrets are stripped before anything is written — API keys, bearer tokens,
   `password=` pairs. Not at display time: a secret redacted on screen has
   already been stored. Your own rules can be added per workspace.
3. Identifying attributes — `enduser.id`, `user.email` — are **hashed rather
   than removed**, so a session still groups and a person cannot be recovered.
   IP addresses and hostnames are kept: they are what a log is for.
4. The service named by `service.name` appears in **Services** on its own, the
   first time a span mentions it. Nothing to fill in first; the only thing a
   human adds is the owning team, and that is what makes the pager ring.
5. Each row carries its own expiry. Changing the retention acts on what arrives
   next; shortening it does not retroactively rewrite what is already stored,
   and lengthening it cannot bring back what is gone. The screen says so.

## Reading

**Logs** is the stream, newest first, with the severity and the service. A line
that carries a trace id links to it.

**Traces** lists the traces, and opening one draws the waterfall with the logs
of that same trace beside it. The tree comes from `parent_span_id`, not from
arrival order — spans reach the store from several services and in no
particular sequence. A span whose parent never arrived is drawn at the root
rather than hidden.

**Metrics** browses the series a workspace keeps, with their labels and their
last points. **Exceptions** shows one row per bug rather than one per
occurrence: the grouping key is a fingerprint computed at ingestion from the
type, the message with its variable parts removed, and the first three frames
of your own code — so the same failure at ten thousand occurrences is one line
with a count and a first-seen, and two callers of the same library failure are
two lines.

## When a bug is news

Three things about an exception group raise an alert on their own, without
anybody having written a monitor for them (§15.8):

- **new** — a fingerprint this workspace has never seen;
- **reopened** — one somebody marked resolved, firing again;
- **surge** — one that has been around, now firing at least five times its
  usual hour.

The "usual hour" is the **median** of that group's hourly counts over the past
week. A median because a group's history contains its own past incidents, and
one bad afternoon in an average is enough to hide the next one; a week rather
than a day because most services are quiet at night, and an hour compared to
the hour before it calls every Monday morning a surge.

A multiple alone is not enough, so a floor applies: below ten occurrences in
the hour, five times a usual of one is still five occurrences, which is not an
incident. And the same group does not page twice in a row — a surge lasting
four hours is one problem, and the alert it already raised is still open.

Each group can be **resolved**, **ignored** or **snoozed** from its own panel
on the Exceptions screen. Those are the escape hatch: a workspace with a noisy
dependency must be able to quieten that one group without switching off the
feature that tells it when something new breaks. Resolving is also what makes
the group coming back afterwards into news rather than one more line in a list.

The rule is on by default and can be turned off per workspace, with its own
severity, under Settings → Observability. On by default because the
alternative is that the one thing everybody wants from an exception tracker has
to be discovered and switched on.

## The service map

**Service map** draws who calls whom, from the traces themselves. A dependency
nobody wrote down is the one that breaks the incident — the service you had
forgotten talks to the database you are about to restart — so the map is read
out of what actually happened rather than out of a list somebody maintained.

Every dependency shown is **observed**: it happened inside the window being
looked at, and one that stops happening stops being shown. A map that
remembered every call ever made would draw a topology that no longer exists.

Services are laid out left to right by depth, not as a free-floating cloud.
During an incident the question is "what is downstream of this", and columns
answer it at a glance: entry points on the left, and what everything ends up
depending on at the right. Depth is the **longest** path that reaches a
service, so a database called both directly and through two hops sits at the
far end where it belongs. A cycle stops the walk rather than looping.

An edge is any parent span whose child belongs to another service, and
deliberately not only a `client` span with a `server` child. That second shape
is the semantic convention, and it is what a fully instrumented HTTP call looks
like — but a database span is commonly attributed to the database rather than
to its caller, a messaging consumer sometimes arrives as `internal`, and a
library that sets no kind sets `unspecified`. Every one of those is a real
dependency, and filtering on kind drops them without a word.

The edges are rolled up a minute at a time by the worker, three minutes behind
the clock. Being late is what makes the join possible: the caller's span and
the callee's span come from two services and land at two different moments, so
a rollup that ran the instant a minute closed would miss half its own edges. A
worker that was stopped fills the minutes it missed, oldest first, rather than
resuming at the present — a hole in a dependency map does not read as a gap, it
reads as "these two services stopped talking".

## Monitors on telemetry

Four monitor types watch what a service says about itself rather than whether
it answers: **logs**, **traces**, **metrics** and **exceptions**. They appear
in "+ New monitor" beside the reachability types, and are greyed with the
command to start ClickHouse when the instance has no column store.

A telemetry monitor is a query, a measure and a condition:

- **Which rows**, as `field = value` joined by `AND` — plus `contains` for a
  substring, `=~` for a regular expression, and `attr:<name>` to reach an
  attribute. The fields are listed under the box, because a filter naming one
  we do not have is refused. A metrics monitor takes PromQL instead, from the
  same subset the Prometheus API answers.
- **A measure over a window** of one to sixty minutes: how many, per second,
  or an average, a total or a percentile of a numeric field.
- **A condition**: above a threshold, or away from the usual. "The usual" is
  the median of the same hour of the week over the past four weeks, with a
  robust deviation around it — a median rather than a mean because a month of
  production contains the incidents, and one four-hour outage would drag a mean
  far enough to hide the next one. A series with less than two weeks of history
  says `learning` and pages nobody.

Two settings decide how loud it is. **Held for** is the number of consecutive
evaluations that must agree before it fires, so a one-minute spike wakes
nobody; a recovery never waits. **One alert per** splits the monitor by a
label: "errors by route" pages about `/checkout` without dragging in `/health`,
and each route resolves on its own. Leaving it empty gives one alert for the
whole monitor.

**When silent** is asked because silence is ambiguous. A queue with no messages
is fine; a service that stopped writing logs is the incident. The monitor says
nothing, pages, or reads the silence as a zero — whichever its author meant.

The evaluation runs every minute, and everything it raises is posted to the
workspace's own alert ingest endpoint, exactly as a third-party tool posts one.
There is no private path from a monitor to an incident, so the rules, the
grouping and the escalation are identical whoever raised the alert. The alert
is sent **before** the new state is recorded: posting twice is deduplicated on
the key, while a post lost to an unreachable endpoint would be a page that
never happens and never retries.

The monitor's own screen shows the series it watches, what each last measured
and which of them is breaching or being held — not an uptime percentage, which
a monitor that never reached out does not have.

## Grafana, and the PromQL subset

The instance answers the Prometheus HTTP API under `/prometheus/api/v1/`, with
an API key as `Authorization: Bearer oi_live_…`. Point a Grafana Prometheus
datasource at it and the label pickers, the metric browser and the graph panels
work as they do against Prometheus itself.

What is answered is a **published subset**, not a reimplementation of the
language:

| Supported                                                                  | Not yet                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------- |
| Selectors with `=`, `!=`, `=~`, `!~`; range vectors; `offset`              | `histogram_quantile`, `label_replace`, `quantile` |
| `rate`, `irate`, `increase`, `delta`, the `*_over_time` family             | `on`/`ignoring` vector matching, the `@` modifier |
| `sum`, `avg`, `min`, `max`, `count`, `topk`, `bottomk` with `by`/`without` | arithmetic between two vectors                    |
| `abs`, `clamp_min`, `clamp_max`, `round`; arithmetic against a scalar      |                                                   |

A query using anything in the right-hand column comes back as an error
**naming the construction** — "histogram_quantile is not supported yet" — and
never as a partial result. A panel that says what it cannot do is worth more
than one that quietly draws a different line from the one you asked for.

Two behaviours worth knowing because they are Prometheus' own: a series with no
point in the last five minutes is stale and disappears from an instant query,
and a counter that goes backwards is treated as having restarted rather than as
a negative rate.

Queries shorter than seven days read the raw points; longer ones read the
per-minute rollup, where a point is a minute.

## Dashboards

**Dashboards** holds grids of PromQL panels. Every panel is a query against the
same subset the Prometheus API answers — a panel cannot show something PromQL
cannot express, so a dashboard never becomes a second, quieter query language
with its own rules. A panel whose query fails says why, in its own tile, and
leaves the others alone.

A window selector covers one hour to three days, and TV mode drops the chrome
for a wall display. Sharing a dashboard publicly issues an unguessable token
rather than exposing the slug, and turning sharing off destroys that token, so
a link that leaked stops working.

### Importing from Grafana

Paste a Grafana dashboard JSON and the panels that can be translated are, with
a **report** stored alongside the dashboard and shown above it. A panel is
skipped when it is not a graph of a Prometheus query, or when its expression
uses a construction outside the subset — and the report names which.

That second rule is the point. A panel whose expression we cannot evaluate
exactly would draw a different line here from the one it drew in Grafana, and a
migrated dashboard that quietly changes its numbers is worse than a missing
panel. Skipped panels are listed with their reason so the gap is visible the
day of the migration, not a week later.

## Service level objectives

An SLO turns "is it slow?" into a decision. You name what counts as a good
event and what counts as an event at all — two PromQL expressions — and say
what fraction has to be good. What is left of the difference is the **error
budget**, and how fast it is being spent is the **burn rate**.

Alerting on the burn rate rather than on the objective is the whole point. An
SLO of 99.9 % over a month still reads 99.9 % an hour into a total outage,
because one hour is a small part of a month: waiting for the monthly figure to
move is waiting for the month to end. The burn rate moves immediately.

Two speeds, because they are two different instructions. A **fast burn** —
above 14.4× over an hour, confirmed over five minutes — is an outage in
progress and pages as P1. A **steady burn** — above 6× over six hours,
confirmed over thirty minutes — is an erosion nobody has noticed and is worth
today rather than tonight, so it is P3. The short confirming window is what
lets the alert resolve when the problem does rather than when the long window
has finished rolling past it.

Two things are deliberate in the arithmetic. **An empty window is not a perfect
one**: a service that sent nothing reads as no indicator at all, not as 100 %,
because 100 % is what a broken exporter produces and it is otherwise
indistinguishable from flawless. And the **step matches the range in your own
expression** — `increase(x[5m])` is read every five minutes, so the slices tile
the window with no gap and no overlap. A finer step would count the same events
several times and a coarser one would skip the gaps; either way the ratio would
be wrong by a factor that still looks like a plausible percentage. When a
window and a range would together need more than twenty thousand points, the
SLO says so instead of quietly coarsening.

A rolling window forgives an incident gradually and never hands you a fresh
budget. A calendar one restarts on the first, whether or not the problem was
fixed — which is usually what a contract says.

## The SQL console

**SQL** is the honest end of the explorer: every question the filters do not
cover is one you can answer yourself. A reader who knows SQL should not have to
export their telemetry to ask it something.

What you type never reaches ClickHouse unchanged. Each table name is rewritten
to the parameterized view for that table — which does not compile without a
workspace — and a name that is not one of ours is refused, by name, rather than
passed on. That matters because the underlying tables hold every workspace's
rows: `system.tables`, another database, or a table we do not know would all be
a way out of your own data, and none of them get that far.

`SELECT` only, one statement at a time, a thousand rows and twenty seconds.
`SETTINGS` is refused too, and it is the subtle one: it is not a write, but
`max_result_rows = 0` hands back everything the ceiling was there to withhold.
When a result hits the ceiling the console says so — a reader who sees exactly
a thousand rows and is not told why will believe that is how many there are.

The readable tables are `otel_logs`, `otel_spans`, `otel_traces`,
`otel_exceptions`, `exception_groups`, `metric_series`, `metric_1m` and
`service_edges`. Subqueries and `WITH` clauses work as they do anywhere.

## From a service

A service's own page carries two cards the traces fill in.

**Telemetry** is four numbers over the last day — error logs, spans, the share
of them failing, and p95 — each against the same window the day before, and
three links into the explorers already narrowed to that service. Four numbers
and four links rather than four embedded explorers: the explorers exist and
they filter by service, and copying them here would be two screens to keep in
step for no new answer. What the card adds is "is anything wrong right now",
which is a glance rather than a console.

**Dependencies** lists what this service calls and what calls it, over the same
day. Upstream and downstream are separated because during an incident what a
service calls is where to look for a cause and what calls it is who is about to
notice.

Every explorer keeps the service filter as you move between its tabs, and says
so with a chip you can click to remove — a filtered list that does not say it
is filtered is a list somebody reads as "there is nothing else". The map does
not filter: arriving from a service picks that service out and leaves the rest
drawn, because hiding everything else removes the only thing a map is for.

## What Atlas reads

An investigation gathers two more checks when the module is installed:
**Telemetry** and **Dependencies**, on the affected service, over the window
from an hour before the incident was declared to its end.

Every figure is given against **the same window the day before**, because a
number on its own says nothing: "four hundred errors" is either a catastrophe
or a Tuesday, and only the comparison tells you which. The checks report the
service's error-log count, its traffic, its failure rate and its p95; the
exception groups whose **first** occurrence falls inside the window — a bug
that has been firing for a month is background, one that started twenty
minutes before the declaration is a candidate; and the neighbours it called or
was called by, with the same comparison.

The direction of a dependency is stated rather than left to be inferred. A
downstream neighbour erroring is a candidate cause; an upstream one erroring is
more likely a consequence, and an analysis that cannot tell them apart names
the victim with confidence.

What is returned is aggregates and at most a handful of named examples, never a
dump. The model reading this has a context window, and ten thousand log lines
would push the timeline and the change events out of it — making the analysis
worse, not better. Each item carries an id the findings must cite, so a claim
about the telemetry can be traced back to the number it came from.

The checks are governed like the others, under Settings → AI: a workspace can
switch the telemetry source off. A workspace whose settings predate the checks
has them on, because absent is not a choice somebody made.

## Isolation and deletion

Every ClickHouse table is shared, with `tenant_id` first in its sort key, and
the query layer reaches them only through parameterized views that do not
compile without a workspace. A query that forgets its tenant is not a leak, it
is a query that fails — and a test tries the raw tables on every commit to
prove the difference.

Purging a workspace erases its telemetry too, waits for the deletion and counts
what is left. A purge that emptied PostgreSQL and kept a month of spans would
satisfy nobody.

## What is not here yet

Profiles and real user monitoring are later milestones. They are absent from
the screens rather than present and empty.

The map feeds no `DEPENDS_ON` facts yet, because the context graph they belong
to is not built. The edges are there and queryable the day it is.

The read-only tools the specification lists for Ask and MCP are not here
either, and for the same kind of reason: there is no Ask surface and no MCP
server for them to be tools of. The reads they would wrap exist — they are what
the investigation checks and the SQL console already use.

An edge is drawn between two services that both send spans. A dependency on
something that sends none — a managed database, a third-party API — is visible
in the spans through `peer.service` but is not yet a node on the map.

The query compiler's refusals are in English whatever the interface language:
the filter language itself is English — its field names, its `AND`, its
`contains` — and a diagnostic half-translated around an English expression
would read worse than one that is not translated at all.
