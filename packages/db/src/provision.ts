/**
 * Creating a workspace — the ONE write to `directory.tenants` this repository
 * performs, and it runs as the database owner: the application role reads the
 * directory and never writes it. Two callers: the `workspace:create` command on
 * a self-hosted instance, and the demo seed. A control plane does the same
 * steps from its own side.
 *
 * Idempotent on the slug: an existing workspace is returned, not duplicated,
 * so the demo seed can replay on a database it already populated.
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { members, workspaces } from "./schema/app";
import { tenants } from "./schema/directory";
import { installDefaults, type InstalledDefaults } from "./seed/defaults";

export type ProvisionInput = {
  slug: string;
  name: string;
  locale?: string;
  timezone?: string;
  accentColor?: string;
  owner: { email: string; name: string; status?: "invited" | "active" };
};

export type ProvisionResult = {
  tenantId: string;
  ownerMemberId: string;
  created: boolean;
  defaults: InstalledDefaults | null;
};

export function adminConnectionString(): string {
  return (
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgres://openincident:openincident@localhost:5441/openincident"
  );
}

/** A short-lived owner connection — closed by the caller through `end()`. */
export function adminClient() {
  const client = postgres(adminConnectionString(), { max: 1, prepare: false });
  return { db: drizzle(client, { schema }), end: () => client.end() };
}

export async function provisionWorkspace(input: ProvisionInput): Promise<ProvisionResult> {
  const { db, end } = adminClient();
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(tenants).where(eq(tenants.slug, input.slug));
      const tenant =
        existing ??
        (await tx.insert(tenants).values({ slug: input.slug, status: "active" }).returning())[0]!;
      const tenantId = tenant.id;
      // The owner bypasses RLS, but the context is set anyway: the same code
      // must work under a role that does not.
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

      await tx
        .insert(workspaces)
        .values({
          tenantId,
          name: input.name,
          locale: input.locale ?? "en",
          timezone: input.timezone ?? "Europe/Paris",
          branding: input.accentColor ? { accentColor: input.accentColor } : {},
        })
        .onConflictDoNothing();

      const defaults = await installDefaults(tx, tenantId, input.locale ?? "en");

      const [owner] = await tx
        .insert(members)
        .values({
          tenantId,
          email: input.owner.email.toLowerCase(),
          name: input.owner.name,
          role: "owner",
          status: input.owner.status ?? "invited",
        })
        .onConflictDoNothing()
        .returning({ id: members.id });
      const ownerId =
        owner?.id ??
        (
          await tx
            .select({ id: members.id })
            .from(members)
            .where(eq(members.tenantId, tenantId))
            .orderBy(members.createdAt)
            .limit(1)
        )[0]!.id;

      return { tenantId, ownerMemberId: ownerId, created: !existing, defaults };
    });
  } finally {
    await end();
  }
}
