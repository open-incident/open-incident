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
the host's own numbers, PostgreSQL, Docker containers, Kubernetes, and a tail
sampler. Each takes the endpoint and a key and nothing else, and the services it
finds appear in **Services** on their own. They are listed on
**Telemetry → Connect**, beside the key they need.

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

## Mobile applications

Two SDKs in [`sdk/`](../../sdk): a Swift package for iOS 13+ and an Android
library for API 21+. Neither has a dependency — the Android one uses `org.json`
and `HttpURLConnection` from the platform, so adding it cannot drag a second
copy of OkHttp into your app, and the released library is 27 kB.

They send to the same endpoint the browser SDK does and land in the same
tables, so an application and a website appear side by side on **RUM**.

**A RUM application has to accept mobile applications first**, on
**Settings → Observability**, and it is off until somebody turns it on. That is
a switch rather than a default because it costs something real: a browser is
made to send an `Origin` it cannot forge, and that header is what stands in for
a credential when the application id is public. An app sends none, so accepting
one means accepting that the id is a **public write-only token** — anybody who
pulls your binary apart can read it and post events to that application. Every
mobile RUM SDK works this way; the difference here is that you read the
sentence before it is true of your workspace rather than after.

What it measures:

|                                         |                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_start`                             | From the moment the process began — not from when the SDK started, by which point the expensive part is over — to the first frame. Rated against 2 s and 5 s.     |
| `screen_load`                           | Between two `screen()` calls, counted once per screen. A screen somebody sat on for four minutes is not a four-minute load. Rated against 1 s and 2.5 s.          |
| Sessions                                | Resumed after up to fifteen minutes of silence, then a new one. The sampling draw is taken once per session and kept, so a visit is reported whole or not at all. |
| Screens, actions, errors, network calls | One line each, at the place that knows about them.                                                                                                                |

Two things neither SDK does, written here rather than discovered later.

**Neither captures crashes.** Doing it properly means signal handlers and a
Mach exception port on iOS, a report written to disk and replayed on the next
launch, and symbolication — a subsystem, not a feature. An SDK that claims
crash reporting and delivers a `try`/`catch` is worse than one that says it has
none, because somebody stops looking for a real one.

**Neither intercepts your networking.** Both take a `resource(...)` call
instead. Interception means a `URLProtocol` re-issuing every request through a
session of ours, or an interceptor in an OkHttp client we do not own, which
changes uploads, streaming and background transfers in an application nobody
here can test. A line of code per call site is the better half of that trade.

## Session replay

Sometimes the numbers do not settle the argument. A p75 LCP of 3.1 s says the
page was slow; a recording says the spinner ran twice because the retry fired
before the first response landed. Only one of those ends a meeting.

Turn it on per application, under **Settings → Observability**. It is off until
somebody turns it on, and a new application is created off, because a replay is
a copy of what a visitor saw and that is a different promise from a page-load
timing.

**Everything is masked until you say otherwise.** Every text node, every input.
Canvas is never recorded at all — on a real site that is photographs,
signatures and scanned documents, and nobody switching on "session replay" is
agreeing to those. You name CSS selectors whose contents are safe to show, and
only those come through as themselves. That order is the one that is safe to
get wrong: a field somebody forgot to mask is a leak, where a field somebody
forgot to un-mask is a recording that is harder to read. The workspace's scrub
rules are applied to the recording as well, before it is stored — and if a rule
mangles the recording into something unparseable the chunk is refused rather
than stored unscrubbed, because "store it raw instead" would put back the exact
text the rule exists to remove.

A few things worth knowing about how it behaves:

- **The recorder is a separate file.** The base SDK is 6 kB over the wire and
  loads on every page; the recorder is 56 kB and is fetched only by pages of an
  application that has replay on. It is built from a pinned rrweb — the library
  PostHog, Highlight and OpenReplay all record with — because a homegrown DOM
  recorder gets shadow DOM, adopted stylesheets and web components subtly
  wrong, and "the replay looks wrong" is worse than no replay.
- **The decision is taken once per session, not per page.** Half a session
  reads as a visitor who left.
- **Recording has its own rate.** A replay costs a hundred times a vitals
  beacon, so wanting every session's numbers is not wanting every session's
  DOM. The default is one session in ten of those already sampled.
- **It is sent in chunks, cut on bytes.** A session has no end a browser can
  predict — the visitor closes the tab — so a recording written only at the end
  is a recording usually never written. The cut is on size rather than on a
  count of events because `sendBeacon`, which carries the last chunk after the
  page is gone, silently refuses a body over about 64 kB.
- **It expires with your RUM retention**, by the same mechanism as everything
  else. The recordings live in the column store rather than in a bucket for
  exactly that reason: a chunk in a bucket expires from the index and stays in
  the bucket, which is the failure where somebody's recordings outlive the
  retention their workspace was promised.

On the **Sessions** list a recorded session carries a dot; opening it offers
**Play the recording**, and nothing is downloaded until you press it.

## Keeping fewer traces without losing the ones you need

Two different things thin a trace stream, they sit in different places, and
only one of them is a choice you make about quality.

**Tail sampling** is the one worth having. `docker/collector/tail-sampling.yaml`
is a gateway your services export to instead of exporting to us. It holds each
trace until it is finished and then decides, so the decision can use what
happened: anything that failed is kept, anything slow is kept, anything a span
marked `sampling.priority` is kept, and a tenth of the rest goes through so the
normal case still has a shape to compare against. That is the opposite of
`parentbased_traceidratio` in an SDK, which flips its coin at the first span
and therefore throws away nine of every ten broken traces along with nine of
every ten boring ones.

One rule breaks it: every span of a trace must reach the same collector
instance. Two replicas behind a round-robin balancer each see half of every
trace and each decide on half the evidence. Run one, or put a `loadbalancing`
exporter keyed on `traceID` in front of several. Measured on the shipped file:
a failed trace arrived with all three of its spans, a 2.2 s trace arrived on
latency alone, and the baseline policy kept 35 of 400 against the 10 % it is
set to.

**The daily cap** is the other one, and it is not a quality decision — it is a
budget guard, set on **Settings → Observability**. Past it logs and traces are
thinned rather than refused, and three rules make that survivable: errors are
never thinned, a trace is kept whole or not at all, and the share kept falls as
the day goes on rather than stopping at a cliff. Sending ten times the cap
stores about three times it, not ten. Metrics are never thinned at all — a
chart with holes lies, where a thinner log stream only says less.

Nothing about it is silent. The sender is told in OTLP's own partial-success
field, so the exporter logs the reason, and the **Telemetry** screen carries the
share alongside the day's count.

One limit worth knowing: each kept span records what it stands for — a row kept
at one in four carries a weight of four, and an error carries one because none
of its kind were dropped — but **no screen weights by it today**. While a
workspace is over its cap, a count on screen is a count of what was stored, not
an estimate of what happened. The thinning is recoverable from the data; it is
not yet recovered.

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

## Prometheus remote write

A great many installations already run Prometheus, and asking them to replace
it before they can try this is asking them not to try it. `/api/v1/write`
accepts remote write, both 1.0 and 2.0, so one block of configuration sends
their existing scrapes here as well and they keep everything they have:

```yaml
remote_write:
  - url: https://otlp.<your workspace host>/api/v1/write
    headers:
      x-oi-key: <the ingestion key>
