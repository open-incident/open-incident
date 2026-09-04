import { expect, request, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn, signOut } from "./helpers";
import { startOidcMock } from "./oidc-mock";

/**
 * Enterprise single sign-on: an OpenID Connect connection configured from the
 * settings, the button it puts on the sign-in page, a first sign-in that
 * creates the member with the connection's role, "SSO only" refusing a
 * password for the covered domain, and a SAML connection whose service
 * provider metadata the instance serves.
 */
test.describe("Single sign-on", () => {
  let idp: Awaited<ReturnType<typeof startOidcMock>>;
  test.beforeAll(async () => {
    idp = await startOidcMock();
  });
  test.afterAll(async () => {
    idp.server.close();
  });

  test("OIDC end to end, SSO-only enforcement, SAML metadata", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/sso");
    await expect(page.getByTestId("ee-unavailable")).toHaveCount(0);

    // An OIDC connection: discovery runs against the mock at creation.
    await page.getByTestId("sso-add").click();
    const form = page.getByTestId("sso-form");
    await form.locator('input[name="label"]').fill("Mock IdP");
    await form.locator('input[name="domains"]').fill("smoke.example");
    await form.locator('select[name="defaultRole"]').selectOption("viewer");
    await form.locator('input[name="issuer"]').fill(idp.issuer);
    await form.locator('input[name="clientId"]').fill("smoke-client");
    await form.locator('input[name="clientSecret"]').fill("smoke-secret");
    await page.getByTestId("sso-enforce").check();
    await page.getByTestId("sso-save").click();
    await page.waitForURL(/saved=1/);
    const row = page.getByTestId("sso-row").filter({ hasText: "Mock IdP" });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("sso-enforced")).toBeVisible();
    const redirectUri = (await row.getByTestId("sso-redirect-uri").textContent())!.trim();
    expect(redirectUri).toMatch(
      /^http:\/\/[a-z0-9-]+\.localhost:\d+\/api\/auth\/sso\/callback\/oi-/,
    );

    // The sign-in page now offers it; a password for the enforced domain is refused.
    await signOut(page);
    await page.goto("/login");
    const button = page.getByTestId("sso-button");
    await expect(button).toHaveText(/Mock IdP/);
    // Replayed: the sign-in rate limit is shared by the whole suite, and a
    // 429 says "wait", not "use SSO".
    await expect(async () => {
      await page.goto("/login");
      await page.locator("input[type=email]").fill("someone@smoke.example");
      await page.locator("input[type=password]").fill("whatever-password");
      await page.locator("button[type=submit]").click();
      await expect(page.locator('p[role="alert"]')).toContainText(/SSO/, { timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [1_000, 3_000, 6_000, 12_000] });

    // Through the provider: no screen at the mock, straight back, a new member.
    await button.click();
    await page.waitForURL(/\/app\/incidents/, { timeout: 20_000 });
    expect(idp.codes).toBe(1);
    await page.goto("/app/settings/members");
    // A viewer sees the restriction notice, not the members table: the role landed.
    await expect(page.getByTestId("role-restricted")).toBeVisible();
    await signOut(page);

    // The owner sees the new member as a viewer, and the audit line of the sign-in.
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/members");
    const memberRow = page.locator(`[data-member-email="${idp.user.email}"]`);
    await expect(memberRow).toBeVisible();
    await expect(memberRow.locator("select")).toHaveValue("viewer");
    await page.goto("/app/settings/audit");
    await expect(page.getByText(idp.user.email).first()).toBeVisible();

    // A SAML connection from a certificate and an entry point; the SP metadata is served.
    await page.goto("/app/settings/sso");
    await page.getByTestId("sso-add").click();
    await page.getByTestId("sso-kind").selectOption("saml");
    const saml = page.getByTestId("sso-form");
    await saml.locator('input[name="label"]').fill("Mock SAML");
    await saml.locator('input[name="entityId"]').fill("https://idp.smoke.example/saml");
    await saml.locator('input[name="entryPoint"]').fill("https://idp.smoke.example/saml/sso");
    await saml.locator('textarea[name="cert"]').fill(SMOKE_CERT);
    await page.getByTestId("sso-save").click();
    await page.waitForURL(/saved=1/);
    const samlRow = page.getByTestId("sso-row").filter({ hasText: "Mock SAML" });
    const metadataUrl = (await samlRow.getByTestId("sso-metadata-url").getAttribute("href"))!;
    const anon = await request.newContext({ baseURL: BASE_URL });
    const meta = await anon.get(metadataUrl);
    expect(meta.status(), await meta.text()).toBe(200);
    const xml = await meta.text();
    expect(xml).toContain("EntityDescriptor");
    expect(xml).toContain("/api/auth/sso/saml2/sp/acs/");

    // Removal: the button leaves the sign-in page.
    await samlRow.getByTestId("sso-remove").click();
    await page.waitForURL(/removed=1/);
    await expect(page.getByTestId("sso-row")).toHaveCount(1);
  });
});

/** A self-signed test certificate — only its shape matters here (no SAML response is verified). */
const SMOKE_CERT = `-----BEGIN CERTIFICATE-----
MIIBszCCAVwCCQDqAmjJ8xzE8TANBgkqhkiG9w0BAQsFADBaMQswCQYDVQQGEwJG
UjEOMAwGA1UECAwFUGFyaXMxDjAMBgNVBAcMBVBhcmlzMRMwEQYDVQQKDApTbW9r
ZSBUZXN0MRYwFAYDVQQDDA1pZHAuc21va2UudGVzdDAeFw0yNjA5MDQwMDAwMDBa
Fw0zNjA5MDEwMDAwMDBaMFoxCzAJBgNVBAYTAkZSMQ4wDAYDVQQIDAVQYXJpczEO
MAwGA1UEBwwFUGFyaXMxEzARBgNVBAoMClNtb2tlIFRlc3QxFjAUBgNVBAMMDWlk
cC5zbW9rZS50ZXN0MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAL7cpKQ8Qb3gYl6r
u1m1XlY7zC0m3R2m6mL0mXc9m0v6pWq0Q6z0Dq3mWJk5sWQq7fGQx0F7TzY9f1rR
7uDHhL8CAwEAATANBgkqhkiG9w0BAQsFAANBAEnH2E4b3hqZ3fPq2p0yN0Zqb0N3
c0m8Wl1w9QbYQmYwZ1eWJqQY6r8b1a8u0mM0H2s3zqYtVx9m6a1oXk4xhEY=
-----END CERTIFICATE-----`;
