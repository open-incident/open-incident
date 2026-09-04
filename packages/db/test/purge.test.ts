import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { putObject, storageConfigured, tenantPrefix } from "@openincident/storage";
import { adminClient, provisionWorkspace } from "../src/provision";
import { purgeWorkspace } from "../src/purge";

/**
 * The purge is proven on a throwaway workspace: the defaults installed at provisioning
 * (types, statuses, severities, roles…), a directory lookup, an object in storage when the instance has one — then
 * nothing must remain, and the report must say so from real counts.
 */
describe("workspace purge", () => {
  it("erases a throwaway workspace and verifies that nothing remains", async () => {
    const slug = `purge-${randomUUID().slice(0, 8)}`;
    const result = await provisionWorkspace({
      slug,
      name: "Purge me",
      owner: { email: `owner-${slug}@example.test`, name: "Owner" },
    });
    const { db, end } = adminClient();
    try {
      await db.execute(sql`select set_config('app.tenant_id', ${result.tenantId}, false)`);
      await db.execute(
        sql`insert into directory.api_key_lookup (key_hash, tenant_id) values (${"probe-" + slug}, ${result.tenantId})`,
      );
    } finally {
      await end();
    }
    if (storageConfigured())
      await putObject(
        `${tenantPrefix(result.tenantId)}brand/probe.txt`,
        Buffer.from("x"),
        "text/plain",
      );

    const report = await purgeWorkspace(slug);
    expect(report).not.toBeNull();
    expect(report!.remaining).toEqual([]);
    expect(report!.rowsDeleted).toBeGreaterThan(5);
    expect(report!.accountsRemoved).toBe(0); // the owner never signed in: no auth account existed
    if (storageConfigured()) expect(report!.objectsDeleted).toBe(1);
    expect(report!.tablesChecked).toBeGreaterThan(50);

    // And the workspace is gone from the directory.
    const again = await purgeWorkspace(slug);
    expect(again).toBeNull();
  }, 60_000);
});
