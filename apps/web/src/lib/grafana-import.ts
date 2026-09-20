/**
 * Importing a Grafana dashboard, and telling the truth about what survived.
 *
 * The temptation is to import everything and let the broken panels fail at
 * display time. That produces a dashboard that looks migrated and is not, and
 * whoever opens it a week later has no idea which panels were never going to
 * work. So each panel is translated or skipped **with a reason**, the report is
 * stored with the dashboard, and the screen shows it.
 *
 * A panel is skipped when it is not a graph of a Prometheus query, or when its
 * query uses a construction outside our published subset. The second case is
 * the honest one: a panel whose expression we cannot evaluate exactly would
 * draw a different line from the one it drew in Grafana, and a migrated
 * dashboard that quietly changes its numbers is worse than a missing panel.
 */
import "server-only";
import { parsePromql, PromqlError } from "@openincident/telemetry";
import type { DashboardPanel, DashboardVariable, ImportReport } from "@openincident/db";

type GrafanaTarget = { expr?: string; legendFormat?: string; datasource?: unknown };
type GrafanaPanel = {
  id?: number;
  title?: string;
  type?: string;
  targets?: GrafanaTarget[];
  gridPos?: { w?: number; h?: number; x?: number; y?: number };
  fieldConfig?: { defaults?: { unit?: string } };
  panels?: GrafanaPanel[];
};
type GrafanaDashboard = {
  title?: string;
  panels?: GrafanaPanel[];
  templating?: {
    list?: Array<{ name?: string; label?: string; query?: unknown; current?: { value?: unknown } }>;
  };
};

/** Grafana panel types we can draw. Anything else is named in the report. */
const DRAWABLE: Record<string, DashboardPanel["type"]> = {
  timeseries: "line",
  graph: "line",
  stat: "stat",
  gauge: "stat",
  singlestat: "stat",
  barchart: "line",
};

export type ImportResult = {
  title: string;
  panels: DashboardPanel[];
  variables: DashboardVariable[];
  report: ImportReport;
};

/** Rows are containers in Grafana; their children are the real panels. */
function flatten(panels: GrafanaPanel[]): GrafanaPanel[] {
  return panels.flatMap((p) => (p.type === "row" && p.panels ? flatten(p.panels) : [p]));
}

export function importGrafana(json: unknown): ImportResult {
  const doc = json as GrafanaDashboard;
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.panels)) {
    throw new Error("this file does not look like a Grafana dashboard (no panels array)");
  }

  const skipped: ImportReport["skipped"] = [];
  const out: DashboardPanel[] = [];
  const all = flatten(doc.panels);

  for (const p of all) {
    const title = (p.title ?? "untitled").slice(0, 120);
    const type = DRAWABLE[p.type ?? ""];
    if (!type) {
      skipped.push({ title, reason: `panel type "${p.type ?? "unknown"}" is not drawn here` });
      continue;
    }
    const targets = (p.targets ?? []).filter((t) => typeof t.expr === "string" && t.expr.trim());
    if (targets.length === 0) {
      skipped.push({ title, reason: "no Prometheus query on this panel" });
      continue;
    }
    const expr = targets[0]!.expr!.trim();
    try {
      // Parsed now rather than at display: a panel we cannot evaluate is a
      // panel that must not be imported silently.
      parsePromql(expr);
    } catch (err) {
      const reason =
        err instanceof PromqlError
          ? `query uses ${err.construct ? `"${err.construct}"` : "a construction"} we do not support: ${err.message}`
          : "query could not be parsed";
      skipped.push({ title, reason });
      continue;
    }
    if (targets.length > 1) {
      skipped.push({
        title,
        reason: `kept the first of ${targets.length} queries; the others were not imported`,
      });
    }
    out.push({
      id: String(p.id ?? out.length + 1),
      title,
      query: expr,
      type,
      unit: p.fieldConfig?.defaults?.unit ?? "",
      w: Math.min(12, Math.max(3, p.gridPos?.w ?? 12)),
      h: Math.min(16, Math.max(4, p.gridPos?.h ?? 8)),
    });
  }

  const variables: DashboardVariable[] = (doc.templating?.list ?? [])
    .filter((v) => typeof v.name === "string")
    .map((v) => ({
      name: v.name!,
      label: typeof v.label === "string" ? v.label : v.name!,
      // A Grafana variable query is its own little language (`label_values(...)`,
      // datasource-specific). We keep the current value and leave the query
      // empty rather than pretend to evaluate it.
      query: "",
      value: typeof v.current?.value === "string" ? v.current.value : "",
    }));

  return {
    title: (doc.title ?? "Imported dashboard").slice(0, 120),
    panels: out,
    variables,
    report: {
      source: "grafana",
      panels: all.length,
      translated: out.length,
      skipped,
    },
  };
}
