/**
 * Monitor types as a reader names them: "SSL monitor", "Browser monitor".
 * The acronyms stay acronyms in every language; the rest are product words.
 */
const KIND: Record<string, string> = {
  http: "HTTP",
  api: "API",
  ping: "Ping",
  port: "TCP",
  dns: "DNS",
  ssl: "SSL",
  domain: "Domain",
  synthetic: "Browser",
  incoming: "Heartbeat",
  manual: "Manual",
  logs: "Logs",
  traces: "Traces",
  metrics: "Metrics",
  exceptions: "Exceptions",
};

export function monitorKind(type: string): string {
  return KIND[type] ?? type;
}

/** Labels in reading order: the tier and the environment first, then the rest by name. */
export function orderedLabels(labels: Record<string, string>): Array<[string, string]> {
  const FIRST = ["tier", "env", "environment", "team", "repo"];
  const rank = (k: string) => (FIRST.includes(k) ? FIRST.indexOf(k) : FIRST.length);
  return Object.entries(labels).sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}
