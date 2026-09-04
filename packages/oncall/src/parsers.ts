/**
 * Payload parsers — one per source kind. Each turns what a monitoring tool
 * posts into the same shape; the raw payload is kept as received. A parser
 * never throws on an odd payload: it falls back to the generic reading.
 */
import type { AlertSourceKind, AttributeMapping } from "@openincident/db";

export type ParsedAlert = {
  title: string;
  description: string | null;
  status: "firing" | "resolved";
  dedupKey: string;
  externalUrl: string | null;
  /** Attributes read from the payload before the source's mappings apply. */
  attributes: Record<string, string>;
  /** The slice of the payload this alert came from (Alertmanager batches). */
  payload: unknown;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Reads a dot path ("labels.service", "alerts.0.status") out of a payload. */
export function readPath(payload: unknown, path: string): unknown {
  let cur: unknown = payload;
  for (const seg of path.replace(/^\$\.?/, "").split(".")) {
    if (!seg) continue;
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[seg];
    else return undefined;
  }
  return cur;
}

function flattenStrings(o: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    const s = str(v);
    if (s) out[prefix + k] = s;
  }
  return out;
}

function generic(payload: unknown): ParsedAlert {
  const p = obj(payload);
  const title = str(p.title) ?? str(p.summary) ?? str(p.name) ?? str(p.message) ?? "Alert";
  const rawStatus = (str(p.status) ?? str(p.state) ?? "firing").toLowerCase();
  const status: "firing" | "resolved" = /resolved|ok|recovered|closed|up/.test(rawStatus)
    ? "resolved"
    : "firing";
  const attributes = { ...flattenStrings(obj(p.attributes)), ...flattenStrings(obj(p.labels)) };
  if (str(p.priority)) attributes.priority = str(p.priority)!;
  if (str(p.service)) attributes.service = str(p.service)!;
  if (str(p.environment)) attributes.environment = str(p.environment)!;
  return {
    title,
    description: str(p.description) ?? str(p.body) ?? null,
    status,
    dedupKey:
      str(p.dedup_key) ?? str(p.dedupKey) ?? str(p.fingerprint) ?? str(p.id) ?? `http:${title}`,
    externalUrl: str(p.url) ?? str(p.link) ?? null,
    attributes,
    payload,
  };
}

function prometheus(payload: unknown): ParsedAlert[] {
  const p = obj(payload);
  const list = Array.isArray(p.alerts) ? p.alerts : [payload];
  return list.map((raw) => {
    const a = obj(raw);
    const labels = flattenStrings(obj(a.labels));
    const ann = obj(a.annotations);
    const name = labels.alertname ?? "Prometheus alert";
    const status = (str(a.status) ?? "firing") === "resolved" ? "resolved" : "firing";
    const attributes: Record<string, string> = { ...labels };
    if (labels.severity)
      attributes.priority = labels.severity
        .toUpperCase()
        .replace(/^CRITICAL$/, "P1")
        .replace(/^WARNING$/, "P2")
        .replace(/^INFO$/, "P3");
    if (labels.service) attributes.service = labels.service;
    if (labels.env) attributes.environment = labels.env;
    return {
      title: str(ann.summary) ?? name,
      description: str(ann.description) ?? null,
      status,
      dedupKey: str(a.fingerprint) ?? `prom:${name}:${labels.instance ?? ""}`,
      externalUrl: str(a.generatorURL) ?? null,
      attributes,
      payload: raw,
    };
  });
}

function grafana(payload: unknown): ParsedAlert[] {
  const p = obj(payload);
  if (Array.isArray(p.alerts))
    return prometheus(payload).map((a) => ({
      ...a,
      dedupKey: a.dedupKey.replace(/^prom:/, "grafana:"),
    }));
  const g = generic(payload);
  return [
    {
      ...g,
      title: str(p.title) ?? str(p.ruleName) ?? g.title,
      externalUrl: str(p.ruleUrl) ?? g.externalUrl,
      dedupKey: str(p.ruleId) ? `grafana:${str(p.ruleId)}` : g.dedupKey,
    },
  ];
}

function datadog(payload: unknown): ParsedAlert {
  const p = obj(payload);
  const g = generic(payload);
  const transition = (str(p.alert_transition) ?? str(p.status) ?? "Triggered").toLowerCase();
  const scope = str(p.scope) ?? "";
  const attributes = { ...g.attributes };
  for (const part of scope.split(",")) {
    const [k, v] = part.split(":").map((x) => x.trim());
    if (k && v) attributes[k === "env" ? "environment" : k] = v;
  }
  if (str(p.priority)) attributes.priority = str(p.priority)!;
  return {
    ...g,
    title: str(p.title) ?? str(p.event_title) ?? g.title,
    description: str(p.body) ?? str(p.text_only_msg) ?? g.description,
    status: /recovered|ok|resolved/.test(transition) ? "resolved" : "firing",
    dedupKey: str(p.monitor_id)
      ? `dd:${str(p.monitor_id)}`
      : str(p.alert_id)
        ? `dd:${str(p.alert_id)}`
        : g.dedupKey,
    externalUrl: str(p.link) ?? str(p.event_url) ?? g.externalUrl,
    attributes,
  };
}

