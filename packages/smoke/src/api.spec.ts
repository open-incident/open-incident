import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, request, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * The public API and the outbound webhooks, end to end: a key created in the
 * settings really opens /api/v1, an endpoint created there really receives a
 * signed call when an incident is declared through the API — the same write
 * path as the web form.
 */
test.describe("API & webhooks", () => {
  test("a key created in the settings lists, declares and updates incidents", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/api");
    await page.getByTestId("key-open").click();
    await page.locator('form[data-testid="key-form"] input[name="name"]').fill("Smoke key");
    await page.locator('form[data-testid="key-form"] input[value="write"]').check();
    await page.locator('form[data-testid="key-form"] button[type=submit]').click();
    const key = (await page.getByTestId("secret-value").textContent())?.trim() ?? "";
    expect(key).toMatch(/^oi_live_[a-f0-9]{32}$/);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByTestId("api-key-row").filter({ hasText: "Smoke key" })).toBeVisible();

    const api = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { authorization: `Bearer ${key}` },
    });
    const anon = await request.newContext({ baseURL: BASE_URL });

    // No key, unknown key: told apart, both refused.
    expect((await anon.get("/api/v1/incidents")).status()).toBe(401);
    const bad = await anon.get("/api/v1/incidents", {
      headers: { authorization: `Bearer oi_live_${"0".repeat(32)}` },
    });
    expect(bad.status()).toBe(401);
    expect((await bad.json()).error.code).toBe("unknown_key");

    const list = await api.get("/api/v1/incidents?limit=5");
    expect(list.status()).toBe(200);
    const body = (await list.json()) as {
      data: Array<{ reference: string }>;
      next_cursor: string | null;
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]!.reference).toMatch(/^INC-\d+$/);
    expect(body.next_cursor).toBeTruthy();

    const services = await api.get("/api/v1/catalog/entries?type=service");
    const service = ((await services.json()) as { data: Array<{ name: string }> }).data[0]!.name;
    const name = `[smoke api ${new Date().toISOString().slice(11, 19)}] Erreurs 5xx sur ${service}`;
    const created = await api.post("/api/v1/incidents", {
      data: { name, severity: "SEV3", service, custom_fields: { region: "eu-west-1" } },
    });
    expect(created.status(), await created.text()).toBe(201);
    const inc = (await created.json()) as {
      number: number;
      reference: string;
      phase: string;
      status: string | null;
      severity: string;
      source: string;
    };
    expect(inc.phase).toBe("active");
    expect(inc.severity).toBe("SEV3");
    expect(inc.source).toBe("api");

    const missing = await api.post("/api/v1/incidents", { data: { name: "no service" } });
    expect(missing.status()).toBe(422);
    expect((await missing.json()).error.code).toBe("missing_field");

    const update = await api.post(`/api/v1/incidents/${inc.reference}/updates`, {
      data: {
        message: "Smoke: mitigation in progress.",
        severity: "SEV2",
        next_update_in_minutes: 30,
      },
    });
    expect(update.status(), await update.text()).toBe(201);
    expect(((await update.json()) as { severity: string }).severity).toBe("SEV2");

    const timeline = await api.get(`/api/v1/incidents/${inc.number}/timeline`);
    const events = (
      (await timeline.json()) as {
        data: Array<{ kind: string; actor: { kind: string; name: string } }>;
      }
    ).data;
    expect(events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["declared", "update_posted", "severity_changed"]),
    );
    expect(events.find((e) => e.kind === "update_posted")!.actor).toMatchObject({
      kind: "api",
      name: "Smoke key",
    });

    const fu = await api.post(`/api/v1/incidents/${inc.number}/follow-ups`, {
      data: { title: "Smoke follow-up", priority: "P2" },
    });
    expect(fu.status(), await fu.text()).toBe(201);

    const resolved = await api.post(`/api/v1/incidents/${inc.number}/updates`, {
      data: { status: "resolved", message: "Smoke: resolved." },
    });
    expect(resolved.status()).toBe(201);
    expect(((await resolved.json()) as { phase: string }).phase).toMatch(/post_incident|closed/);

    // The web shows what the API wrote, by the key's name.
    await page.goto(`/app/incidents/${inc.number}`);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Smoke: mitigation in progress.")).toBeVisible();

    // Revocation is immediate.
    await page.goto("/app/settings/api");
    const row = page.getByTestId("api-key-row").filter({ hasText: "Smoke key" });
    await row.getByRole("button", { name: /Revoke|Révoquer|Widerrufen/ }).click();
    await expect(row).toHaveCount(0);
    await expect(async () =>
      expect((await api.get("/api/v1/incidents")).status()).toBe(401),
    ).toPass({ timeout: 5_000 });

    const openapi = await anon.get("/api/v1/openapi.json");
    expect(openapi.status()).toBe(200);
    expect(((await openapi.json()) as { paths: Record<string, unknown> }).paths).toHaveProperty(
      "/incidents/{number}/updates",
    );
    await api.dispose();
    await anon.dispose();
    await signOut(page);
  });

  test("an endpoint receives a signed incident.created call", async ({ page }) => {
    const received: Array<{
      headers: Record<string, string | string[] | undefined>;
      body: string;
    }> = [];
    const server: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/hook`;

    try {
      await signIn(page, MEMBERS.owner);
      await page.goto("/app/settings/api");
      await page.getByTestId("webhook-open").click();
      await page.locator('form[data-testid="webhook-form"] input[name="url"]').fill(url);
      await page.locator('form[data-testid="webhook-form"] button[type=submit]').click();
      const secret = (await page.getByTestId("secret-value").textContent())?.trim() ?? "";
      expect(secret).toMatch(/^whsec_[a-f0-9]{48}$/);
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(page.getByTestId("webhook-row").filter({ hasText: url })).toBeVisible();

      // Declare from the web form: the webhook is fired whatever the write path.
      await page.goto("/app/incidents/new");
      const title = `[smoke hook ${new Date().toISOString().slice(11, 19)}] Webhook check`;
      await page.locator('input[name="name"]').fill(title);
      await page.locator('select[name="serviceEntryId"]').selectOption({ index: 1 });
      await page.locator('select[name="field.region"]').selectOption({ index: 1 });
      await page.locator('form[data-testid="declare-form"] button[type=submit]').click();
      await page.waitForURL(/\/app\/incidents\/\d+$/);

      await expect
        .poll(
          () =>
            received.filter(
              (r) => r.headers["x-oi-event"] === "incident.created" && r.body.includes(title),
            ).length,
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);
      const hit = received.find(
        (r) => r.headers["x-oi-event"] === "incident.created" && r.body.includes(title),
      )!;
      const expected = `sha256=${createHmac("sha256", secret).update(hit.body).digest("hex")}`;
      expect(hit.headers["x-oi-signature"]).toBe(expected);
      expect(hit.headers["x-oi-timestamp"]).toBeTruthy();
      const payload = JSON.parse(hit.body) as {
        event: string;
        incident: { name: string; phase: string };
      };
      expect(payload.event).toBe("incident.created");
      expect(payload.incident.name).toBe(title);

      // The delivery is listed, and the endpoint can be deleted.
      await page.goto("/app/settings/api");
      const row = page.getByTestId("webhook-row").filter({ hasText: url });
      await row.getByRole("link", { name: /Deliveries|Livraisons|Zustellungen/ }).click();
      await expect(
        page
          .getByTestId("webhook-row")
          .filter({ hasText: url })
          .getByText("incident.created")
          .first(),
      ).toBeVisible();
      await page
        .getByTestId("webhook-row")
        .filter({ hasText: url })
        .getByRole("button", { name: /^(Delete|Supprimer|Löschen)$/ })
        .click();
      await expect(page.getByTestId("webhook-row").filter({ hasText: url })).toHaveCount(0);
      await signOut(page);
    } finally {
      server.close();
    }
  });
});
