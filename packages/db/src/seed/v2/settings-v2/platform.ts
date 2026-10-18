/**
 * settings-v2 demo rows — Platform: API & webhooks, Diagnostics. Idempotent:
 * every row is found again by its natural key (a key's name, a run's suite
 * and command) and re-anchored on "now", so the screens keep saying
 * "expires in 9 days" and "failed 2 h ago" whenever the seed runs.
 *
 * - three API keys as the design draws them; only the SHA-256 of a random
 *   value is stored, so none of them opens anything;
 * - the last run of every diagnostics suite: the smoke suite failed (3 of 48),
 *   the others passed. Finished rows — the worker never picks them up.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { apiKeys, members, qaRuns } from "../../../schema/app";
import type { SeedTx } from "../types";

const MIN = 60_000;
const DAY = 86_400_000;

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  const now = Date.now();
  const byEmail = async (email: string): Promise<string | null> => {
    const [m] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.email, email)));
    return m?.id ?? null;
  };

  const keys: Array<{
    name: string;
    scopes: Array<"read" | "write">;
    resources: Array<"incidents" | "monitors" | "services"> | null;
    by: string;
    usedAgo: number;
    expiresIn: number;
  }> = [
    {
      name: "terraform-ci",
      scopes: ["read", "write"],
      resources: ["incidents", "monitors"],
      by: "karim@skylark.dev",
      usedAgo: 12 * MIN,
      expiresIn: 9 * DAY + 2 * 3_600_000,
    },
    {
      name: "grafana-annotations",
      scopes: ["read"],
      resources: ["incidents"],
      by: "amelie@skylark.dev",
      usedAgo: 2 * 60 * MIN,
      expiresIn: 335 * DAY,
    },
    {
      name: "backstage-sync",
      scopes: ["read"],
      resources: ["services"],
      by: "lucas@skylark.dev",
      usedAgo: 3 * DAY,
      expiresIn: 81 * DAY + 2 * 3_600_000,
    },
  ];
  for (const k of keys) {
    const values = {
      scopes: k.scopes,
      resources: k.resources,
      lastUsedAt: new Date(now - k.usedAgo),
      expiresAt: new Date(now + k.expiresIn),
      revokedAt: null,
    };
    const [existing] = await tx
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.name, k.name)));
    if (existing) {
      await tx.update(apiKeys).set(values).where(eq(apiKeys.id, existing.id));
      continue;
    }
    const secret = `oi_live_${randomBytes(16).toString("hex")}`;
    await tx.insert(apiKeys).values({
      tenantId,
      name: k.name,
      keyHash: createHash("sha256").update(secret).digest("hex"),
      prefix: secret.slice(0, 12),
      lastFour: secret.slice(-4),
      createdByMemberId: await byEmail(k.by),
      createdAt: new Date(now - 40 * DAY),
      ...values,
    });
  }

  const owner = await byEmail("amelie@skylark.dev");
  const runs: Array<{
    suite: "smoke" | "unit" | "typecheck" | "lint" | "format";
    command: string;
    status: "passed" | "failed";
    seconds: number;
    summary: Record<string, unknown>;
  }> = [
    {
      suite: "smoke",
      command: "pnpm --filter @openincident/smoke exec playwright test",
      status: "failed",
      seconds: 372,
      summary: {
        total: 48,
        passed: 45,
        failed: 3,
        failures: [
          {
            title: "Status pages › a subscriber confirms by email",
            location: "status-pages.spec.ts",
          },
          { title: "Teams › a pairing code links the workspace", location: "teams.spec.ts" },
          { title: "Trackers › GitHub follow-up export", location: "trackers.spec.ts" },
        ],
      },
    },
    {
      suite: "unit",
      command: "pnpm turbo run test",
      status: "passed",
      seconds: 100,
      summary: { total: 1412, passed: 1412, failed: 0 },
    },
    {
      suite: "typecheck",
      command: "pnpm turbo run typecheck",
      status: "passed",
      seconds: 38,
      summary: {},
    },
    { suite: "lint", command: "pnpm turbo run lint", status: "passed", seconds: 22, summary: {} },
    {
      suite: "format",
      command: "pnpm prettier --check .",
      status: "passed",
      seconds: 9,
      summary: {},
    },
  ];
  const finished = new Date(now - 2 * 60 * MIN);
  for (const r of runs) {
    const values = {
      status: r.status,
      exitCode: r.status === "passed" ? 0 : 1,
      summary: r.summary,
      log: `$ ${r.command}\n(demo run)\n`,
      queuedAt: new Date(finished.getTime() - r.seconds * 1000 - 5000),
      startedAt: new Date(finished.getTime() - r.seconds * 1000),
      finishedAt: finished,
    };
    const [existing] = await tx
      .select({ id: qaRuns.id })
      .from(qaRuns)
      .where(
        and(
          eq(qaRuns.tenantId, tenantId),
          eq(qaRuns.suite, r.suite),
          eq(qaRuns.command, r.command),
        ),
      );
    if (existing) await tx.update(qaRuns).set(values).where(eq(qaRuns.id, existing.id));
    else
      await tx.insert(qaRuns).values({
        tenantId,
        suite: r.suite,
        command: r.command,
        triggeredByMemberId: owner,
        triggeredByName: "Amélie Laurent",
        ...values,
      });
  }
}