function sentry(payload: unknown): ParsedAlert {
  const p = obj(payload);
  const data = obj(p.data);
  const issue = obj(data.issue);
  const event = obj(data.event);
  const g = generic(payload);
  const action = (str(p.action) ?? "").toLowerCase();
  const attributes = { ...g.attributes };
  const tags = event.tags;
  if (Array.isArray(tags))
    for (const t of tags)
      if (Array.isArray(t) && str(t[0]) && str(t[1]))
        attributes[String(t[0]) === "env" ? "environment" : String(t[0])] = String(t[1]);
  if (str(event.level) || str(issue.level))
    attributes.priority =
      (str(event.level) ?? str(issue.level))!.toLowerCase() === "fatal" ? "P1" : "P3";
  return {
    ...g,
    title: str(issue.title) ?? str(event.title) ?? str(p.message) ?? g.title,
    description: str(issue.culprit) ?? str(event.culprit) ?? g.description,
    status: action === "resolved" ? "resolved" : "firing",
    dedupKey: `sentry:${str(issue.id) ?? str(p.id) ?? g.dedupKey}`,
    externalUrl: str(issue.web_url) ?? str(p.url) ?? str(event.web_url) ?? g.externalUrl,
    attributes,
  };
}

function cloudwatch(payload: unknown): ParsedAlert {
  const p = obj(payload);
  // SNS envelope: the alarm is JSON inside `Message`.
  let msg: Record<string, unknown> = obj(p.Message ?? payload);
  if (typeof p.Message === "string") {
    try {
      msg = obj(JSON.parse(p.Message));
    } catch {
      msg = { AlarmName: p.Message };
    }
  }
  const g = generic(msg);
  const name = str(msg.AlarmName) ?? g.title;
  const state = (str(msg.NewStateValue) ?? "ALARM").toUpperCase();
  const attributes = { ...g.attributes, region: str(msg.Region) ?? "" };
  return {
    ...g,
    title: name,
    description: str(msg.NewStateReason) ?? str(msg.AlarmDescription) ?? g.description,
    status: state === "OK" ? "resolved" : "firing",
    dedupKey: `cw:${str(msg.AlarmArn) ?? name}`,
    attributes,
    payload,
  };
}

function uptimeKuma(payload: unknown): ParsedAlert {
  const p = obj(payload);
  const heartbeat = obj(p.heartbeat);
  const monitor = obj(p.monitor);
  const g = generic(payload);
  const up = heartbeat.status === 1 || heartbeat.status === "1" || /\[up\]/i.test(str(p.msg) ?? "");
  const name = str(monitor.name) ?? g.title;
  return {
    ...g,
    title: up ? `${name} is back up` : `${name} is down`,
    description: str(heartbeat.msg) ?? str(p.msg) ?? g.description,
    status: up ? "resolved" : "firing",
    dedupKey: `kuma:${str(monitor.id) ?? name}`,
    externalUrl: str(monitor.url) ?? g.externalUrl,
    attributes: { ...g.attributes, service: str(monitor.name) ?? g.attributes.service ?? "" },
  };
}

/** Parses a payload for a source kind. Batches (Alertmanager) yield several alerts. */
export function parsePayload(kind: AlertSourceKind, payload: unknown): ParsedAlert[] {
  switch (kind) {
    case "prometheus":
      return prometheus(payload);
    case "grafana":
      return grafana(payload);
    case "datadog":
      return [datadog(payload)];
    case "sentry":
      return [sentry(payload)];
    case "cloudwatch":
      return [cloudwatch(payload)];
    case "uptime_kuma":
      return [uptimeKuma(payload)];
    case "http":
    case "email":
    default:
      return [generic(payload)];
  }
}

/** Applies a source's mappings on top of the parsed attributes. Empty values are dropped. */
export function applyMappings(
  base: Record<string, string>,
  payload: unknown,
  mappings: AttributeMapping[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v) out[k] = v;
  for (const m of mappings) {
    const v = m.path ? str(readPath(payload, m.path)) : null;
    const value = v ?? m.value ?? null;
    if (value) out[m.attribute] = value;
  }
  return out;
}

/** The default mappings a source kind starts with — editable afterwards. */
export function defaultMappings(kind: AlertSourceKind): AttributeMapping[] {
  switch (kind) {
    case "datadog":
      return [
        { attribute: "service", path: "scope.service", catalogTypeKey: "service" },
        { attribute: "priority", path: "priority" },
        { attribute: "environment", path: "scope.env" },
      ];
    case "prometheus":
    case "grafana":
      return [
        { attribute: "service", path: "labels.service", catalogTypeKey: "service" },
        { attribute: "environment", path: "labels.env" },
        { attribute: "region", path: "labels.region" },
      ];
    case "sentry":
      return [{ attribute: "service", path: "data.event.tags.service", catalogTypeKey: "service" }];
    case "cloudwatch":
      return [{ attribute: "environment", path: "", value: "production" }];
    case "uptime_kuma":
      return [{ attribute: "environment", path: "", value: "production" }];
    default:
      return [
        { attribute: "service", path: "service", catalogTypeKey: "service" },
        { attribute: "environment", path: "environment" },
        { attribute: "priority", path: "priority" },
      ];
  }
}
