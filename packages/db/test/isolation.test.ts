/**
 * Tenant isolation — the mechanism, not a sample.
 *
 * Two workspaces are provisioned as the owner; every read and write below runs
 * as the APPLICATION role (DATABASE_URL), the one the product uses. The test
 * then tries what a bug would try: read another workspace's incidents inside
 * its own context, read with no context at all, and write a row that names a
 * workspace it is not in. Row-level security must return nothing and accept
 * nothing. It also fails on purpose when DATABASE_URL is the owner: the
 * policies would exist on paper and be out of effect.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withTenant } from "../src/client";
import { adminClient, provisionWorkspace } from "../src/provision";
import { incidentTypes, incidents, members, probes } from "../src/schema/app";
import { tenants } from "../src/schema/directory";

const run = randomUUID().slice(0, 8);

/** Drizzle wraps the driver's error ("Failed query: …"); the reason sits in `cause`. */
function rootMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  return `${e?.cause?.message ?? ""} ${e?.message ?? ""}`;
}
async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (err) {
    return rootMessage(err);
  }
}
const slugA = `iso-a-${run}`;
const slugB = `iso-b-${run}`;
let tenantA = "";
let tenantB = "";

beforeAll(async () => {
  tenantA = (
    await provisionWorkspace({
      slug: slugA,
      name: "Isolation A",
      owner: { email: `a-${run}@iso.test`, name: "A" },
    })
  ).tenantId;
  tenantB = (
    await provisionWorkspace({
      slug: slugB,
      name: "Isolation B",
      owner: { email: `b-${run}@iso.test`, name: "B" },
    })
  ).tenantId;
});

afterAll(async () => {
  const admin = adminClient();
  try {
    await admin.db.delete(tenants).where(eq(tenants.slug, slugA));
    await admin.db.delete(tenants).where(eq(tenants.slug, slugB));
    // The instance probe belongs to no workspace, so no cascade takes it away.
    await admin.db.delete(probes).where(eq(probes.name, `probe-shared-${run}`));
  } finally {
    await admin.end();
  }
});

async function declare(tenantId: string, name: string) {
  return withTenant(tenantId, async (tx) => {
    const [type] = await tx
      .select({ id: incidentTypes.id })
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenantId));
    const [row] = await tx
      .insert(incidents)
      .values({ tenantId, number: 1, name, typeId: type!.id, phase: "active" })
      .returning({ id: incidents.id });
    return row!.id;
  });
}

