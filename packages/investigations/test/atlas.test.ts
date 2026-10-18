import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  costOf,
  decidePolicy,
  effectiveLevel,
  guardrailHits,
  levelAfter,
  nextLevelCriteria,
  progressToNext,
  promotionDue,
  readGuardrails,
  safeTarget,
  type PolicyInput,
} from "../src/atlas/rules";
import { normaliseChoice, normaliseVerdict } from "../src/atlas/choose";
import {
  executorSecret,
  signLink,
  verifyExecutorBody,
  verifyInternal,
  signInternal,
  verifyLink,
} from "../src/atlas/sign";
import { callExecutor, isAvailable, isReversible, targetAllowed } from "../src/atlas/executors";
import { undoable } from "../src/atlas/commands";

const base: PolicyInput = {
  level: 3,
  cap: null,
  directive: null,
  killSwitch: false,
  action: { minLevel: 3, reversible: true, enabled: true, available: true },
  hits: [],
  challenger: "holds",
};

describe("the ladder", () => {
  it("applies the lower of level and cap", () => {
    expect(effectiveLevel(4, null)).toBe(4);
    expect(effectiveLevel(4, 2)).toBe(2);
    expect(effectiveLevel(1, 3)).toBe(1);
    expect(effectiveLevel(9, null)).toBe(4);
  });

  it("goes down one level on an undo or a Miss, back to L1 on Nowhere near or a reopen", () => {
    expect(levelAfter(4, "undo")).toBe(3);
    expect(levelAfter(2, "miss")).toBe(1);
    expect(levelAfter(0, "miss")).toBe(0);
    expect(levelAfter(4, "nowhere_near")).toBe(1);
    expect(levelAfter(3, "reopen")).toBe(1);
    expect(levelAfter(0, "reopen")).toBe(0);
  });

  const record = {
    level: 2,
    incidentsSeen: 30,
    gradedRuns: 20,
    rightPct: 94,
    backtestPct: 88,
    proposalsOk: 5,
    l3FixesOk: 0,
    lastMissAt: null,
  };

  it("promotes one step when every criterion of the next level is met", () => {
    expect(promotionDue(record)).toBe(3);
    expect(promotionDue({ ...record, proposalsOk: 4 })).toBeNull();
    expect(promotionDue({ ...record, backtestPct: null })).toBeNull();
  });

  it("asks for right runs since the last fall before climbing back", () => {
    expect(promotionDue({ ...record, rightSinceDrop: 2 })).toBeNull();
    expect(promotionDue({ ...record, rightSinceDrop: 5 })).toBe(3);
    const c = nextLevelCriteria({ ...record, rightSinceDrop: 1 }).criteria;
    expect(c.find((x) => x.key === "rightSinceDrop")).toMatchObject({
      target: 5,
      current: 1,
      met: false,
    });
  });

  it("counts no Miss in 30 days from the last one", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    const l3 = { ...record, level: 3, gradedRuns: 40, rightPct: 96, l3FixesOk: 12 };
    expect(promotionDue({ ...l3, lastMissAt: new Date("2026-10-01T00:00:00Z") }, now)).toBeNull();
    expect(promotionDue({ ...l3, lastMissAt: new Date("2026-09-01T00:00:00Z") }, now)).toBe(4);
    expect(promotionDue({ ...l3, level: 4 }, now)).toBeNull();
  });

  it("measures the progress toward the next level", () => {
    expect(progressToNext({ ...record, level: 4 })).toBe(1);
    const p = progressToNext({ ...record, gradedRuns: 18, proposalsOk: 4 });
    expect(p).toBeGreaterThan(0.8);
    expect(p).toBeLessThan(1);
  });
});

