import { expect, request, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";

/**
 * Enterprise SCIM 2.0 provisioning: a token issued from the settings (shown
 * once), then the calls an identity provider makes — discovery, users looked
 * up by userName, created, patched, deactivated; groups created with members,
 * patched, deleted — and the token rotated and the endpoint disabled.
 */
test.describe("SCIM provisioning", () => {
  test("users and groups through the endpoint, token rotation and disable", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/scim");
    await expect(page.getByTestId("ee-unavailable")).toHaveCount(0);
    const base = (await page.getByTestId("scim-base-url").textContent())!.trim();
    expect(base).toBe(`${BASE_URL}/scim/v2`);
    await page.getByTestId("scim-issue").click();
    const token = (await page.getByTestId("scim-token").textContent())!.trim();
    expect(token).toMatch(/^oi_scim_[a-f0-9]{48}$/);

    const scim = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
    });
    const anon = await request.newContext({ baseURL: BASE_URL });
    expect((await anon.get("/scim/v2/Users")).status()).toBe(401);
    expect(
      (
        await anon.get("/scim/v2/Users", { headers: { authorization: "Bearer oi_scim_bad" } })
      ).status(),
    ).toBe(401);

    const spc = await scim.get("/scim/v2/ServiceProviderConfig");
    expect(spc.status()).toBe(200);
    expect(spc.headers()["content-type"]).toContain("application/scim+json");
    expect(((await spc.json()) as { patch: { supported: boolean } }).patch.supported).toBe(true);

    // Look-up by userName: the owner is there, active.
    const lookup = await scim.get(`/scim/v2/Users?filter=userName eq "${MEMBERS.owner}"`);
    expect(lookup.status()).toBe(200);
    const owner = (await lookup.json()) as {
      totalResults: number;
      Resources: Array<{ id: string; active: boolean }>;
    };
    expect(owner.totalResults).toBe(1);
    expect(owner.Resources[0]!.active).toBe(true);

    // Create: 201 with the resource; the member exists, invited (no SSO here), role viewer by request.
    const email = `okta-${Date.now().toString(36)}@smoke.example`;
    const created = await scim.post("/scim/v2/Users", {
      data: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: email,
        externalId: "00u-smoke-1",
        name: { givenName: "Otto", familyName: "Provisioned" },
        emails: [{ value: email, primary: true, type: "work" }],
        roles: [{ value: "viewer", primary: true }],
        active: true,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const user = (await created.json()) as {
      id: string;
      userName: string;
      displayName: string;
      roles: Array<{ value: string }>;
    };
    expect(user.userName).toBe(email);
    expect(user.displayName).toBe("Otto Provisioned");
    expect(user.roles[0]!.value).toBe("viewer");
    // Same userName again: uniqueness conflict.
    expect((await scim.post("/scim/v2/Users", { data: { userName: email } })).status()).toBe(409);
    // Deactivate the Okta way, rename the Entra way.
    const deactivated = await scim.patch(`/scim/v2/Users/${user.id}`, {
      data: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: false }],
      },
    });
    expect(deactivated.status(), await deactivated.text()).toBe(200);
    expect(((await deactivated.json()) as { active: boolean }).active).toBe(false);
    const renamed = await scim.patch(`/scim/v2/Users/${user.id}`, {
      data: { Operations: [{ op: "Replace", value: { active: true, "name.givenName": "Otta" } }] },
    });
    expect(renamed.status(), await renamed.text()).toBe(200);
    const after = (await renamed.json()) as { active: boolean; displayName: string };
    expect(after.active).toBe(true);
    expect(after.displayName).toBe("Otta Provisioned");
    // An owner cannot be deactivated by the provider.
    const ownerOff = await scim.patch(`/scim/v2/Users/${owner.Resources[0]!.id}`, {
      data: { Operations: [{ op: "replace", path: "active", value: false }] },
    });
    expect(ownerOff.status()).toBe(403);

    // Groups: a team created with one member, the owner added by path, then removed.
    const group = await scim.post("/scim/v2/Groups", {
      data: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        displayName: "Okta squad",
        externalId: "00g-smoke",
        members: [{ value: user.id }],
      },
    });
    expect(group.status(), await group.text()).toBe(201);
    const g = (await group.json()) as { id: string; members: Array<{ value: string }> };
    expect(g.members.map((m) => m.value)).toEqual([user.id]);
    const added = await scim.patch(`/scim/v2/Groups/${g.id}`, {
      data: {
        Operations: [{ op: "add", path: "members", value: [{ value: owner.Resources[0]!.id }] }],
      },
    });
    expect(added.status(), await added.text()).toBe(200);
    expect(((await added.json()) as { members: unknown[] }).members).toHaveLength(2);
    const removed = await scim.patch(`/scim/v2/Groups/${g.id}`, {
      data: { Operations: [{ op: "remove", path: `members[value eq "${user.id}"]` }] },
    });
    expect(
      ((await removed.json()) as { members: Array<{ value: string }> }).members.map((m) => m.value),
    ).toEqual([owner.Resources[0]!.id]);
    // The team shows in the catalog with its member count.
    await page.goto("/app/catalog?type=team&entry=Okta%20squad");
    await expect(page.getByRole("complementary", { name: "Okta squad" })).toBeVisible();
    const byName = await scim.get('/scim/v2/Groups?filter=displayName eq "Okta squad"');
    expect(((await byName.json()) as { totalResults: number }).totalResults).toBe(1);
    expect((await scim.delete(`/scim/v2/Groups/${g.id}`)).status()).toBe(204);
    expect((await scim.get(`/scim/v2/Groups/${g.id}`)).status()).toBe(404);

    // DELETE a user deactivates and keeps the row.
    expect((await scim.delete(`/scim/v2/Users/${user.id}`)).status()).toBe(204);
    const gone = await scim.get(`/scim/v2/Users/${user.id}`);
    expect(gone.status()).toBe(200);
    expect(((await gone.json()) as { active: boolean }).active).toBe(false);
    await page.goto("/app/settings/members");
    await expect(page.locator(`[data-member-email="${email}"]`)).toBeVisible();

    // Rotation: the old token dies with the new one; disabling closes the door.
    await page.goto("/app/settings/scim");
    await expect(page.getByTestId("scim-state")).not.toHaveText(
      /Not enabled|Non activé|Nicht aktiviert/,
    );
    await page.getByTestId("scim-issue").click();
    const token2 = (await page.getByTestId("scim-token").textContent())!.trim();
    expect(token2).not.toBe(token);
    expect((await scim.get("/scim/v2/Users")).status()).toBe(401);
    const scim2 = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { authorization: `Bearer ${token2}` },
    });
    expect((await scim2.get("/scim/v2/Users")).status()).toBe(200);
    await page.getByTestId("scim-toggle").click();
    await expect(page.getByTestId("scim-state")).toHaveText(/Disabled|Désactivé|Deaktiviert/);
    expect((await scim2.get("/scim/v2/Users")).status()).toBe(401);
  });
});