```

The path is not one we chose — it is what a `remote_write` block appends to
whatever URL it is given.

Three things about the mapping, all of them stated rather than guessed:

- **`job` becomes the service, and stays a label.** Every dashboard and alert a
  Prometheus user already has says `job="…"`, and dropping the label because we
  had used it for something else would make all of them return nothing,
  silently. A series with no `job` at all is refused rather than filed under a
  made-up name.
- **Everything arrives as a gauge**, unless the sender says otherwise. 1.0
  carries no type at all, and Prometheus 3.5 sends an empty metadata message on
  every series in 2.0. Guessing from the name would be worse: `_total` is
  usually a counter and sometimes is not, and storing a gauge as a counter
  makes `rate()` invent resets that never happened. `rate()` and `increase()`
  read these series correctly either way.
- **`NaN` is dropped.** It is how Prometheus marks a series stale, not a
  measurement, and storing it would draw a gap as a zero.

The endpoint answers the way Prometheus expects: 204 with no body, 400 for a
body it cannot read — which it will not retry — and 503 for a store that is
briefly away, which it will, holding the samples in its write-ahead log
meanwhile. Answering 500 there loses them.

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

## Real user monitoring

What a browser sees, which is the one thing the rest of the telemetry cannot
say. A p95 of 40 ms at the edge and a page that takes four seconds to become
usable are both true at once, and only this knows the second.

Create an application under **Settings → Observability**, then paste what it
gives you:

```html
<script
  src="https://<your instance>/rum/oi-rum.js"
  data-app="<application id>"
  data-endpoint="https://otlp.<your workspace host>"
  defer
