/**
 * Playing a journey in Chromium, one step at a time.
 *
 * Every step is timed on its own, because "the checkout page took 11 seconds"
 * is a sentence nobody can act on and "step 4, click Pay, took 9.4 s" is. The
 * step that breaks stops the run: the ones after it did not happen, and they
 * are reported as such rather than as zero-millisecond successes.
 *
 * Nothing here evaluates anything the author wrote. A step is one of eight
 * verbs applied to a selector and a value — no page.evaluate, no script, no
 * arbitrary code from the database into this process.
 */

import type { Browser, Locator, Page } from "playwright";
import {
  SYNTHETIC_DEFAULT_STEP_TIMEOUT_MS,
  injectSecrets,
  redactSecrets,
  stepUsesSecret,
  type SyntheticJob,
  type SyntheticRunResult,
  type SyntheticStep,
  type SyntheticStepResult,
} from "@openincident/oncall";

/** The user agent a page sees, so a site can recognise (and allow) the probe. */
const USER_AGENT_SUFFIX = "OpenIncidentSynthetic/1.0 (+https://open-incident.org)";

/** How often a text or URL assertion looks again while it waits. */
const POLL_MS = 200;

/** One line describing a step, for the screens. Never a credential's value. */
export function stepLabel(step: SyntheticStep): string {
  const selector = step.selector ? ` ${step.selector}` : "";
  switch (step.kind) {
    case "goto":
      return `goto ${step.value ?? ""}`;
    case "click":
      return `click${selector}`;
    case "fill":
      // The stored value is either plain text the author typed or the literal
      // `{{secrets.NAME}}`. The resolved credential is never in this string.
      return `fill${selector} = ${step.value ?? ""}`;
    case "select":
      return `select${selector} = ${step.value ?? ""}`;
    case "waitFor":
      return `waitFor${selector}`;
    case "expectText":
      return `expect text “${step.value ?? ""}”${step.selector ? ` in ${step.selector}` : ""}`;
    case "expectUrl":
      return `expect url ${step.value ?? ""}`;
    case "expectStatus":
      return `expect status ${step.value ?? ""}`;
  }
}

class StepFailure extends Error {}

function locate(page: Page, selector: string): Locator {
  // `.first()` on purpose: a selector matching two nodes is a journey that
  // still means something, and Playwright's strict mode would refuse it with
  // an error about our engine rather than about their page.
  return page.locator(selector).first();
}