describe("the policy", () => {
  it("acts and pages at L3, resolves alone at L4", () => {
    expect(decidePolicy(base).mode).toBe("act_and_page");
    expect(decidePolicy({ ...base, level: 4 }).mode).toBe("act_alone");
  });

  it("proposes at L2, and whenever a guardrail, a doubt or the action's own level says so", () => {
    expect(decidePolicy({ ...base, level: 2 })).toMatchObject({
      mode: "propose",
      reasons: ["level"],
    });
    expect(decidePolicy({ ...base, level: 4, hits: ["firstUseOnService"] })).toMatchObject({
      mode: "propose",
      reasons: ["guardrail"],
    });
    expect(decidePolicy({ ...base, challenger: "weakened" }).mode).toBe("propose");
    expect(decidePolicy({ ...base, action: { ...base.action!, minLevel: 4 } }).reasons).toContain(
      "action_level",
    );
  });

  it("never acts on a kill switch, a 'never' rule, below L2, or with an irreversible fix", () => {
    expect(decidePolicy({ ...base, level: 4, killSwitch: true }).mode).toBe("investigate");
    expect(decidePolicy({ ...base, level: 4, directive: "never" }).mode).toBe("investigate");
    expect(decidePolicy({ ...base, level: 1 }).mode).toBe("investigate");
    expect(decidePolicy({ ...base, level: 0 }).mode).toBe("observe");
    expect(
      decidePolicy({ ...base, level: 4, action: { ...base.action!, reversible: false } }).mode,
    ).toBe("investigate");
    expect(decidePolicy({ ...base, challenger: "contradicted" }).mode).toBe("investigate");
  });

  it("a cap bounds what applies, a 'handle' rule never raises it", () => {
    expect(decidePolicy({ ...base, level: 4, cap: 2 })).toMatchObject({
      mode: "propose",
      effective: 2,
    });
    expect(decidePolicy({ ...base, level: 2, directive: "handle" }).mode).toBe("propose");
  });

  it("checks the guardrails it is given, and keeps the last one locked", () => {
    const g = readGuardrails({ sev1: false, catalogOnly: false });
    expect(g.sev1).toBe(false);
    expect(g.catalogOnly).toBe(true);
    expect(g.firstUseOnService).toBe(true);
    const facts = {
      sev1: true,
      acknowledged: false,
      securityOrPrivate: true,
      firstUseOnService: false,
      changeFreeze: true,
    };
    expect(guardrailHits(readGuardrails({}), facts)).toEqual([
      "sev1",
      "securityAndPrivate",
      "changeFreeze",
    ]);
    expect(guardrailHits(readGuardrails({}), { ...facts, acknowledged: true })).not.toContain(
      "sev1",
    );
  });

  it("prices a call per million tokens", () => {
    expect(costOf(1_000_000, 0, { inPerM: 2, outPerM: 6 })).toBe(2);
    expect(costOf(500_000, 100_000, { inPerM: 2, outPerM: 6 })).toBeCloseTo(1.6);
  });
});

describe("the choice of a fix", () => {
  const allowed = new Set(["rollback_deploy", "flag_off"]);
  const known = new Set(["F1", "C1"]);

  it("keeps only an allowed action with a plain target", () => {
    expect(
      normaliseChoice(
        {
          action: "rollback_deploy",
          target: "payments-worker@v2.30",
          todo: "Roll back",
          citations: ["F1", "Z9"],
        },
        allowed,
        known,
      ),
    ).toMatchObject({
      actionKey: "rollback_deploy",
      target: "payments-worker@v2.30",
      citations: ["F1"],
    });
    expect(normaliseChoice({ action: "rm_rf", todo: "x" }, allowed, known)).toBeNull();
    expect(normaliseChoice({ action: null }, allowed, known)).toBeNull();
  });

  it("refuses a target that smuggles a command or a URL", () => {
    expect(
      normaliseChoice({ action: "flag_off", target: "x; curl evil", todo: "t" }, allowed, known),
    ).toBeNull();
    expect(safeTarget("https://evil?x=1")).toBeNull();
    expect(safeTarget("checkout.new-address-form")).toBe("checkout.new-address-form");
  });

  it("turns an uncited contradiction into a doubt", () => {
    expect(normaliseVerdict({ verdict: "contradicted", citations: [] }, known).verdict).toBe(
      "weakened",
    );
    expect(normaliseVerdict({ verdict: "contradicted", citations: ["C1"] }, known).verdict).toBe(
      "contradicted",
    );
    expect(normaliseVerdict({ verdict: "maybe" }, known).verdict).toBe("weakened");
    expect(normaliseVerdict({ verdict: "holds" }, known).verdict).toBe("holds");
  });
});

