/**
 * What the product knows about each kind of alert source: its name, the
 * integration mark it draws, a sample payload shaped like the tool's own
 * (for the test button and the payload tester), and the setup steps.
 */
import type { AlertSourceKind } from "@openincident/db";

export type SourceKindMeta = {
  kind: AlertSourceKind;
  label: string;
  /** The tool's name on its tile and as a new source's default name — "Prometheus", not the protocol. */
  short: string;
  icon: string;
  /**
   * Where the parser reads the service, the severity and the dedup key in
   * this tool's payload — what "Advanced" shows before anybody maps anything.
   * `severity` names a field holding P1–P4 when `levels` is true.
   */
  paths: { service: string | null; severity: string | null; levels: boolean; dedup: string };
  /** How the endpoint is called: the tool posts JSON, or the payload follows our own schema. */
  mode: "tool" | "schema";
  sample: (sourceName: string, stamp: string) => unknown;
};

export const SOURCE_KINDS: SourceKindMeta[] = [
  {
    kind: "datadog",
    label: "Datadog",
    short: "Datadog",
    icon: "datadog",
    paths: {
      service: "$.scope → service:*",
      severity: "$.priority",
      levels: true,
      dedup: "$.monitor_id",
    },
    mode: "tool",
    sample: (name) => ({
      monitor_id: 999001,
      title: `[TEST] ${name} — synthetic monitor`,
      status: "Triggered",
      priority: "P3",
      scope: "service:checkout-api,env:production",
      link: "https://app.datadoghq.eu/monitors/999001",
    }),
  },
  {
    kind: "prometheus",
    label: "Prometheus / Alertmanager",
    short: "Prometheus",
    icon: "prometheus",
    paths: {
      service: "$.alerts[].labels.service",
      severity: "$.alerts[].labels.severity",
      levels: false,
      dedup: "$.alerts[].fingerprint",
    },
    mode: "tool",
    sample: (name, stamp) => ({
      alerts: [
        {
          status: "firing",
          labels: {
            alertname: "TestAlert",
            severity: "warning",
            service: "checkout-api",
            env: "production",
          },
          annotations: { summary: `[TEST] ${name} — synthetic alert` },
          fingerprint: `test-${stamp}`,
        },
      ],
    }),
  },
  {
    kind: "grafana",
    label: "Grafana",
    short: "Grafana",
    icon: "grafana",
    paths: {
      service: "$.alerts[].labels.service",
      severity: "$.alerts[].labels.severity",
      levels: false,
      dedup: "$.ruleId",
    },
    mode: "tool",
    sample: (name, stamp) => ({
      title: `[TEST] ${name} — synthetic rule`,
      state: "alerting",
      ruleId: `test-${stamp}`,
      ruleUrl: "https://grafana.example.com/alerting/list",
    }),
  },
  {
    kind: "sentry",
    label: "Sentry",
    short: "Sentry",
    icon: "sentry",
    paths: {
      service: "$.data.event.tags → service",
      severity: "$.data.issue.level",
      levels: false,
      dedup: "$.data.issue.id",
    },
    mode: "tool",
    sample: (name) => ({
      action: "created",
      data: {
        issue: {
          id: `test-${Date.now()}`,
          title: `[TEST] ${name} — synthetic issue`,
          level: "error",
        },
        event: {
          tags: [
            ["environment", "production"],
            ["service", "checkout-api"],
          ],
        },
      },
    }),
  },
  {
    kind: "cloudwatch",
    label: "Amazon CloudWatch",
    short: "CloudWatch",
    icon: "cloudwatch",
    paths: { service: null, severity: null, levels: false, dedup: "$.Message.AlarmArn" },
    mode: "tool",
    sample: (name) => ({
      Message: JSON.stringify({
        AlarmName: `[TEST] ${name}`,
        NewStateValue: "ALARM",
        AlarmArn: `arn:test:${Date.now()}`,
        Region: "EU (Paris)",
      }),
    }),
  },
  {
    kind: "uptime_kuma",
    label: "Uptime Kuma",
    short: "Uptime Kuma",
    icon: "uptime_kuma",
    paths: { service: null, severity: null, levels: false, dedup: "$.monitor.id" },
    mode: "tool",
    sample: (name) => ({
      heartbeat: { status: 0, msg: "synthetic down" },
      monitor: { id: `test-${Date.now()}`, name: `[TEST] ${name}`, url: "https://example.com" },
    }),
  },
  {
    kind: "http",
    label: "HTTP / webhook",
    short: "HTTP",
    icon: "webhook",
    paths: { service: "$.service", severity: "$.priority", levels: true, dedup: "$.dedup_key" },
    mode: "schema",
    sample: (name, stamp) => ({
      title: `[TEST] ${name} — synthetic alert`,
      description: "Anything that can POST JSON becomes a source.",
      status: "firing",
      priority: "P3",
      service: "checkout-api",
      environment: "production",
      dedup_key: `test-${stamp}`,
      url: "https://example.com/alerts/1",
    }),
  },
];

export const sourceKindMeta = (kind: string): SourceKindMeta =>
  SOURCE_KINDS.find((k) => k.kind === kind) ?? SOURCE_KINDS[SOURCE_KINDS.length - 1]!;

/** The command that sends a first alert to a source — the endpoint and the header the tool must set. */
export function curlSnippet(endpoint: string, kind: AlertSourceKind): string {
  const body =
    kind === "http"
      ? `{"title":"First alert","status":"firing","priority":"P2","service":"checkout-api","environment":"production","dedup_key":"first-alert"}`
      : JSON.stringify(sourceKindMeta(kind).sample("first alert", "1"));
  return `curl -X POST ${endpoint} \\\n  -H "x-oi-secret: <secret>" -H "Content-Type: application/json" \\\n  -d '${body}'`;
}
