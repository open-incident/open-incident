/**
 * Demo rows the V2 design shows for migrate — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part migrate`.
 * Owner: migrate.
 *
 * Skylark is half-way off Opsgenie, the way the design shows it: the account
 * was read ten days ago, the people matched, the import made (inactive),
 * shadow mode has been comparing for nine days, and Platform is switched.
 *
 * Nothing here is written by hand: the real migration runs, step by step,
 * against Skylark's Opsgenie account as the demo knows it (an account that
 * lives in memory, packages/migrate-opsgenie/src/demo-account.ts). The rows
 * are therefore exactly what the wizard would have written.
 *
 * Skipped on the smoke suite's throwaway workspaces (`smoke-…`): the suite
 * walks the wizard from its first step, against its own mock.
 */
import { and, eq } from "drizzle-orm";
import { members } from "../../schema/app";
import { migrationItems, migrationRuns } from "../../schema/migration";
import { tenants } from "../../schema/directory";
import {
  OpsgenieClient,
  alertFromWebhook,
  checkKey,
  compareSchedule,
  importInactive,
  latestRun,
  peopleIndex,
  peopleOf,
  readInventory,
  recordShadow,
  resolvePerson,
  saveConnection,
  setConfirmation,
  setStep,
  shapeSchedule,
  storeInventory,
  switchTeam,
  translationsFor,
  windowQuery,
} from "../../../../migrate-opsgenie/src/index";
import { createDemoAccount, DEMO_KEYS } from "../../../../migrate-opsgenie/src/demo-account";
import type { OgAlert } from "../../../../migrate-opsgenie/src/types";
import type { SeedTx } from "./types";

