import { createHash, createHmac } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import { BASE_URL, TENANT } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";
import { startAiMock } from "./ai-mock";
import { startAutomationMock } from "./automation-mock";

/**
 * Atlas — autonomy earned per service (spec delta §15), against the mock
 * model server and a mock of the customer's automation. Settings › Atlas
 * shows the seeded ladder; an allowed action is connected to the automation
 * (signed requests, the secret shown once); an incident on a level-3 service
 * gets a fix run at once and a person paged; verification resolves it; the
 * one-tap Undo link reverses it and costs the service a level; the kill
 * switch and the budget act at once.
 *
 * The engine runs in the worker; here the assessment and the sweep are asked
 * of the web app through its signed internal route, so the spec does not
 * depend on the worker having been restarted on this code.
 */
const MOCK = "http://127.0.0.1:3192";

function internalKey(): Buffer {
  const m =
    process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 16
      ? process.env.ENCRYPTION_KEY
      : process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 8
        ? process.env.BETTER_AUTH_SECRET
        : "openincident-dev-encryption-key";
  const root = createHash("sha256").update(m).digest();
  return createHmac("sha256", root).update("atlas:internal").digest();
}

type Inspect = {
  investigation: { reviewState: string | null; status: string } | null;
  journal: Array<{
    id: string;
    kind: string;
    autonomous: boolean;
    level: number | null;
    executedAt: string | null;
    verifiedAt: string | null;
    undoneAt: string | null;
    text: { key?: string } | null;
    links: { undo: string } | null;
  }>;
};

async function internal(op: Record<string, unknown>): Promise<{ ok: boolean; data?: Inspect }> {
  const body = JSON.stringify({ tenantSlug: TENANT, ...op });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", internalKey()).update(`${t}.${body}`).digest("hex");
  const ctx = await request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
  const res = await ctx.post("/api/atlas/internal", {
    data: body,
    headers: { "content-type": "application/json", "x-oi-atlas-signature": `t=${t},v1=${sig}` },
    timeout: 120_000,
  });
  const json = (await res.json()) as { ok: boolean; data?: Inspect };
  await ctx.dispose();
  return json;
}

