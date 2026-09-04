import { expect, type Page } from "@playwright/test";
import { MAILPIT_URL } from "../playwright.config";

/* ---------------------------------------------------------------------------
 * Demo data set accounts (packages/db seed + pnpm db:seed:auth).
 * The password is shared and deliberately trivial: dev only.
 * ------------------------------------------------------------------------- */

export const PASSWORD = "demo-openincident";

export const MEMBERS = {
  owner: "amelie@skylark.dev",
  responder: "karim@skylark.dev",
  viewer: "claire@skylark.dev",
} as const;

/**
 * Signs a member in with email + password and waits for the incidents list.
 *
 * The attempt is replayed: Better Auth caps /sign-in at a few calls per ten
 * seconds per IP, and a whole suite shares that counter. On screen the 429 is
 * told apart from a wrong password, but the only way past it is to wait.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await signInWith(page, email, PASSWORD);
}

/** The same replayed sign-in, with a password of the test's own (reset, invitation). */
export async function signInWith(page: Page, email: string, password: string): Promise<void> {
  await expect(async () => {
    await page.goto("/login");
    await page.locator("input[type=email]").fill(email);
    await page.locator("input[type=password]").fill(password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL(/\/app\//, { timeout: 8_000 });
  }).toPass({ timeout: 60_000, intervals: [1_000, 3_000, 6_000, 12_000] });
}

export async function signOut(page: Page): Promise<void> {
  await page.request.post("/api/auth/sign-out");
  await page.context().clearCookies();
}

type MailpitMessage = { ID: string; Subject: string; To: { Address: string }[]; Created: string };

/**
 * Retrieves a link from the latest email sent to this address whose URL
 * contains `pathFragment`. Mailpit is polled: sending is asynchronous and a
 * test that reads the mailbox too early fails for a reason unrelated to the
 * product.
 */
export async function linkFromMail(
  email: string,
  pathFragment: string,
  since: number,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=30`);
    const { messages } = (await res.json()) as { messages: MailpitMessage[] };
    const hits = messages.filter(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()) &&
        new Date(m.Created).getTime() >= since - 5_000,
    );
    for (const hit of hits) {
      const full = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${hit.ID}`)).json()) as {
        Text?: string;
        HTML?: string;
      };
      const body = `${full.Text ?? ""}\n${full.HTML ?? ""}`;
      const link = [...body.matchAll(/https?:\/\/[^\s"<>]+/g)]
        .map((m) => m[0])
        .find((u) => u.includes(pathFragment));
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `No email with a "${pathFragment}" link for ${email} after ${timeoutMs} ms. ` +
      `Is Mailpit answering on ${MAILPIT_URL}? Does the web server point SMTP at it (localhost:1027)?`,
  );
}

/** Checks that a URL really answers the expected status, without navigating. */
export async function expectStatus(page: Page, path: string, status: number): Promise<void> {
  const res = await page.request.get(path, { maxRedirects: 0, failOnStatusCode: false });
  expect(res.status(), `${path} should answer ${status}`).toBe(status);
}
