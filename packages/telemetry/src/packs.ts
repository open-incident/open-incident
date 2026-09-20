/**
 * The collector packs' dashboards — one per pack, ready to place.
 *
 * A pack is a collector configuration we ship (docker/collector/*.yaml). It
 * takes two minutes to run and then a workspace has hundreds of series and no
 * screen that reads them: `system.cpu.utilization{state="idle"}` is not what
 * anybody wants to type at three in the morning. These are the screens, built
 * on the labels the packs really produce — every query here was run against a
 * live collector before it was written down.
 *
 * Titles are English. A package has no access to the translation dictionaries,
 * which live in apps/web/src/i18n (the same note is on packages/mail), and a
 * dashboard's title is data a workspace can rename — unlike the interface
 * around it, which is translated.
 *
 * The queries stay inside the published PromQL subset, and one limit of it
 * shapes several of them: a binary operator between two vectors is refused, so
 * a ratio is written as a scalar against one aggregation rather than as a
 * division of two. `100 * (1 - avg by (host.name) (…{state="idle"}))` is that
 * rule, not a stylistic choice.
 */
import { clickhouse } from "./client";
import { read } from "./query";

export type PackPanel = {
  id: string;
  title: string;
  query: string;
  type: "line" | "area" | "stat";
  unit: string;
  w: number;
  h: number;
  /** The value past which the panel is a problem, drawn as a rule. */
  threshold?: number;
};

export type PackId = "host" | "postgres" | "docker" | "kubernetes";

export type Pack = {
  id: PackId;
  title: string;
  description: string;
  /**
   * Metrics whose presence means this pack's collector is reporting.
   *
   * One name is enough, and it has to be one only this receiver emits:
   * `container.cpu.utilization` comes from docker_stats and from kubeletstats
   * both, so the Docker pack is recognised by `container.memory.percent`,
   * which only docker_stats sends.
   */
  signals: string[];
  panels: PackPanel[];
};

/* Panel sizes: the grid is twelve columns wide. */
const FULL = 12;
const HALF = 6;
const THIRD = 4;

