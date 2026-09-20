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

Profiles, real user monitoring and the service map are later milestones. They
are absent from the screens rather than present and empty.

The query compiler's refusals are in English whatever the interface language:
the filter language itself is English — its field names, its `AND`, its
`contains` — and a diagnostic half-translated around an English expression
would read worse than one that is not translated at all.
