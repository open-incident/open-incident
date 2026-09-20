import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Chart } from "@/app/app/dashboards/chart";
import type { Series } from "@openincident/telemetry";

/**
 * The panel drawing, on the shapes a real query returns.
 *
 * A PromQL result is a list of named series, and one of them having no point
 * in the window is ordinary: `sum by (host.name) (…)` over a machine that was
 * off for the hour says exactly that. Drawn as an area, it read the first
 * point of an empty list and threw — inside a server component, which takes
 * the whole page down rather than the panel. Hence markup, not arithmetic.
 */
const at = (t: number, v: number) => ({ t, v });
const draw = (series: Series[], props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(Chart, { series, ...props }));

describe("Chart", () => {
  it("draws a series that has points beside one that has none", () => {
    const html = draw(
      [
        { labels: { "host.name": "off" }, points: [] },
        { labels: { "host.name": "on" }, points: [at(1, 2), at(2, 4)] },
      ],
      { kind: "area" },
    );
    expect(html).toContain("polyline");
  });

  it("says so rather than drawing nothing when every series is empty", () => {
    expect(draw([{ labels: {}, points: [] }])).toContain("no data in this window");
  });

  it("puts the threshold on the scale even when every value is below it", () => {
    const html = draw([{ labels: {}, points: [at(1, 2), at(2, 3)] }], { threshold: 90 });
    expect(html).toContain("stroke-dasharray");
    expect(html).toContain("90");
  });

  it("colours a stat past its threshold and leaves it alone under", () => {
    const over = draw([{ labels: {}, points: [at(1, 95)] }], { kind: "stat", threshold: 90 });
    const under = draw([{ labels: {}, points: [at(1, 12)] }], { kind: "stat", threshold: 90 });
    expect(over).toContain("--dang");
    expect(under).not.toContain("--dang");
  });
});