export const PACKS: Pack[] = [
  {
    id: "host",
    title: "Hosts",
    description:
      "CPU, memory, disks and network of the machines running the host pack. Read beside an application's own numbers: “p95 tripled” and “p95 tripled and the disk filled” are two different investigations.",
    signals: ["system.cpu.utilization", "system.memory.utilization"],
    panels: [
      {
        id: "cpu-now",
        title: "CPU in use",
        // Busy is what is left of idle. Averaged over cores and hosts, which
        // is the number a stat panel can honestly show; the chart below it
        // splits by machine.
        query: '100 * (1 - avg(system.cpu.utilization{state="idle"}))',
        type: "stat",
        unit: "%",
        w: THIRD,
        h: 120,
        threshold: 85,
      },
      {
        id: "mem-now",
        title: "Memory in use",
        query: '100 * max(system.memory.utilization{state="used"})',
        type: "stat",
        unit: "%",
        w: THIRD,
        h: 120,
        threshold: 90,
      },
      {
        id: "load-now",
        title: "Load, 1 min",
        query: "max(system.cpu.load_average.1m)",
        type: "stat",
        unit: "",
        w: THIRD,
        h: 120,
      },
      {
        id: "cpu-by-host",
        title: "CPU per machine",
        query: '100 * (1 - avg by (host.name) (system.cpu.utilization{state="idle"}))',
        type: "line",
        unit: "%",
        w: HALF,
        h: 160,
        threshold: 85,
      },
      {
        id: "mem-by-host",
        title: "Memory per machine",
        query: '100 * sum by (host.name) (system.memory.utilization{state="used"})',
        type: "line",
        unit: "%",
        w: HALF,
        h: 160,
        threshold: 90,
      },
      {
        id: "disk-full",
        title: "Fullest filesystems",
        // Five, because a machine has a dozen mount points and eleven of them
        // never move. The threshold is where a database starts refusing
        // writes, not where somebody would like to be warned.
        query: "100 * topk(5, max by (host.name, mountpoint) (system.filesystem.utilization))",
        type: "line",
        unit: "%",
        w: HALF,
        h: 160,
        threshold: 90,
      },
      {
        id: "load-by-host",
        title: "Load average, 1 min",
        query: "max by (host.name) (system.cpu.load_average.1m)",
        type: "line",
        unit: "",
        w: HALF,
        h: 160,
      },
      {
        id: "net-io",
        title: "Network, bytes per second",
        query: "sum by (host.name, direction) (rate(system.network.io[5m]))",
        type: "area",
        unit: "B/s",
        w: HALF,
        h: 160,
      },
      {
        id: "disk-io",
        title: "Disk, bytes per second",
        query: "sum by (host.name, direction) (rate(system.disk.io[5m]))",
        type: "area",
        unit: "B/s",
        w: HALF,
        h: 160,
      },
      {
        id: "swap",
        title: "Swapping, operations per second",
        // Not "how much swap is allocated": allocated swap that is never
        // touched costs nothing. Paging in and out is the symptom.
        query: "sum by (host.name, direction) (rate(system.paging.operations[5m]))",
        type: "line",
        unit: "/s",
        w: HALF,
        h: 160,
        threshold: 100,
      },
      {
        id: "net-errors",
        title: "Network errors and drops",
        query: "sum by (host.name) (rate(system.network.errors[5m]))",
        type: "line",
        unit: "/s",
        w: HALF,
        h: 160,
        threshold: 1,
      },
    ],
  },

  {
    id: "postgres",
    title: "PostgreSQL",
    description:
      "Connections, transactions, cache and table sizes, per database. The postgresql pack reports one resource per database, per table and per index — so these panels group by the name rather than by the server.",
    signals: ["postgresql.backends", "postgresql.commits"],
    panels: [
      {
        id: "backends",
        title: "Open connections",
        query: "sum(postgresql.backends)",
        type: "stat",
        unit: "",
        w: THIRD,
        h: 120,
      },
      {
        id: "commits-now",
        title: "Commits per second",
        query: "sum(rate(postgresql.commits[5m]))",
        type: "stat",
        unit: "/s",
        w: THIRD,
        h: 120,
      },
      {
        id: "rollbacks-now",
        title: "Rollbacks per second",
        // A rollback is not an error, and a steady stream of them is: an
        // application that retries a failing transaction looks exactly like
        // this and nothing else does.
        query: "sum(rate(postgresql.rollbacks[5m]))",
        type: "stat",
        unit: "/s",
        w: THIRD,
        h: 120,
        threshold: 1,
      },
      {
        id: "backends-by-db",
        title: "Connections per database",
        query: "sum by (postgresql.database.name) (postgresql.backends)",
        type: "line",
        unit: "",
        w: HALF,
        h: 160,
      },
      {
        id: "commits-by-db",
        title: "Commits per second, per database",
        query: "sum by (postgresql.database.name) (rate(postgresql.commits[5m]))",
        type: "line",
        unit: "/s",
        w: HALF,
        h: 160,
      },
      {
        id: "rollbacks-by-db",
        title: "Rollbacks per second, per database",
        query: "sum by (postgresql.database.name) (rate(postgresql.rollbacks[5m]))",
        type: "line",
        unit: "/s",
        w: HALF,
        h: 160,
      },
      {
        id: "rows",
        title: "Rows per second, by what happened to them",
        query: "sum by (state) (rate(postgresql.rows[5m]))",
        type: "line",
        unit: "/s",
        w: HALF,
        h: 160,
      },
      {
        id: "blocks",
        title: "Blocks read per second, from disk and from cache",
        // `source` separates the two. A heap_read that climbs while
        // heap_hit does not is a cache that stopped holding the working set.
        query: "sum by (source) (rate(postgresql.blocks_read[5m]))",
        type: "line",
        unit: "/s",
        w: HALF,
        h: 160,
      },
      {
        id: "db-size",
        title: "Database size",
        query: "sum by (postgresql.database.name) (postgresql.db_size)",
        type: "area",
        unit: "B",
        w: HALF,
        h: 160,
      },
      {
        id: "biggest-tables",
        title: "Biggest tables",
        query: "topk(8, max by (postgresql.table.name) (postgresql.table.size))",
        type: "line",
        unit: "B",
        w: HALF,
        h: 160,
      },
      {
        id: "operations",
        title: "Table operations per second",
        query: "sum by (operation) (rate(postgresql.operations[5m]))",
        type: "line",
        unit: "/s",
        w: HALF,
        h: 160,
      },
      {
        id: "bgwriter",
        title: "Buffers written per second, by who wrote them",
        // When `backend` overtakes `background_writer`, the checkpointer is
        // behind and queries are paying for it.
        query: "sum by (source) (rate(postgresql.bgwriter.buffers.writes[5m]))",
        type: "line",
        unit: "/s",
        w: HALF,
        h: 160,
      },
    ],
  },

  {
    id: "docker",
    title: "Containers",
    description:
      "CPU, memory, network and block I/O per container, from the Docker pack. One series per container name — a container id changes on every deploy and a chart keyed on it starts from nothing each time.",
    signals: ["container.memory.percent"],
    panels: [
      {
        id: "count",
        title: "Containers reporting",
        query: "count(container.cpu.utilization)",
        type: "stat",
        unit: "",
        w: THIRD,
        h: 120,
      },
      {
        id: "cpu-top",
        title: "Busiest container",
        query: "max(container.cpu.utilization)",
        type: "stat",
        unit: "%",
        w: THIRD,
        h: 120,
        threshold: 90,
      },
      {
        id: "mem-top",
        title: "Closest to its memory limit",
        query: "max(container.memory.percent)",
        type: "stat",
        unit: "%",
        w: THIRD,
        h: 120,
        threshold: 90,
      },
      {
        id: "cpu-by-container",
        title: "CPU per container",
        query: "topk(8, max by (container.name) (container.cpu.utilization))",
        type: "line",
        unit: "%",
        w: HALF,
        h: 160,
        threshold: 90,
      },
      {
        id: "mem-by-container",
        title: "Memory against the limit, per container",
        // Against the limit, not in bytes: a container at 98 % of 128 MiB is
        // about to be killed and one at 4 GiB of 32 may be perfectly well.
        query: "topk(8, max by (container.name) (container.memory.percent))",
        type: "line",
        unit: "%",
        w: HALF,
        h: 160,
        threshold: 90,
      },
      {
        id: "mem-bytes",
        title: "Memory used, per container",
        query: "topk(8, max by (container.name) (container.memory.usage.total))",
        type: "area",
        unit: "B",
        w: HALF,
        h: 160,
      },
      {
        id: "net-rx",
        title: "Network in, bytes per second",
        query: "sum by (container.name) (rate(container.network.io.usage.rx_bytes[5m]))",
        type: "line",
        unit: "B/s",
        w: HALF,
        h: 160,
      },
      {
        id: "net-tx",
        title: "Network out, bytes per second",
        query: "sum by (container.name) (rate(container.network.io.usage.tx_bytes[5m]))",
        type: "line",
        unit: "B/s",
        w: HALF,
        h: 160,
      },
      {
        id: "net-dropped",
        title: "Packets dropped per second",
        query: "sum by (container.name) (rate(container.network.io.usage.rx_dropped[5m]))",
        type: "line",
        unit: "/s",
        w: HALF,
        h: 160,
        threshold: 1,
      },
      {
        id: "block-io",
        title: "Block I/O, bytes per second",
        query:
          "sum by (container.name, operation) (rate(container.blockio.io_service_bytes_recursive[5m]))",
        type: "area",
        unit: "B/s",
        w: FULL,
        h: 160,
      },
    ],
  },

  {
    id: "kubernetes",
    title: "Kubernetes",
    description:
      "Nodes, pods and containers from the Kubernetes pack — kubeletstats for what is running, k8s_cluster for what the API server thinks should be. Restarts and pending pods are the two that answer “is it the app or the cluster”.",
    signals: ["k8s.pod.phase", "k8s.node.condition_ready"],
    panels: [
      {
        id: "nodes-ready",
        title: "Nodes ready",
        query: "sum(k8s.node.condition_ready)",
        type: "stat",
        unit: "",
        w: THIRD,
        h: 120,
      },
      {
        id: "pods-running",
        title: "Pods running",
        // Phase 2 is Running in the receiver's encoding; 1 is Pending.
        query: "count(k8s.pod.phase == 2)",
        type: "stat",
        unit: "",
        w: THIRD,
        h: 120,
      },
      {
        id: "restarts",
        title: "Container restarts",
        query: "sum(k8s.container.restarts)",
        type: "stat",
        unit: "",
        w: THIRD,
        h: 120,
        threshold: 1,
      },
      {
        id: "cpu-by-node",
        title: "CPU used per node, cores",
        query: "sum by (k8s.node.name) (k8s.node.cpu.usage)",
        type: "line",
        unit: "cores",
        w: HALF,
        h: 160,
      },
      {
        id: "mem-by-node",
        title: "Memory used per node",
        query: "sum by (k8s.node.name) (k8s.node.memory.usage)",
        type: "area",
        unit: "B",
        w: HALF,
        h: 160,
      },
      {
        id: "cpu-by-pod",
        title: "CPU used per pod, cores",
        query: "topk(8, sum by (k8s.pod.name) (k8s.pod.cpu.usage))",
        type: "line",
        unit: "cores",
        w: HALF,
        h: 160,
      },
      {
        id: "mem-by-pod",
        title: "Memory used per pod",
        query: "topk(8, sum by (k8s.pod.name) (k8s.pod.memory.usage))",
        type: "line",
        unit: "B",
        w: HALF,
        h: 160,
      },
      {
        id: "restarts-by-pod",
        title: "Restarts per pod",
        // A pod that restarts twice an hour is not down and will not page
        // anybody; it is also the single most common shape of a real outage
        // in Kubernetes.
        query: "topk(8, max by (k8s.pod.name) (k8s.container.restarts))",
        type: "line",
        unit: "",
        w: HALF,
        h: 160,
        threshold: 1,
      },
      {
        id: "pods-by-namespace",
        title: "Pods per namespace",
        query: "count by (k8s.namespace.name) (k8s.pod.phase)",
        type: "line",
        unit: "",
        w: HALF,
        h: 160,
      },
      {
        id: "net-by-pod",
        title: "Pod network, bytes per second",
        query: "topk(8, sum by (k8s.pod.name) (rate(k8s.pod.network.io[5m])))",
        type: "area",
        unit: "B/s",
        w: FULL,
        h: 160,
      },
    ],
  },
];

