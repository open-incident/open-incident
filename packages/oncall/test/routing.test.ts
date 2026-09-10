import { describe, expect, it } from "vitest";
import {
  applyMappingsWith,
  conditionsHold,
  groupingKey,
  legacyFiltersAsConditions,
  mergeAttributes,
  payloadPaths,
  priorityByLabel,
  resolveMapping,
  suggestMappings,
  transformValue,
  type ConditionContext,
} from "../src/routing";

const ctx = (
  attributes: Record<string, string>,
  extra: Partial<ConditionContext> = {},
): ConditionContext => ({
  attributes,
  source: { kind: "datadog", name: "Datadog prod", id: "src-1" },
  priority: "P1",
  title: "Checkout latency > 500ms",
  ...extra,
});

describe("conditions", () => {
  it("ANDs inside a group, ORs across groups, matches everything when empty", () => {
    const c = ctx({ environment: "production", service: "checkout-api" });
    expect(conditionsHold([], c)).toBe(true);
    expect(
      conditionsHold(
        [
          {
            all: [
              { attribute: "environment", op: "eq", value: "Production" },
              { attribute: "service", op: "contains", value: "checkout" },
            ],
          },
        ],
        c,
      ),
    ).toBe(true);
    expect(
      conditionsHold(
        [
          { all: [{ attribute: "environment", op: "eq", value: "staging" }] },
          { all: [{ attribute: "priority", op: "in", value: "P1, P2" }] },
        ],
        c,
      ),
    ).toBe(true);
    expect(
      conditionsHold([{ all: [{ attribute: "environment", op: "eq", value: "staging" }] }], c),
    ).toBe(false);
  });

  it("knows the built-in subjects and the negative operators", () => {
    const c = ctx({ region: "eu-west-1" });
    expect(
      conditionsHold([{ all: [{ attribute: "source", op: "eq", value: "datadog" }] }], c),
    ).toBe(true);
    expect(
      conditionsHold([{ all: [{ attribute: "source_name", op: "contains", value: "prod" }] }], c),
    ).toBe(true);
    expect(
      conditionsHold(
        [{ all: [{ attribute: "title", op: "matches", value: "latency > \\d+ms" }] }],
        c,
      ),
    ).toBe(true);
    expect(conditionsHold([{ all: [{ attribute: "team", op: "missing" }] }], c)).toBe(true);
    expect(
      conditionsHold(
        [{ all: [{ attribute: "region", op: "not_in", value: "us-east-1,eu-west-1" }] }],
        c,
      ),
    ).toBe(false);
    expect(conditionsHold([{ all: [{ attribute: "title", op: "matches", value: "(" }] }], c)).toBe(
      false,
    );
  });

  it("reads legacy filters as one AND group", () => {
    expect(legacyFiltersAsConditions([])).toEqual([]);
    expect(
      legacyFiltersAsConditions([{ attribute: "environment", op: "eq", value: "production" }]),
    ).toEqual([{ all: [{ attribute: "environment", op: "eq", value: "production" }] }]);
  });
});

describe("mappings", () => {
  const payload = {
    labels: { service: "team:payments", env: "PROD" },
    tags: ["feature:api", "region:eu"],
  };

  it("extracts, matches, transforms and falls back to the static value", () => {
    expect(
      resolveMapping(payload, { attribute: "env", path: "labels.env", transform: "lower" }),
    ).toBe("prod");
    expect(
      resolveMapping(payload, {
        attribute: "team",
        path: "labels.service",
        transform: "after_colon",
      }),
    ).toBe("payments");
    expect(
      resolveMapping(payload, { attribute: "region", path: "tags", match: "region:(\\w+)" }),
    ).toBe("eu");
    expect(
      resolveMapping(payload, { attribute: "nothing", path: "labels.missing", value: "default" }),
    ).toBe("default");
    expect(
      resolveMapping(payload, { attribute: "guarded", path: "labels.env", match: "^stag" }),
    ).toBeNull();
  });

  it("layers the source's mappings over the parser's attributes", () => {
    const out = applyMappingsWith({ service: "raw", empty: "" }, payload, [
      { attribute: "service", path: "labels.service", transform: "after_colon" },
    ]);
    expect(out).toEqual({ service: "payments" });
  });

  it("transforms are total", () => {
    expect(transformValue("a b", "first_word")).toBe("a");
    expect(transformValue("x", undefined)).toBe("x");
    expect(transformValue("no colon", "before_colon")).toBe("no colon");
  });
});

describe("priorities", () => {
  const prios = [
    { id: "1", name: "P1", rank: 0, aliases: ["critical", "sev1"], isDefault: false },
    { id: "2", name: "P2", rank: 1, aliases: ["warning"], isDefault: true },
  ];
  it("matches by name or alias, case-insensitively", () => {
    expect(priorityByLabel(prios, "p1")?.id).toBe("1");
    expect(priorityByLabel(prios, "CRITICAL")?.id).toBe("1");
    expect(priorityByLabel(prios, "Warning")?.id).toBe("2");
    expect(priorityByLabel(prios, "unknown")).toBeNull();
    expect(priorityByLabel(prios, "")).toBeNull();
  });
});

describe("grouping and merging", () => {
  it("builds the key from the chosen attributes", () => {
    const rule = {
      enabled: true,
      by: ["service", "region"],
      windowMinutes: 5,
      extending: true,
      escalate: "never" as const,
      graceMinutes: 0,
    };
    expect(groupingKey(rule, { service: "Checkout", region: "eu" })).toBe(
      "service=checkout|region=eu",
    );
    expect(groupingKey({ ...rule, by: [] }, {})).toBe("*");
  });

  it("merges per strategy and locks nothing it is not told to", () => {
    const registry = [
      { key: "service", type: "text" as const, mergeStrategy: "first" as const },
      { key: "count", type: "text" as const, mergeStrategy: "last" as const },
      { key: "regions", type: "list" as const, mergeStrategy: "accumulate" as const },
      { key: "priority", type: "priority" as const, mergeStrategy: "max" as const },
    ];
    const rank = (v: string) => ({ P1: 0, P2: 1, P3: 2 })[v] ?? null;
    const out = mergeAttributes(
      { service: "payments", count: "5", regions: "eu, us", priority: "P2", other: "a" },
      { service: "checkout", count: "12", regions: "us, apac", priority: "P1", other: "b" },
      registry,
      rank,
    );
    expect(out).toEqual({
      service: "payments",
      count: "12",
      regions: "eu, us, apac",
      priority: "P1",
      other: "b",
    });
  });
});

describe("discovery", () => {
  const payload = {
    alert: { name: "x", labels: { service: "api", env: "prod" } },
    tags: ["a", "b"],
    n: 3,
  };
  it("lists the string paths of a payload", () => {
    const paths = payloadPaths(payload).map((p) => p.path);
    expect(paths).toEqual([
      "alert.name",
      "alert.labels.service",
      "alert.labels.env",
      "tags.0",
      "tags.1",
      "n",
    ]);
  });
  it("suggests where the workspace's attributes live", () => {
    const s = suggestMappings(payload, ["service", "environment", "team"]);
    expect(s).toEqual([
      { attribute: "service", path: "alert.labels.service", value: "api" },
      { attribute: "environment", path: "alert.labels.env", value: "prod" },
    ]);
  });
});