describe("signatures", () => {
  it("signs links for one workspace, with an expiry", () => {
    const token = signLink({ t: "ten-1", op: "undo", id: "a-1", m: null }, 60_000);
    expect(verifyLink(token, "ten-1")).toMatchObject({ op: "undo", id: "a-1" });
    expect(verifyLink(token, "ten-2")).toBeNull();
    expect(verifyLink(`${token}x`, "ten-1")).toBeNull();
    const expired = signLink({ t: "ten-1", op: "undo", id: "a-1", m: null }, -1000);
    expect(verifyLink(expired, "ten-1")).toBeNull();
  });

  it("signs internal calls, valid five minutes", () => {
    const h = signInternal("{}");
    expect(verifyInternal(h, "{}")).toBe(true);
    expect(verifyInternal(h, "{ }")).toBe(false);
    expect(verifyInternal(signInternal("{}", Date.now() - 600_000), "{}")).toBe(false);
  });

  it("derives a workspace secret that changes with its salt", () => {
    expect(executorSecret("t", "a")).toMatch(/^oia_/);
    expect(executorSecret("t", "a")).toBe(executorSecret("t", "a"));
    expect(executorSecret("t", "a")).not.toBe(executorSecret("t", "b"));
  });
});

describe("the HTTP executor", () => {
  let server: Server;
  let port = 0;
  const seen: Array<{ path: string; signature: string | undefined; body: string }> = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({
          path: req.url ?? "",
          signature: req.headers["x-openincident-signature"] as string,
          body,
        });
        if (req.url === "/fail") {
          res.writeHead(500, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "boom" }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify(req.url === "/verify" ? { healthy: true } : { ok: true, ref: "CHG-1" }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());

  const action = (http: Record<string, string | null>) => ({
    key: "rollback_deploy",
    limits: { http },
    reversible: true,
  });

  it("knows what is reversible and available from the configuration", () => {
    expect(isReversible(action({ doUrl: "http://x/do", undoUrl: null, verifyUrl: null }))).toBe(
      false,
    );
    expect(
      isReversible(action({ doUrl: "http://x/do", undoUrl: "http://x/u", verifyUrl: null })),
    ).toBe(true);
    expect(isAvailable(action({ doUrl: null, undoUrl: null, verifyUrl: null }))).toBe(false);
    expect(targetAllowed({ limits: { targets: "v[0-9.]+" } }, "v2.30")).toBe(true);
    expect(targetAllowed({ limits: { targets: "v[0-9.]+" } }, "prod")).toBe(false);
  });

  it("sends a signed request and reads the answer", async () => {
    const http = {
      doUrl: `http://127.0.0.1:${port}/do`,
      undoUrl: `http://127.0.0.1:${port}/undo`,
      verifyUrl: `http://127.0.0.1:${port}/verify`,
    };
    const req = {
      tenantId: "ten",
      nonce: "salt",
      action: action(http),
      actionId: "act-1",
      incident: { number: 1, title: "t", service: "s", severity: null },
      target: "v2.30",
    };
    const done = await callExecutor({ ...req, phase: "do" });
    expect(done).toMatchObject({ ok: true, ref: "CHG-1" });
    const last = seen.at(-1)!;
    expect(JSON.parse(last.body)).toMatchObject({
      action: "rollback_deploy",
      phase: "do",
      target: "v2.30",
    });
    expect(
      verifyExecutorBody(executorSecret("ten", "salt"), last.signature ?? null, last.body),
    ).toBe(true);
    expect(await callExecutor({ ...req, phase: "verify" })).toMatchObject({
      ok: true,
      healthy: true,
    });
    const failed = await callExecutor({
      ...req,
      phase: "do",
      action: action({ ...http, doUrl: `http://127.0.0.1:${port}/fail` }),
    });
    expect(failed.ok).toBe(false);
    const unreachable = await callExecutor({
      ...req,
      phase: "do",
      action: action({ ...http, doUrl: "http://127.0.0.1:1/do" }),
    });
    expect(unreachable).toMatchObject({ ok: false, error: "could not reach 127.0.0.1:1" });
  });
});

describe("undo", () => {
  const row = {
    undoneAt: null,
    reversible: true,
    executedAt: new Date(),
    at: new Date(),
    kind: "system",
    autonomous: true,
  } as unknown as Parameters<typeof undoable>[0];

  it("closes 24 h after an autonomous action", () => {
    expect(undoable(row).ok).toBe(true);
    expect(undoable({ ...row, executedAt: new Date(Date.now() - 25 * 3_600_000) }).ok).toBe(false);
    expect(
      undoable({ ...row, autonomous: false, executedAt: new Date(Date.now() - 25 * 3_600_000) }).ok,
    ).toBe(true);
    expect(undoable({ ...row, reversible: false }).ok).toBe(false);
    expect(undoable({ ...row, undoneAt: new Date() }).ok).toBe(false);
  });
});