/**
 * A pack as a file: the dashboard, plus which pack it came from.
 *
 * `version` is there so a file carried between instances can be read by a
 * build that knows more panels than the one that wrote it — and refused by one
 * that knows fewer, instead of dropping the fields it does not recognise.
 */
export type PackDocument = {
  version: 1;
  pack: PackId;
  title: string;
  description: string;
  signals: string[];
  panels: PackPanel[];
};

export function packDocument(pack: Pack): PackDocument {
  return {
    version: 1,
    pack: pack.id,
    title: pack.title,
    description: pack.description,
    signals: pack.signals,
    panels: pack.panels,
  };
}

/**
 * Which packs are reporting, from the series catalogue rather than the points.
 *
 * `metric_series` holds one row per series with a `last_seen`, so this is a
 * few rows read by name — not a scan of a day of measurements. The window is
 * generous on purpose: a pack that reported this morning and whose collector
 * is restarting has not stopped being installed.
 */
export async function packsReporting(tenantId: string, withinHours = 24): Promise<PackId[]> {
  const names = allPackSignals();
  const rows = await read<{ metric_name: string }>(
    tenantId,
    `SELECT DISTINCT metric_name
       FROM metric_series_t(tenant = {tenant:UUID})
      WHERE metric_name IN {names:Array(String)}
        AND last_seen > now() - INTERVAL {hours:UInt32} HOUR`,
    { params: { names, hours: withinHours }, maxRows: 100 },
  );
  const seen = new Set(rows.map((r) => r.metric_name));
  return PACKS.filter((p) => p.signals.some((s) => seen.has(s))).map((p) => p.id);
}

