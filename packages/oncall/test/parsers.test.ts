import { describe, expect, it } from "vitest";
import { applyMappings, parsePayload, readPath } from "../src/parsers";

describe("payload parsers", () => {
  it("splits an Alertmanager batch and maps severity to a priority", () => {
    const out = parsePayload("prometheus", {
      alerts: [
        {
          status: "firing",
          labels: {
            alertname: "HighCPU",
            severity: "critical",
            service: "checkout-api",
            instance: "db-1",
          },
          annotations: { summary: "CPU > 95 %" },
          fingerprint: "abc",
        },
        {
          status: "resolved",
          labels: { alertname: "DiskFull", severity: "warning" },
          annotations: {},
        },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: "CPU > 95 %",
      status: "firing",
      dedupKey: "abc",
      attributes: { priority: "P1", service: "checkout-api" },
    });
    expect(out[1]).toMatchObject({
      status: "resolved",
      title: "DiskFull",
      attributes: { priority: "P2" },
    });
  });

  it("reads Datadog scope and transitions", () => {
    const [a] = parsePayload("datadog", {
      monitor_id: 4207231,
      title: "auth-service error rate 4.2 %",
      alert_transition: "Recovered",
      priority: "P2",
      scope: "service:auth-service,env:production",
    });
    expect(a).toMatchObject({
      status: "resolved",
      dedupKey: "dd:4207231",
      attributes: { service: "auth-service", environment: "production", priority: "P2" },
    });
  });

  it("reads Uptime Kuma heartbeats, CloudWatch SNS envelopes and Sentry issues", () => {
    expect(
      parsePayload("uptime_kuma", {
        heartbeat: { status: 0, msg: "timeout" },
        monitor: { id: 7, name: "status.skylark.dev", url: "https://status.skylark.dev" },
      })[0],
    ).toMatchObject({ status: "firing", dedupKey: "kuma:7", title: "status.skylark.dev is down" });
    expect(
      parsePayload("cloudwatch", {
        Message: JSON.stringify({
          AlarmName: "queue-depth",
          NewStateValue: "ALARM",
          AlarmArn: "arn:1",
          Region: "EU (Ireland)",
        }),
      })[0],
    ).toMatchObject({ status: "firing", dedupKey: "cw:arn:1", title: "queue-depth" });
    expect(
      parsePayload("sentry", {
        action: "created",
        data: {
          issue: {
            id: "99",
            title: "TypeError at checkout",
            web_url: "https://sentry.io/i/99",
            level: "fatal",
          },
        },
      })[0],
    ).toMatchObject({
      dedupKey: "sentry:99",
      externalUrl: "https://sentry.io/i/99",
      attributes: { priority: "P1" },
    });
  });

  it("applies mappings over parsed attributes and never keeps an empty value", () => {
    expect(readPath({ a: { b: [{ c: "x" }] } }, "a.b.0.c")).toBe("x");
    const attrs = applyMappings(
      { service: "", priority: "P3" },
      { scope: { service: "auth-service" } },
      [
        { attribute: "service", path: "scope.service" },
        { attribute: "environment", path: "", value: "production" },
        { attribute: "region", path: "scope.region" },
      ],
    );
    expect(attrs).toEqual({ priority: "P3", service: "auth-service", environment: "production" });
  });
});