describe("row-level security", () => {
  it("runs as a role that does not own the tables", async () => {
    const [row] = await db.execute<{ current_user: string; owner: string }>(
      sql`select current_user::text as current_user, tableowner::text as owner from pg_tables where schemaname = 'app' and tablename = 'incidents'`,
    );
    expect(row?.owner, "app.incidents has an owner").toBeTruthy();
    expect(
      row?.current_user,
      "DATABASE_URL must not be the table owner — an owner bypasses RLS",
    ).not.toBe(row?.owner);
  });

  it("lets a workspace read its own rows and nobody else's", async () => {
    await declare(tenantA, "A's incident");
    await declare(tenantB, "B's incident");

    const seenByA = await withTenant(tenantA, (tx) =>
      tx.select({ name: incidents.name }).from(incidents),
    );
    expect(seenByA.map((r) => r.name)).toEqual(["A's incident"]);

    // The bug this guards against: a query that forgets the tenant filter. Even
    // asking for B's row by its tenant id, inside A's context, returns nothing.
    const cross = await withTenant(tenantA, (tx) =>
      tx.select().from(incidents).where(eq(incidents.tenantId, tenantB)),
    );
    expect(cross).toEqual([]);

    const membersOfBSeenByA = await withTenant(tenantA, (tx) =>
      tx.select().from(members).where(eq(members.tenantId, tenantB)),
    );
    expect(membersOfBSeenByA).toEqual([]);
  });

  it("returns nothing outside a tenant context", async () => {
    const rows = await db.select().from(incidents);
    expect(rows).toEqual([]);
  });

  it("refuses a write that names another workspace", async () => {
    const reason = await reasonOf(
      withTenant(tenantA, async (tx) => {
        const [type] = await tx
          .select({ id: incidentTypes.id })
          .from(incidentTypes)
          .where(eq(incidentTypes.tenantId, tenantA));
        await tx.insert(incidents).values({
          tenantId: tenantB,
          number: 99,
          name: "smuggled",
          typeId: type!.id,
          phase: "active",
        });
      }),
    );
    expect(reason).toMatch(/row-level security/);

    const smuggled = await withTenant(tenantB, (tx) =>
      tx
        .select()
        .from(incidents)
        .where(and(eq(incidents.tenantId, tenantB), eq(incidents.number, 99))),
    );
    expect(smuggled).toEqual([]);
  });

  it("cannot update or delete across workspaces", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(incidents)
        .set({ name: "renamed by A" })
        .where(eq(incidents.tenantId, tenantB))
        .returning({ id: incidents.id }),
    );
    expect(updated).toEqual([]);
    const deleted = await withTenant(tenantA, (tx) =>
      tx.delete(incidents).where(eq(incidents.tenantId, tenantB)).returning({ id: incidents.id }),
    );
    expect(deleted).toEqual([]);
    const stillThere = await withTenant(tenantB, (tx) =>
      tx.select({ name: incidents.name }).from(incidents),
    );
    expect(stillThere).toEqual([{ name: "B's incident" }]);
  });

  /**
   * The one table with rows that belong to no workspace. A probe run by the
   * instance is shared by everyone, so its `tenant_id` is null — and `NULL =
   * uuid` is never true, which made the general policy hide those rows from
   * the application for ever. Whoever shipped the probes would have lost half
   * a day to it.
   */
  it("lets a workspace read the instance's probes and never write one", async () => {
    const admin = adminClient();
    const shared = `probe-shared-${run}`;
    try {
      await admin.db.insert(probes).values({ tenantId: null, name: shared, region: "eu-west" });
    } finally {
      await admin.end();
    }

    const seen = await withTenant(tenantA, (tx) =>
      tx.select({ name: probes.name, tenantId: probes.tenantId }).from(probes),
    );
    expect(seen.map((p) => p.name)).toContain(shared);

    // Its own probe is visible to it and to nobody else.
    await withTenant(tenantA, (tx) =>
      tx.insert(probes).values({ tenantId: tenantA, name: `probe-a-${run}`, region: "eu-west" }),
    );
    const byB = await withTenant(tenantB, (tx) => tx.select({ name: probes.name }).from(probes));
    expect(byB.map((p) => p.name)).toContain(shared);
    expect(byB.map((p) => p.name)).not.toContain(`probe-a-${run}`);

    // Reading the instance's probes is not writing them: a workspace cannot
    // add one, cannot rename one, cannot delete one.
    expect(
      await reasonOf(
        withTenant(tenantA, (tx) =>
          tx.insert(probes).values({ tenantId: null, name: `probe-x-${run}`, region: "eu-west" }),
        ),
      ),
    ).toMatch(/row-level security/);
    const renamed = await withTenant(tenantA, (tx) =>
      tx
        .update(probes)
        .set({ name: "stolen" })
        .where(eq(probes.name, shared))
        .returning({ id: probes.id }),
    );
    expect(renamed).toEqual([]);
    const removed = await withTenant(tenantA, (tx) =>
      tx.delete(probes).where(eq(probes.name, shared)).returning({ id: probes.id }),
    );
    expect(removed).toEqual([]);
    const survived = await withTenant(tenantB, (tx) =>
      tx.select({ name: probes.name }).from(probes),
    );
    expect(survived.map((p) => p.name)).toContain(shared);
  });

  it("keeps the directory readable and the app role away from writing it", async () => {
    const [a] = await db.select().from(tenants).where(eq(tenants.slug, slugA));
    expect(a?.id).toBe(tenantA);
    expect(await reasonOf(db.insert(tenants).values({ slug: `iso-x-${run}` }))).toMatch(
      /permission denied/,
    );
  });
});