const DAY = 86_400_000;

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  const [t] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t || t.slug.startsWith("smoke-")) return;
  if (await latestRun(tx, tenantId)) return;

  const now = new Date();
  const readAt = new Date(now.getTime() - 10 * DAY);
  const importedAt = new Date(now.getTime() - 9 * DAY);
  const account = createDemoAccount({ now });
  const client = new OpsgenieClient({
    region: "eu",
    key: DEMO_KEYS.global,
    fetch: account.fetch,
    sleep: async () => {},
  });
  const memberRows = await tx
    .select({ id: members.id, email: members.email, name: members.name, status: members.status })
    .from(members)
    .where(eq(members.tenantId, tenantId));
  const byEmail = (e: string) => memberRows.find((m: { email: string }) => m.email === e);
  const owner = byEmail("amelie@skylark.dev") ?? memberRows[0];

  // 1. Connect.
  const checks = await checkKey(client);
  const run = await saveConnection(tx, tenantId, {
    region: "eu",
    key: DEMO_KEYS.global,
    checks,
    memberId: owner?.id ?? null,
    account: checks.account.name ?? null,
  });

  // 2. Inventory, ten days ago.
  const snap = await readInventory(client, readAt);
  await storeInventory(tx, tenantId, run.id, snap);

  // 3. People: Lucas under his Open Incident email, Ana's slots to Nadia, Sam invited.
  for (const p of await peopleOf(tx, run.id)) {
    if (!p.conflict) continue;
    if (p.conflict === "different_email") {
      const m = memberRows.find(
        (x: { name: string }) => x.name.toLowerCase() === (p.externalName ?? "").toLowerCase(),
      );
      if (m) await resolvePerson(tx, run.id, p.externalUserId, { kind: "member", memberId: m.id });
    } else if (p.conflict === "blocked_but_scheduled") {
      const nadia = byEmail("nadia@skylark.dev");
      if (nadia)
        await resolvePerson(tx, run.id, p.externalUserId, { kind: "member", memberId: nadia.id });
      else await resolvePerson(tx, run.id, p.externalUserId, { kind: "gap" });
    } else if (p.conflict === "not_a_member" && p.futureSlots > 0 && p.externalEmail) {
      const [invited] = await tx
        .insert(members)
        .values({
          tenantId,
          email: p.externalEmail.toLowerCase(),
          name: p.externalName ?? p.externalEmail,
          role: "responder",
          status: "invited",
        })
        .onConflictDoNothing()
        .returning({ id: members.id });
      const id =
        invited?.id ??
        (
          await tx
            .select({ id: members.id })
            .from(members)
            .where(
              and(eq(members.tenantId, tenantId), eq(members.email, p.externalEmail.toLowerCase())),
            )
        )[0]?.id;
      if (id) await resolvePerson(tx, run.id, p.externalUserId, { kind: "invite", memberId: id });
    }
  }
  for (const tr of translationsFor(snap)) await setConfirmation(tx, run.id, tr.kind, true);
  await setStep(tx, run.id, { step: "preview", steps: { people: "done" } });

  // 4. Preview: Sam's invitation is pending, so his weekend slots go to Karim, one click each.
  const people = peopleIndex(await peopleOf(tx, run.id));
  const active = new Set(
    memberRows
      .filter((m: { status: string }) => m.status === "active")
      .map((m: { id: string }) => m.id),
  );
  const names = new Map(snap.users.map((u) => [u.id, u.fullName]));
  const karim = byEmail("karim@skylark.dev");
  for (const s of snap.schedules) {
    const shape = shapeSchedule(s, people);
    const diffs = compareSchedule(
      s,
      shape,
      people,
      active,
      names,
      readAt,
      new Date(readAt.getTime() + 56 * DAY),
    );
    const fixes = diffs
      .filter((d) => d.cause === "pending" && karim)
      .map((d) => ({
        partKey: d.partKey,
        start: d.start.toISOString(),
        end: d.end.toISOString(),
        memberId: karim!.id,
      }));
    if (!fixes.length) continue;
    const [item] = await tx
      .select()
      .from(migrationItems)
      .where(
        and(
          eq(migrationItems.runId, run.id),
          eq(migrationItems.type, "schedule"),
          eq(migrationItems.externalId, s.id),
        ),
      );
    if (item)
      await tx
        .update(migrationItems)
        .set({ data: { ...(item.data as Record<string, unknown>), fixes } })
        .where(eq(migrationItems.id, item.id));
  }

  // Import, inactive, nine days ago.
  const fresh = (await tx.select().from(migrationRuns).where(eq(migrationRuns.id, run.id)))[0]!;
  await importInactive(tx, tenantId, fresh, owner?.id ?? null, importedAt);

  // 5. Shadow mode. Last Saturday, someone gave Lucas a Payments weekend shift
  // in Opsgenie — after the inventory was read.
  const saturday = new Date(now.getTime() - ((new Date(now).getUTCDay() + 1) % 7) * DAY);
  saturday.setUTCHours(7, 0, 0, 0);
  account.addOverride(
    "payments",
    "payments-weekend",
    "lucas",
    saturday,
    new Date(saturday.getTime() + 12 * 3_600_000),
  );
  const forwarded = await client.listAll<OgAlert>(
    "/v2/alerts",
    { query: windowQuery(importedAt, now), order: "asc", sort: "createdAt" },
    3_000,
  );
  for (const [i, a] of forwarded.entries()) {
    if (i % 3 !== 0) continue;
    const view = alertFromWebhook({
      action: "Create",
      alert: {
        alertId: a.id,
        message: a.message,
        tags: a.tags,
        alias: a.alias,
        createdAt: new Date(a.createdAt).getTime(),
        teams: (a.teams ?? []).map((x) => x.id),
        priority: a.priority,
        source: a.source,
        entity: a.entity,
        details: a.details,
      },
    });
    if (view) await recordShadow((fn) => fn(tx), tenantId, run.id, view, client);
  }

  // A checkout alert two afternoons ago: Opsgenie's rule only holds at night,
  // the imported one has no hours — the one disagreement on Storefront.
  const afternoon = new Date(now.getTime() - 2 * DAY);
  afternoon.setUTCHours(14, 40, 0, 0);
  const checkout = alertFromWebhook(
    account.webhookFor("sentry", afternoon, { priority: "P3", message: "checkout p99 > 2 s" }),
  );
  if (checkout) await recordShadow((fn) => fn(tx), tenantId, run.id, checkout, client);

  // 6. Platform is switched; the others wait.
  const afterImport = (
    await tx.select().from(migrationRuns).where(eq(migrationRuns.id, run.id))
  )[0]!;
  const platform = snap.teams.find((x) => x.name === "Platform");
  if (platform) await switchTeam(tx, tenantId, afterImport, platform.id, owner?.id ?? null);
  await setStep(tx, run.id, { step: "switch", steps: { shadow: "done" } });
}