/**
 * The same question for every workspace at once: who is reporting which pack.
 *
 * One query across tenants — the raw catalogue, not the parameterised view,
 * for the reason `tenantsWithData` gives: a view that makes a missing tenant
 * filter impossible cannot express a deliberate sweep across all of them. The
 * sweep that places dashboards runs on this rather than on one query per
 * workspace per tick, which is the shape that once made this product read a
 * hundred queries a minute for nothing.
 */
export async function tenantsReportingPacks(withinHours = 24): Promise<Map<string, PackId[]>> {
  const names = allPackSignals();
  const rs = await clickhouse().query({
    query: `SELECT DISTINCT toString(tenant_id) AS tenant, metric_name
              FROM metric_series
             WHERE metric_name IN {names:Array(String)}
               AND last_seen > now() - INTERVAL {hours:UInt32} HOUR`,
    query_params: { names, hours: withinHours },
    format: "JSONEachRow",
  });
  const rows = await rs.json<{ tenant: string; metric_name: string }>();
  const byTenant = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byTenant.get(r.tenant) ?? new Set<string>();
    set.add(r.metric_name);
    byTenant.set(r.tenant, set);
  }
  const out = new Map<string, PackId[]>();
  for (const [tenant, seen] of byTenant) {
    const packs = PACKS.filter((p) => p.signals.some((s) => seen.has(s))).map((p) => p.id);
    if (packs.length > 0) out.set(tenant, packs);
  }
  return out;
}

export function packById(id: string): Pack | null {
  return PACKS.find((p) => p.id === id) ?? null;
}

/** Every metric that identifies any pack — one query answers "which packs are reporting". */
export function allPackSignals(): string[] {
  return [...new Set(PACKS.flatMap((p) => p.signals))];
}
