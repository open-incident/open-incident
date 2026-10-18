/**
 * The short spellings the monitor screens share — "40 s", "1 h 18", "HTTP".
 * Units only, no words: they read the same in every language the product
 * ships, which is why they are not in the dictionary.
 */

/** How long ago, as the "Last check" column says it: "40 s", "4 min", "3 h", "2 d". */
export function ago(at: Date | number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} d`;
}

/** A duration as the KPIs say it: "13 min", "1 h 18", "2 d 4 h". */
export function duration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** A check interval: "30 s", "1 min", "1 h", "24 h". */
export function everyLabel(seconds: number): string {
  if (seconds === 86_400) return "24 h";
  if (seconds % 86_400 === 0) return `${seconds / 86_400} d`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** A latency: "212 ms", "2.40 s". */
export function ms(v: number | null | undefined): string {
  if (v == null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

const KEYS: Record<string, string> = {
  http: "HTTP",
  api: "API",
  port: "PORT",
  dns: "DNS",
  ssl: "SSL",
  domain: "DOM",
  ping: "PING",
  synthetic: "SYN",
  incoming: "IN",
  manual: "MAN",
  logs: "LOG",
  traces: "TRC",
  metrics: "MET",
  exceptions: "EXC",
};

/** The type as the list and the new-monitor tiles spell it. */
export function monitorTypeKey(type: string): string {
  return KEYS[type] ?? type.toUpperCase();
}