test.describe("Atlas", () => {
  let ai: Awaited<ReturnType<typeof startAiMock>>;
  let auto: Awaited<ReturnType<typeof startAutomationMock>>;
  test.beforeAll(async () => {
    ai = await startAiMock();
    auto = await startAutomationMock();
  });
  test.afterAll(async () => {
    ai.server.close();
    auto.server.close();
  });

  test("Settings › Atlas shows the ladder, and its switches act", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/ai");
    await expect(page.getByTestId("atlas-kill-banner")).toContainText(/Atlas/);
    await expect(page.locator("[data-testid^=atlas-level-]")).toHaveCount(5);
    await expect(
      page.getByTestId("atlas-service-auth-service").getByTestId("atlas-service-level"),
    ).toContainText(/[LNS]4/);
    await expect(
      page.getByTestId("atlas-action-db_failover").getByTestId("atlas-action-switch"),
    ).toHaveAttribute("aria-checked", "false");
    // The kill switch, both ways.
    await page.getByTestId("atlas-kill").click();
    await expect(page.getByTestId("atlas-kill-banner")).toContainText(
      /stopped everywhere|arrêté partout|überall gestoppt/i,
    );
    await page.getByTestId("atlas-kill").click();
    await expect(page.getByTestId("atlas-kill-banner")).not.toContainText(
      /stopped everywhere|arrêté partout|überall gestoppt/i,
    );
    // A guardrail off and on again.
    const g = page.getByTestId("atlas-limit-changeFreeze");
    await g.click();
    await expect(g).toHaveAttribute("aria-checked", "false");
    await g.click();
    await expect(g).toHaveAttribute("aria-checked", "true");
    // The budget, edited in place.
    await page.getByTestId("atlas-budget-edit").click();
    await page.getByTestId("atlas-budget-month").fill("450");
    await page.getByTestId("atlas-budget-save").click();
    await expect(page.getByTestId("atlas-budget")).toContainText("450");
  });

  test("a level-3 service: fix run at once, verified, resolved; Undo costs a level", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/ai");
    // The automation secret, shown once, given to the mock automation.
    await page.getByTestId("atlas-secret-rotate").click();
    await page.getByTestId("atlas-secret-dialog-submit").click();
    const secret = ((await page.getByTestId("settings-secret").textContent()) ?? "").trim();
    expect(secret).toMatch(/^oia_/);
    auto.setSecret(secret);
    await page.getByTestId("settings-secret-done").click();
    // Roll back a deploy → the mock automation.
    const row = page.getByTestId("atlas-action-rollback_deploy");
    await row.getByTestId("atlas-action-name").click();
    const dialog = page.getByTestId("atlas-endpoint-dialog");
    await dialog.locator('input[name="doUrl"]').fill(`${MOCK}/rollback/do`);
    await dialog.locator('input[name="undoUrl"]').fill(`${MOCK}/rollback/undo`);
    await dialog.locator('input[name="verifyUrl"]').fill(`${MOCK}/rollback/verify`);
    await page.getByTestId("atlas-endpoint-dialog-submit").click();
    await expect(row.getByTestId("atlas-action-switch")).toHaveAttribute("aria-checked", "true");

    // An incident on web-storefront (level 3), declared by the API.
    await page.goto("/app/settings/api");
    await page.getByTestId("key-open").click();
    const keyDialog = page.getByTestId("key-dialog");
    await keyDialog.locator('input[name="name"]').fill("Smoke Atlas key");
    await keyDialog.locator('input[value="write"]').check({ force: true });
    await keyDialog.locator('select[name="scope"]').selectOption("all");
    await page.getByTestId("key-dialog-submit").click();
    const key = (await page.getByTestId("settings-secret").textContent())?.trim() ?? "";
    const api = await request.newContext({
      baseURL: BASE_URL,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { authorization: `Bearer ${key}` },
    });
    const created = await api.post("/api/v1/incidents", {
      data: {
        name: "Smoke: 5xx after the storefront deploy",
        service: "web-storefront",
        severity: "SEV3",
        custom_fields: { region: "eu-west-1" },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const number = ((await created.json()) as { number: number }).number;
    await api.dispose();

    const before = auto.calls.length;
    const assessed = await internal({ op: "assess", incidentNumber: number });
    expect(assessed.ok).toBe(true);
    const fix = assessed.data!.journal.find((a) => a.kind === "system" && a.executedAt);
    expect(fix, JSON.stringify(assessed.data?.journal.map((a) => a.text))).toBeTruthy();
    expect(fix!.autonomous).toBe(true);
    expect(fix!.level).toBe(3);
    const done = auto.calls.slice(before).find((c) => c.path === "/rollback/do");
    expect(done?.signed).toBe(true);
    expect(done?.body).toMatchObject({ action: "rollback_deploy", phase: "do" });
    expect(
      assessed.data!.journal.some(
        (a) => a.text?.key === "atlas.j.paged" || a.text?.key === "atlas.j.pagedPolicy",
      ),
    ).toBe(true);

    // The sweep verifies through the automation and, at level 3, resolves.
    // A fix is checked once it has had twenty seconds to take effect.
    await page.waitForTimeout(21_000);
    await internal({ op: "sweep" });
    const after = await internal({
      op: "inspect",
      incidentNumber: number,
      memberEmail: MEMBERS.owner,
    });
    expect(after.data!.journal.some((a) => a.text?.key === "atlas.j.verified")).toBe(true);
    expect(after.data!.journal.some((a) => a.text?.key === "atlas.j.resolved")).toBe(true);
    expect(after.data!.investigation?.reviewState).toBe("pending");

    // The timeline says so, marked as Atlas.
    await page.goto(`/app/incidents/${number}`);
    await expect(page.getByText(/Mock: rolled back to smoke-v2.30/).first()).toBeVisible();

    // The one-tap Undo of the phone: no sign-in needed, and it costs the service a level.
    const undo = after.data!.journal.find((a) => a.id === fix!.id)!.links!.undo;
    const phone = await (
      await page.context().browser()!.newContext({ ignoreHTTPSErrors: true })
    ).newPage();
    await phone.goto(undo);
    await phone.getByTestId("atlas-link-button").click();
    await expect(phone.getByTestId("atlas-link-done")).toBeVisible();
    expect(auto.calls.some((c) => c.path === "/rollback/undo" && c.signed)).toBe(true);
    await phone.close();
    await page.goto("/app/settings/ai");
    await expect(
      page.getByTestId("atlas-service-web-storefront").getByTestId("atlas-service-level"),
    ).toContainText(/[LNS]2/);
  });
});