async function poll(
  deadline: number,
  read: () => Promise<string>,
  ok: (value: string) => boolean,
  describe: (value: string) => string,
): Promise<void> {
  let last = "";
  for (;;) {
    last = await read();
    if (ok(last)) return;
    if (Date.now() >= deadline) throw new StepFailure(describe(last));
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * Plays the steps and returns what happened, plus the screenshot bytes when the
 * run failed and a page was still open to photograph.
 *
 * The screenshot is returned rather than stored: where it goes is the caller's
 * business, and this function must stay callable without object storage.
 */
export async function playJourney(
  browser: Browser,
  job: SyntheticJob,
  secrets: Record<string, string>,
): Promise<{ result: SyntheticRunResult; screenshot: Buffer | null }> {
  const started = Date.now();
  const deadline = started + job.budgetMs;
  const results: SyntheticStepResult[] = job.steps.map((step, index) => ({
    index,
    kind: step.kind,
    label: stepLabel(step),
    outcome: "skipped" as const,
  }));

  const context = await browser.newContext({
    viewport: job.viewport,
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 ${USER_AGENT_SUFFIX}`,
  });
  const page = await context.newPage();

  // The status of the last main-frame navigation, for `expectStatus`. Read from
  // the response event rather than from goto's return value, so a redirect
  // chain or a click that navigates is covered too.
  let lastStatus: number | null = null;
  page.on("response", (response) => {
    if (response.frame() === page.mainFrame() && response.request().isNavigationRequest())
      lastStatus = response.status();
  });

  // Credentials never reach a screenshot: the fields they are typed into are
  // painted over by Playwright before the image is encoded, and every password
  // field is covered whether a credential was used or not.
  const masks: Locator[] = [page.locator('input[type="password"]')];
  for (const step of job.steps)
    if (step.kind === "fill" && step.selector && stepUsesSecret(step))
      masks.push(locate(page, step.selector));

  let failed: SyntheticRunResult["failedStep"] | undefined;
  let screenshot: Buffer | null = null;

  for (let i = 0; i < job.steps.length; i++) {
    const step = job.steps[i]!;
    const entry = results[i]!;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      entry.outcome = "failed";
      entry.error = `the journey's budget of ${job.budgetMs} ms ran out before this step`;
      failed = { index: i, label: entry.label, error: entry.error };
      break;
    }
    const timeout = Math.min(step.timeoutMs ?? SYNTHETIC_DEFAULT_STEP_TIMEOUT_MS, remaining);
    const at = Date.now();
    try {
      await runStep(page, step, secrets, timeout, () => lastStatus);
      entry.outcome = "passed";
      entry.durationMs = Date.now() - at;
    } catch (err) {
      entry.outcome = "failed";
      entry.durationMs = Date.now() - at;
      const raw = err instanceof Error ? err.message : String(err);
      // A browser's error quotes what it was handed, and what it was handed may
      // be a password. Redact before the string exists anywhere durable.
      entry.error = redactSecrets(raw, secrets).split("\n")[0]!.slice(0, 300);
      failed = { index: i, label: entry.label, error: entry.error };
      break;
    }
  }

  if (failed) {
    screenshot = await page
      .screenshot({ mask: masks, maskColor: "#334155", timeout: 10_000 })
      .catch(() => null);
  }

  await context.close().catch(() => {});

  return {
    result: {
      kind: "synthetic",
      ok: !failed,
      totalMs: Date.now() - started,
      steps: results,
      ...(failed ? { failedStep: failed } : {}),
    },
    screenshot,
  };
}

/** The eight verbs. Anything else never got past `parseSyntheticConfig`. */
async function runStep(
  page: Page,
  step: SyntheticStep,
  secrets: Record<string, string>,
  timeout: number,
  status: () => number | null,
): Promise<void> {
  const deadline = Date.now() + timeout;
  const { text: value, missing } = injectSecrets(step.value ?? "", secrets);
  if (missing.length > 0)
    throw new StepFailure(
      `this step needs the credential ${missing.join(", ")}, which this monitor does not carry`,
    );

  switch (step.kind) {
    case "goto":
      await page.goto(value, { timeout, waitUntil: "domcontentloaded" });
      return;
    case "click":
      await locate(page, step.selector!).click({ timeout });
      return;
    case "fill":
      await locate(page, step.selector!).fill(value, { timeout });
      return;
    case "select":
      await locate(page, step.selector!).selectOption(value, { timeout });
      return;
    case "waitFor":
      await locate(page, step.selector!).waitFor({ state: "visible", timeout });
      return;
    case "expectText": {
      const where = step.selector ? locate(page, step.selector) : page.locator("body");
      await where.waitFor({ state: "attached", timeout });
      await poll(
        deadline,
        async () => (await where.textContent().catch(() => "")) ?? "",
        (seen) => seen.includes(value),
        () => `the text “${value}” is not on the page`,
      );
      return;
    }
    case "expectUrl":
      await poll(
        deadline,
        async () => page.url(),
        (seen) => seen.includes(value),
        (seen) => `the address is ${seen}, which does not contain “${value}”`,
      );
      return;
    case "expectStatus": {
      const expected = Number(value);
      await poll(
        deadline,
        async () => String(status() ?? ""),
        (seen) => seen === String(expected),
        (seen) => `the page answered ${seen || "nothing"} rather than ${expected}`,
      );
      return;
    }
  }
}
