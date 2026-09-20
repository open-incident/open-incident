import { describe, expect, it } from "vitest";
import { decodeMetricsJson, hashAttributes, seriesLabels } from "../src/metrics";

/**
 * What a metric's series is made of.
 *
 * The interesting part is not the decoding — it is which of the resource's
 * attributes survive into the labels. Too few and every host reports into one
 * line; too many and a container id turns one series into a new one on every
 * restart.
 */
describe("seriesLabels", () => {
  it("keeps what identifies the thing measured", () => {
    expect(
      seriesLabels({
        "service.name": "api",
        "host.name": "web-3",
        "container.name": "checkout",
        "postgresql.database.name": "orders",
      }),
    ).toEqual({
      "host.name": "web-3",
      "container.name": "checkout",
      "postgresql.database.name": "orders",
    });
  });

  it("drops what changes on every restart", () => {
    expect(
      seriesLabels({
        "container.id": "9f2c1b4e77a1",
        "k8s.pod.uid": "b0a1-…",
        "process.pid": "4412",
        "os.type": "linux",
      }),
    ).toEqual({});
  });

  it("ignores an empty value rather than storing an empty label", () => {
    expect(seriesLabels({ "host.name": "" })).toEqual({});
  });
});

describe("decodeMetricsJson", () => {
  const payload = (resource: Record<string, string>, point: Record<string, string>) => ({
    resourceMetrics: [
      {
        resource: {
          attributes: Object.entries(resource).map(([key, value]) => ({
            key,
            value: { stringValue: value },
          })),
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: "system.cpu.utilization",
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: "1700000000000000000",
                      asDouble: 0.42,
                      attributes: Object.entries(point).map(([key, value]) => ({
                        key,
                        value: { stringValue: value },
                      })),
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  });

  it("folds the host into the point's labels", () => {
    const { points } = decodeMetricsJson(
      payload({ "service.name": "infra", "host.name": "web-3" }, { state: "idle", cpu: "0" }),
    );
    expect(points).toHaveLength(1);
    expect(points[0]!.serviceName).toBe("infra");
    expect(points[0]!.attributes).toEqual({ "host.name": "web-3", state: "idle", cpu: "0" });
  });

  /*
   * Two hosts reporting the same metric are two series. Before the resource
   * was folded in they were one, and the chart drew a single line jumping
   * between the two machines' values — the failure this test exists for.
   */
  it("gives two hosts two series", () => {
    const one = decodeMetricsJson(payload({ "service.name": "infra", "host.name": "a" }, {}));
    const two = decodeMetricsJson(payload({ "service.name": "infra", "host.name": "b" }, {}));
    expect(hashAttributes(one.points[0]!.attributes)).not.toBe(
      hashAttributes(two.points[0]!.attributes),
    );
  });

  it("lets a point attribute win over the resource's", () => {
    const { points } = decodeMetricsJson(
      payload({ "service.name": "infra", "host.name": "resource" }, { "host.name": "point" }),
    );
    expect(points[0]!.attributes["host.name"]).toBe("point");
  });
});