></script>
```

The application id is **public by construction** — anything in a page is — so
it is not a credential and is not treated as one. What keeps somebody else's
site out of your table is the list of origins you name: the browser sends its
`Origin`, it cannot forge it, and an application with no origins accepts
nothing. An unknown id and a disallowed origin are refused with the same
answer, so the ids cannot be enumerated.

### What is never stored

This is the one table in the product holding something about a person who never
agreed to anything — a visitor to a customer's site, who has no account here
and never will. Two things follow and neither is negotiable at read time,
because by then the row exists:

- **The address is never stored.** The country is taken from whatever the proxy
  in front resolved; the address itself is not read. An IP is the field that
  makes a row about a person rather than about a page.
- **The user is hashed with the workspace's own salt** and the value thrown
  away. Enough to say "one person hit this forty times", never enough to say
  who — and the same visitor on two customers' sites is two different hashes,
  so the tables cannot be joined against each other.

### What the SDK does, and does not

It never throws into the host page and never delays anything. Every observer
and handler is wrapped; a failure costs its own measurement and nothing else.
Events are buffered and flushed on a timer, on visibility change and on
pagehide, with `sendBeacon` where it exists.

Sampling is decided **once per session**, in the browser. Sampling events
independently gives half a session, which is worse than none: a timeline with
holes reads as a page that stopped rather than one that was not recorded. And a
session that is not sampled costs the visitor nothing, where taking everything
and dropping some here would make them pay for data we throw away.

LCP, CLS and INP are reported only when the page goes away, because that is
when they are final — LCP keeps growing, CLS keeps shifting and INP keeps
getting worse until then. They therefore travel by beacon and by nothing else,
which is why the endpoint answers `Access-Control-Allow-Credentials`:
`sendBeacon` always sends in credentials mode `include`, with no way to ask it
not to, and without that header the browser refuses the response before reading
it. The symptom was a table with every event in it except the three that
matter, and nothing in any log, because the request never left the browser.

Every figure on the screen is a **p75**. An average page load is a number no
visitor experienced — dragged down by cached repeat visits, hiding the
first-time visitor on a phone who is the one deciding whether to come back. It
is also what Google's thresholds are defined against, so a "good" here means
what it means in every other tool.

## Profiles

Send a pprof and a flamegraph appears. Every Go, Java, Python and Rust
profiler already writes that format, which is why it is the one this accepts
rather than a shape of our own:

```
go tool pprof -proto http://localhost:6060/debug/pprof/profile?seconds=30 > cpu.pprof
curl -X POST '<endpoint>/v1/profiles?service=checkout-api' \
  -H 'x-oi-key: <your key>' --data-binary @cpu.pprof
