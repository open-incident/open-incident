import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, request, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";
import { startTrackersMock } from "./trackers-mock";

/**
 * The catalog beyond the three built-in types: a custom type with its own
 * attributes, entries created, edited and refused deletion while referenced,
 * a CSV import that writes nothing when one row is wrong, the write API, and
 * the importer CLI fed by a Backstage mock — with the lock that makes a
 * code-managed type read-only on screen.
 */
test.describe("Catalog", () => {
  let forge: Awaited<ReturnType<typeof startTrackersMock>>;
  test.beforeAll(async () => {
    forge = await startTrackersMock();
  });
  test.afterAll(async () => {
    forge.server.close();
  });

  test("custom types, entry CRUD with usage guard, CSV import", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/catalog");

    // A new type: three attributes of three kinds, the key derived from the name.
    await page.getByTestId("type-open").click();
    const typeForm = page.getByTestId("type-form");
    await typeForm.locator('input[name="name"]').fill("Squads");
    await expect(typeForm.locator('input[name="key"]')).toHaveValue("squads");
    await page.getByTestId("attr-add").click();
    await page.getByTestId("attr-add").click();
    await page.getByTestId("attr-add").click();
    const rows = page.getByTestId("attr-row");
    await rows.nth(0).locator("input").first().fill("Lead");
    await rows.nth(1).locator("input").first().fill("Domain");
    await rows.nth(1).locator("select").first().selectOption("select");
    await rows.nth(1).locator("input").last().fill("payments, search");
    await rows.nth(2).locator("input").first().fill("Team");
    await rows.nth(2).locator("select").first().selectOption("entry");
    await rows.nth(2).locator("select").last().selectOption("team");
    await page.getByTestId("type-save").click();
    await page.waitForURL(/type=squads/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Squads");
    // The import dialog derives its expected header from the type's own schema.
    await page.getByTestId("import-open").click();
    await expect(page.getByTestId("import-columns")).toHaveText(
      "name,description,external_id,lead,domain,team",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("import-form")).toHaveCount(0);

    // An entry through the generic form: text, choice, reference to a team.
    await page.getByTestId("entry-open").click();
    const entryForm = page.getByTestId("entry-form");
    await entryForm.locator('input[name="name"]').fill("Payments");
    await entryForm.locator('input[name="attr.lead"]').fill("Ana");
    await entryForm.locator('select[name="attr.domain"]').selectOption("payments");
    const teamSelect = entryForm.locator('select[name="attr.team"]');
    const teamName = (await teamSelect.locator("option").nth(1).textContent())!.trim();
    await teamSelect.selectOption({ index: 1 });
    await page.getByTestId("entry-save").click();
    await page.waitForURL(/entry=Payments/);
    await expect(page.getByRole("complementary", { name: "Payments" })).toContainText(teamName);

    // Edited: renamed, the reference kept.
    await page.getByTestId("entry-edit").click();
    await page.getByTestId("entry-form").locator('input[name="name"]').fill("Payments squad");
    await page.getByTestId("entry-save").click();
    await page.waitForURL(/entry=Payments%20squad/);
    await expect(page.getByRole("complementary", { name: "Payments squad" })).toContainText(
      teamName,
    );

    // The team our squad points at cannot be deleted: the usage is named.
    await page.goto(`/app/catalog?type=team&entry=${encodeURIComponent(teamName)}`);
    await expect(page.getByTestId("ref-entries")).not.toHaveText("0");
    await page.getByTestId("entry-edit").click();
    await page.getByTestId("entry-delete").click();
    await expect(page.getByTestId("entry-error")).toContainText("Payments squad");
    await page.keyboard.press("Escape");
    await page.goto(`/app/catalog?type=team&entry=${encodeURIComponent(teamName)}`);
    await expect(page.getByRole("complementary", { name: teamName })).toBeVisible();

    // CSV: one bad row (a domain outside the options) and nothing is written.
    await page.goto("/app/catalog?type=squads");
    await page.getByTestId("import-open").click();
    const bad = `name,external_id,lead,domain,team\nSearch squad,sq_search,Li,search,${teamName}\nPlatform squad,sq_platform,Omar,nope,\n`;
    await page.getByTestId("import-file").setInputFiles({
      name: "squads.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(bad),
    });
    await page.getByTestId("import-run").click();
    await expect(page.getByTestId("import-error")).toContainText("nope");
    // Fixed: two created; re-imported with one change: one updated, one unchanged.
    const good = bad.replace("nope", "payments");
    await page.getByTestId("import-file").setInputFiles({
      name: "squads.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(good),
    });
    await page.getByTestId("import-run").click();
    // The report is translated: only the counts are asserted.
    await expect(page.getByTestId("import-result")).toHaveText(/^2 [^·]+ · 0 [^·]+ · 0 /);
    await page.keyboard.press("Escape");
    await page.getByTestId("import-open").click();
    await page.getByTestId("import-file").setInputFiles({
      name: "squads.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(good.replace("Omar", "Nadia")),
    });
    await page.getByTestId("import-run").click();
    await expect(page.getByTestId("import-result")).toHaveText(/^0 [^·]+ · 1 [^·]+ · 1 /);
    await page.keyboard.press("Escape");
    await page.goto("/app/catalog?type=squads&entry=Platform%20squad");
    await expect(page.getByRole("complementary", { name: "Platform squad" })).toContainText(
      "Nadia",
    );
  });

  test("the write API and the importer CLI, with a code-managed lock", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/api");
    await page.getByTestId("key-open").click();
    await page.locator('form[data-testid="key-form"] input[name="name"]').fill("Catalog importer");
    await page.locator('form[data-testid="key-form"] input[value="write"]').check();
    await page.locator('form[data-testid="key-form"] button[type=submit]').click();
    const key = (await page.getByTestId("secret-value").textContent())?.trim() ?? "";
    expect(key).toMatch(/^oi_live_/);
    await page.keyboard.press("Escape");
    const api = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { authorization: `Bearer ${key}` },
    });

    // A type by API, then an attribute added; entries upserted by external_id.
    const created = await api.post("/api/v1/catalog/types", {
      data: {
        key: "domain",
        name: "Domains",
        attributes: [{ key: "steward", label: "Steward", type: "text" }],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const extended = await api.post("/api/v1/catalog/types", {
      data: {
        key: "domain",
        name: "Domains",
        attributes: [
          { key: "steward", label: "Steward", type: "text" },
          { key: "docs", label: "Docs", type: "link" },
        ],
      },
    });
    expect(extended.status()).toBe(200);
    const upsert = await api.post("/api/v1/catalog/entries", {
      data: {
        type: "domain",
        entries: [
          { name: "Payments", external_id: "dom_pay", attributes: { steward: "Ana" } },
          {
            name: "Search",
            external_id: "dom_search",
            attributes: { docs: "https://docs.example" },
          },
        ],
      },
    });
    expect(upsert.status(), await upsert.text()).toBe(201);
    const ids = ((await upsert.json()) as { ids: string[] }).ids;
    expect(ids).toHaveLength(2);
    // A bad link: refused, and the good row of the same call is not written either.
    const refused = await api.post("/api/v1/catalog/entries", {
      data: {
        type: "domain",
        entries: [
          { name: "Data", external_id: "dom_data" },
          { name: "Bad", attributes: { docs: "not-a-url" } },
        ],
      },
    });
    expect(refused.status()).toBe(422);
    const domains = (await (await api.get("/api/v1/catalog/entries?type=domain")).json()) as {
      data: Array<{ name: string }>;
    };
    expect(domains.data.map((d) => d.name).sort()).toEqual(["Payments", "Search"]);
    // Removing an attribute that holds values: 409 without force.
    const shrink = await api.post("/api/v1/catalog/types", {
      data: {
        key: "domain",
        name: "Domains",
        attributes: [{ key: "docs", label: "Docs", type: "link" }],
      },
    });
    expect(shrink.status()).toBe(409);
    // Deleting: fine for an unreferenced entry, 409 for a service with incidents.
    expect((await api.delete(`/api/v1/catalog/entries/${ids[0]}`)).status()).toBe(204);
    const services = (await (await api.get("/api/v1/catalog/entries?type=service")).json()) as {
      data: Array<{ id: string; name: string }>;
    };
    const checkout = services.data.find((s) => s.name === "checkout-api")!;
    const blocked = await api.delete(`/api/v1/catalog/entries/${checkout.id}`);
    expect(blocked.status()).toBe(409);
    const body = (await blocked.json()) as {
      error: { code: string; referenced_by: Array<{ kind: string; count: number }> };
    };
    expect(body.error.code).toBe("entry_in_use");
    expect(body.error.referenced_by.some((u) => u.kind === "incidents" && u.count > 0)).toBe(true);

    // The CLI against the Backstage mock: groups → teams, components → services.
    const run = promisify(execFile);
    const tsx = path.resolve(process.cwd(), "node_modules/.bin/tsx");
    const cli = path.resolve(process.cwd(), "../catalog/src/cli.ts");
    const backstage = await run(tsx, [
      cli,
      "--source",
      "backstage",
      "--url",
      "http://127.0.0.1:3199",
      "--token",
      "smoke",
      "--api",
      BASE_URL,
      "--key",
      key,
    ]);
    expect(backstage.stdout).toContain("entries: 4 created");
    const search = (await (await api.get("/api/v1/catalog/entries?type=service")).json()) as {
      data: Array<{
        name: string;
        external_id: string | null;
        attributes: Record<string, unknown>;
      }>;
    };
    const indexer = search.data.find((s) => s.name === "search-indexer")!;
    expect(indexer.external_id).toBe("component:default/search-indexer");
    expect(indexer.attributes.repository).toBe("skylark/search-indexer");
    expect(indexer.attributes.tier).toBe("tier 2");
    const teams = (await (await api.get("/api/v1/catalog/entries?type=team")).json()) as {
      data: Array<{ id: string; name: string; external_id: string | null }>;
    };
    const searchTeam = teams.data.find((t) => t.external_id === "group:default/search")!;
    expect(searchTeam.name).toBe("Search");
    expect(indexer.attributes.owner).toBe(searchTeam.id);
    // Second run: nothing changes.
    const again = await run(tsx, [
      cli,
      "--source",
      "backstage",
      "--url",
      "http://127.0.0.1:3199",
      "--token",
      "smoke",
      "--api",
      BASE_URL,
      "--key",
      key,
    ]);
    expect(again.stdout).toContain("entries: 0 created · 0 updated · 4 unchanged");

    // An inline bundle with --lock: the type shows as managed by code, no editing on screen.
    const inline = await run(tsx, [
      cli,
      "--source",
      "inline",
      "--json",
      JSON.stringify({
        types: [
          {
            key: "pillar",
            name: "Pillars",
            attributes: [{ key: "lead", label: "Lead", type: "text" }],
          },
        ],
        entries: [{ type: "pillar", name: "Reliability", attributes: { lead: "Ana" } }],
      }),
      "--lock",
      "--api",
      BASE_URL,
      "--key",
      key,
    ]);
    expect(inline.stdout).toContain("types:   1 created");
    await page.goto("/app/catalog?type=pillar");
    await expect(page.getByTestId("type-locked")).toBeVisible();
    await expect(page.getByTestId("entry-open")).toHaveCount(0);
    await expect(page.getByTestId("import-open")).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Reliability" })).toContainText("Ana");
    // A dry run parses and sends nothing.
    const dry = await run(tsx, [
      cli,
      "--source",
      "inline",
      "--json",
      '{"types":[],"entries":[]}',
      "--dry-run",
    ]);
    expect(dry.stdout).toContain("Dry run");
  });
});
