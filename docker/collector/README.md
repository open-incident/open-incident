# Collector packs

Ready-made OpenTelemetry Collector configurations that send a machine's own
numbers to Open Incident. Point one at your instance and the services appear in
**Services** on their own — there is nothing to declare first.

Each pack takes the same two variables:

| Variable          | What it is                                                      |
| ----------------- | --------------------------------------------------------------- |
| `OI_ENDPOINT`     | The OTLP address of your instance, from **Telemetry → Connect** |
| `OI_KEY`          | An ingestion key, issued on the same screen and shown once      |
| `OI_SERVICE_NAME` | What this collector's own metrics are filed under               |
| `OI_ENVIRONMENT`  | `production`, `staging` — whatever you call them                |

| Pack                 | What it sends                                            | Run against a real one? |
| -------------------- | -------------------------------------------------------- | ----------------------- |
| `host.yaml`          | CPU, memory, load, disk, filesystem, network, paging     | Yes                     |
| `postgres.yaml`      | Connections, commits, dead rows, index hits, table sizes | Yes, PostgreSQL 17      |
| `docker.yaml`        | CPU, memory, network and block I/O per container         | Yes, Docker 29          |
| `kubernetes.yaml`    | Kubelet metrics, cluster objects, container logs         | **No** — see its header |
| `tail-sampling.yaml` | Nothing of its own: a gateway that thins traces          | Yes, all four policies  |

The last column is the point of this table. Four of these were started against
a real daemon and what they produced was read back out; the fifth was not, and
its header says so rather than letting you find out during an incident.

## Each pack brings a dashboard

`dashboards/` holds one JSON per pack — the screen that reads what the pack
sends, with the thresholds that matter for it. You do not have to import them:
the first time a pack reports, the product places its dashboard once, and
**Telemetry → Connect** has a button to place it before that. After the first
placement the dashboard belongs to the workspace — rename it, rewrite it,
delete it; it is not put back.

The files are here for the two cases that are not the product: reading a diff
of what a panel now asks, and carrying a dashboard into an instance with no
internet. They are generated from `packages/telemetry/src/packs.ts` by
`pnpm --filter @openincident/telemetry run packs:emit`, and a test fails if
they drift.

## What identifies a series

A collector puts the thing it is measuring on the **resource**, not on the
metric: `host.name` for a machine, `container.name` for a container,
`postgresql.database.name`, `postgresql.table.name` and
`postgresql.index.name` for a database, the `k8s.*` names for a cluster. Open
Incident keeps exactly those as labels (`SERIES_RESOURCE_LABELS`) and drops the
rest of the resource — `container.id`, `k8s.pod.uid`, `process.pid` change on
every restart and would make a new series each time.

One consequence for the host pack: `hostmetrics` reports numbers and no host at
all, so the pack runs `resourcedetection` and the container must be started
with `--hostname "$(hostname)"`. Without it every machine reports as its own
container id, which changes on each restart.

`tail-sampling.yaml` is the odd one — it is not a source, it is a gateway your
services export to instead of exporting to us. It holds each trace until it has
finished and then decides, which is why it can keep the ones that failed. See
**What each pack is for** below.

## The collector version is pinned, and it matters

Every pack names `otel/opentelemetry-collector-contrib:0.137.0`. Two things
found by running the older release we started with:

- The **PostgreSQL** receiver before 0.116 reads `pg_stat_bgwriter.checkpoints_req`,
  which PostgreSQL 17 removed. The result is not a missing metric, it is a
  scrape that fails every interval and sends nothing.
- The **Docker** receiver defaults to API version 1.25, which Docker 25 and
  later refuse. The collector fails to start.

Neither degrades quietly, which is the good news — but both look like "the pack
does not work" rather than "the version is wrong".

## What each pack is for

**host** — the machine's numbers beside the application's. An incident that
reads "p95 tripled" and one that reads "p95 tripled and the disk filled" are
two different investigations, and the second is over in a minute. Mount the
host's root at `/hostfs`, or the collector reports its own container's
filesystem: a disk that is always 2 % full, which is worse than no metric.

**postgres** — the metric this exists for is `postgresql.backends` against
`max_connections`. A pool that has run out is the commonest cause of an
application that is up, answering and useless, and it is invisible from the
application's own metrics, which just show everything getting slow.

**docker** — worth having beside the host pack rather than instead of it. The
host says the machine is busy; this says which container. Only the second is
actionable. Needs `--user 0` (or `--group-add` the socket's group) — the image
runs unprivileged and the socket is root's.

**kubernetes** — one collector per node for the kubelet and the logs, plus
exactly one cluster-wide for the objects. Running the second on every node
multiplies every count in the product by the size of the cluster.

**tail-sampling** — send a tenth of your traces and still have every one you
would have looked at. It judges a trace after it has finished, so the decision
can use what happened rather than a coin flipped at the first span: errors,
slow traces and anything marked `sampling.priority` are kept, plus a tenth of
the rest so the normal case still has a shape. One rule breaks it — every span
of a trace must reach the same instance, so run one replica or put a
`loadbalancing` exporter keyed on `traceID` in front of several.

Measured against the shipped file: a failed trace arrived with all three of its
spans, a 2.2 s trace arrived on latency alone, a fast trace marked
`sampling.priority` arrived, and the baseline kept 35 of 400 against the 10 % it
asks for. The same run found the gotcha now pinned in the file: a load generator
emitting sequential trace ids makes the baseline policy look broken, because it
decides by hashing the id — 0 of 50 kept with `00000000…0064`-style ids.
