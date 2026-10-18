/**
 * The monochrome marks of the settings lists (design V2): two letters in a
 * 30 px square, the same ink for every vendor. A list of tools reads as a
 * list, not as a wall of logos; the coloured marks of icons.tsx stay for the
 * screens where a tile has to be recognised at a glance (alert sources,
 * onboarding).
 */
const GLYPHS: Record<string, string> = {
  slack: "Sl",
  teams: "Te",
  github: "GH",
  gitlab: "GL",
  jira: "Ji",
  linear: "Li",
  confluence: "Co",
  notion: "No",
  meet: "GM",
  zoom: "Zo",
  datadog: "Dd",
  prometheus: "Pr",
  grafana: "Gf",
  sentry: "Se",
  cloudwatch: "CW",
  uptime_kuma: "UK",
  http: "{}",
  email: "@",
  opsgenie: "Og",
  pagerduty: "PD",
};

/** "GH" for GitHub; the first two letters of anything we have no mark for. */
export function integrationGlyph(id: string, name?: string): string {
  const known = GLYPHS[id];
  if (known) return known;
  const base = (name ?? id).replace(/[^A-Za-z]/g, "");
  return base.slice(0, 1).toUpperCase() + base.slice(1, 2).toLowerCase();
}
