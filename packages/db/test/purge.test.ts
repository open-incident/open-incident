import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { putObject, storageConfigured, tenantPrefix } from "@openincident/storage";
import { clickhouse, telemetryInstalled } from "@openincident/telemetry";
import { adminClient, provisionWorkspace } from "../src/provision";
import { purgeWorkspace } from "../src/purge";

/**
 * The purge is proven on a throwaway workspace: the defaults installed at provisioning
 * (types, statuses, severities, roles…), a directory lookup, an object in storage when the instance has one,
 * a span in ClickHouse when the telemetry module is there — then nothing must
 * remain, and the report must say so from real counts.
 *
 * The telemetry half matters more than its size suggests: it is a second store
 * with its own deletion semantics, and a purge that empties PostgreSQL while
 * leaving a month of spans behind satisfies nobody, least of all a regulator.
 */
describe("workspace purge", () => {
  it("erases a throwaway workspace and verifies that nothing remains", async () => {
    const slug = `purge-${randomUUID().slice(0, 8)}`;
    const providerId = `oi-${slug}-oidc`;
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
      /*
       * An SSO connection and its Better Auth half.
       *
       * These are two rows in two schemas joined only by `provider_id`, and
       * `auth.sso_provider` has no tenant column — so deleting the app row
       * first makes the auth row unreachable for ever. It used to: a purged
       * workspace left one provider behind per connection while the command
       * still reported "nothing remains", because the check counted `app`,
       * `directory` and storage and stopped there.
       */
      await db.execute(sql`
        insert into app.sso_connections (tenant_id, provider_id, kind, label)
        values (${result.tenantId}, ${providerId}, 'oidc', 'Purge me')`);
      await db.execute(sql`
        insert into auth.sso_provider (id, issuer, domain, oidc_config, provider_id, organization_id)
        values (${providerId}, 'http://127.0.0.1:3195', 'purge.example', '{}', ${providerId}, ${result.tenantId})`);
    } finally {
      await end();
    }
    if (storageConfigured())
      await putObject(
        `${tenantPrefix(result.tenantId)}brand/probe.txt`,
        Buffer.from("x"),
        "text/plain",
      );

    if (telemetryInstalled()) {
      const now = new Date().toISOString().replace("T", " ").replace("Z", "");
      await clickhouse().insert({
        table: "otel_logs",
        format: "JSONEachRow",
        values: [
          {
            tenant_id: result.tenantId,
            service_id: randomUUID(),
            service_name: "purge-probe",
            environment: "test",
            ts: now,
            observed_ts: now,
            severity_number: 9,
            severity_text: "INFO",
            body: "this line must not survive the purge",
            trace_id: "",
            span_id: "",
            scope_name: "test",
            attributes: {},
            resource_attributes: {},
            retention_at: "2099-01-01 00:00:00",
          },
        ],
      });
      await clickhouse().command({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
    }

    const report = await purgeWorkspace(slug);
    expect(report).not.toBeNull();
    expect(report!.remaining).toEqual([]);
    expect(report!.rowsDeleted).toBeGreaterThan(5);
    expect(report!.accountsRemoved).toBe(0); // the owner never signed in: no auth account existed
    expect(report!.ssoProvidersRemoved).toBe(1);
    if (storageConfigured()) expect(report!.objectsDeleted).toBe(1);
    // Zero rows left, not "we asked nicely": purgeTenant waits for the mutation
    // and counts what is still there.
    expect(report!.telemetryLeft).toBe(telemetryInstalled() ? 0 : null);
    expect(report!.tablesChecked).toBeGreaterThan(50);

    // And the workspace is gone from the directory.
    const again = await purgeWorkspace(slug);
    expect(again).toBeNull();
  }, 60_000);
});
