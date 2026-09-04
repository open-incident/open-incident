import { describe, expect, it } from "vitest";
import { SUITE_DEFINITIONS } from "../src/suites";

describe("QA result parsers", () => {
  it("reads a Playwright JSON report and names what failed", () => {
    const summary = SUITE_DEFINITIONS.smoke.parse("", 1, {
      json: {
        stats: { expected: 60, unexpected: 1, flaky: 0, skipped: 2 },
        suites: [
          {
            title: "sso.spec.ts",
            file: "sso.spec.ts",
            suites: [
              {
                title: "Single sign-on",
                specs: [
                  {
                    title: "OIDC end to end",
                    file: "sso.spec.ts",
                    line: 22,
                    tests: [
                      {
                        status: "unexpected",
                        results: [
                          { status: "failed", error: { message: "expect(x).toBe(y)\nmore" } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(summary).toMatchObject({ total: 63, passed: 60, failed: 1, skipped: 2 });
    expect(summary.failures?.[0]).toMatchObject({
      title: "sso.spec.ts › Single sign-on › OIDC end to end",
      location: "sso.spec.ts:22",
    });
    expect(summary.failures?.[0]?.message).toContain("expect(x).toBe(y)");
  });
  it("reads turbo's vitest lines", () => {
    const log = [
      "@openincident/ai:test:       Tests  2 passed (2)",
      "@openincident/db:test:       Tests  1 failed | 6 passed (7)",
      "@openincident/db:test:  FAIL  test/rls.test.ts > isolation",
      " Tasks:    11 successful, 12 total",
    ].join("\n");
    const summary = SUITE_DEFINITIONS.unit.parse(log, 1, {});
    expect(summary).toMatchObject({ passed: 8, failed: 1, total: 9 });
    expect(summary.failures?.[0]?.title).toContain("test/rls.test.ts");
    expect(summary.notes?.[0]).toBe("11 of 12 package tasks succeeded");
  });
  it("reads TypeScript errors and prettier warnings", () => {
    const ts = SUITE_DEFINITIONS.typecheck.parse(
      "@openincident/web:typecheck: src/lib/x.ts(12,5): error TS2339: Property 'n' does not exist.\n Tasks:    19 successful, 20 total",
      1,
      {},
    );
    expect(ts.failures?.[0]).toMatchObject({ location: "src/lib/x.ts:12" });
    expect(ts.failed).toBe(1);
    const fmt = SUITE_DEFINITIONS.format.parse(
      "[warn] apps/web/src/a.ts\n[warn] Code style issues found in 1 file.",
      1,
      {},
    );
    expect(fmt.failures).toEqual([{ title: "Not formatted", location: "apps/web/src/a.ts" }]);
    expect(
      SUITE_DEFINITIONS.format.parse(
        "Checking formatting...\nAll matched files use Prettier code style!",
        0,
        {},
      ).failed,
    ).toBe(0);
  });
});