```

Pyroscope's path works too — `POST /ingest?name=checkout-api.cpu{env=prod}` —
so an agent you already run needs one line changed rather than a new one
installed.

**A pprof is not one profile.** A Go heap profile carries four kinds and a CPU
profile two, and every one of them is stored under its own type: picking one
made a heap upload draw an empty flamegraph, because the last column is
`inuse_space` and a service that frees what it allocates has nothing there
while the two beside it hold everything. Columns that are zero all the way down
are dropped, and a column counting samples loses to the one measuring a
quantity.

Frames keep their `file:line` — it is what tells you _where_ in a function the
time went — but the graph and the table fold by **function**. A hot loop spread
over four lines of assembly was four rows of ten per cent each, and the one
fact anybody wanted, that the routine is a third of the profile, was nowhere on
the screen.

The table gives **self** and **total** because they answer different questions:
self finds the function burning the time, total finds the one that _causes_ it
— often three frames up, and the only one anybody can change. A function
appearing twice in one stack counts once towards its total, or recursion would
give it a total larger than the profile.

### The diff

The flamegraph answers "where is the time going", which a person can usually
guess. The diff answers "what changed", which nobody can.

Two things make it honest. It compares **shares** of each window's total rather
than raw values, because two windows never carry the same load and reading
twice the traffic as a regression is the commonest mistake made with these. And
it reports **both** self and total, because a change that moves work between
callers leaves every self time exactly where it was: making a health check call
the same expensive hash forty times more often shifts nothing in the hash
itself. In a real run of exactly that change, the caller moved sixty points of
total while its self time did not move at all — and the first version of this
diff, ranked on self alone, showed nothing.

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

## Syslog and Fluent

A load balancer, a firewall, a database, a switch, sshd — none of them will
ever carry an OpenTelemetry SDK, and all of them emit syslog. Accepting it is
the difference between "the logs of the services somebody instrumented" and
"the logs", and during an incident the line that explains everything is as
likely to come from the proxy as from the code.

Both dialects are read, over TCP and UDP. RFC 5424 is the one with structured
data and a real timestamp; RFC 3164 is the one from the eighties that most
hardware still sends, whose date carries no year and no timezone — refusing it
would refuse most of what actually arrives. Severities are mapped onto the same
scale everything else uses, so a firewall's WARN sorts with an application's.
The app-name becomes the service, because that is what syslog has that means
"which thing wrote this".

**The port is the credential.** Syslog has no header to put a key in and no
handshake; a sender opens a socket and writes. So one port belongs to one
workspace, named when the listener is configured:

```
OI_SYSLOG_PORT=5514
OI_SYSLOG_KEY=oi_…
```

Off unless both are set. An open syslog port that files everything under
whichever workspace happens to be first is the kind of default that is
discovered by reading somebody else's logs.

**Fluent Bit** posts to `/v1/fluent` with its HTTP output, which is one line of
its configuration — `Name http` instead of `Name forward`. Its records have no
schema, so the mapping is stated rather than guessed: `log`, `message`, `msg`,
`short_message` or `MESSAGE` is the body; `level` or `severity` the severity;
the tag names the service. Everything else becomes an attribute, with one level
of nesting flattened — a Kubernetes filter puts the namespace, pod and
container inside an object, and stringifying it whole makes "which pod" a
question nobody can filter on.

A batch whose records carry no recognisable message is answered **422**, not 200. The commonest cause is a parser putting the message under a key this does
not know, and a green output plugin beside an empty screen is the worst
possible pair of signals.

## Log patterns

The Logs screen has two modes. **Stream** is the lines. **Patterns** is the
same lines folded into the shapes they take, and it is the mode that makes the
screen usable at real volume: ten thousand rows reading `user 4821 not found`
are one thing that happened, and one row saying so with a count is a bug report
where ten thousand are noise.

The same idea as the exception fingerprint, applied to logs — numbers,
identifiers, paths and URLs are replaced, and what is left is the shape. The
fold runs in the column store rather than here, which is the only way it
scales: folding a million lines means reading a million lines, and doing that
in the application is a million rows over the wire to throw away.

Clicking a pattern narrows the stream to it, using the longest literal run
between the placeholders. Below four characters there is no run worth
filtering on and the row simply returns to the stream — a filter that matched
half of it would be worse than none.

## Filtering, saving, and watching

Logs, Traces and Exceptions each take a filter, and it is the **same one-line
language the monitors take**: `field = value`, joined by `AND`, with
`contains` for a substring, `=~` for a regular expression and `attr:<name>` to
reach an attribute. One compiler serves both, so a filter that behaves one way
in the explorer cannot behave another way in the alert.

That is what makes the last button on the bar honest. **Watch this** opens the
monitor form with the type already chosen and the exact text already in the
box: the thing being alerted on is the thing that was just looked at, not a
re-interpretation of it.

A filter lives in the address, so a narrowed view is a link somebody can paste
into an incident. **Saving** it puts it beside the box for next time — per
workspace and not per person, because the value of "the query that found last
month's outage" is that the next person on call can find it. A saved query is
compiled before it is stored: a bookmark to a failure is worse than no
bookmark, and the moment to say so is while its author still remembers what
they meant.

A filter naming a field we do not have is refused by name, with the list of the
ones we do — the same refusal, word for word, that the monitor form gives.

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

Session replay, queue-based sampling, syslog and Fluent reception, mobile RUM
and log patterns are later milestones. They are absent from the screens rather
than present and empty.

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
