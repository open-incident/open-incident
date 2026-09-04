import { and, eq, sql } from "drizzle-orm";
import { members, withTenant } from "@openincident/db";
import { getScimSettings, ScimSettings } from "@openincident/ee-web/scim";
import { Unavailable, type Translate } from "@openincident/ee-web/sso";
import { getT } from "@/i18n/server";
import { entitlementsFor } from "@/lib/entitlements";
import { requireMember } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import { issueScim, saveScimOptions, toggleScim } from "./actions";

/** Settings → Provisioning (SCIM) — the shell; the screen lives in ee/web. */
export default async function ScimPage() {
  const { tenant } = await requireMember();
  const t = (await getT()) as unknown as Translate;
  const entitled = entitlementsFor(tenant).sso;
  const settings = entitled ? await getScimSettings(tenant.id) : null;
  const provisionedCount = entitled
    ? await withTenant(tenant.id, async (tx) => {
        const [row] = await tx
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(members)
          .where(and(eq(members.tenantId, tenant.id), eq(members.source, "scim")));
        return row?.n ?? 0;
      })
    : 0;
  return (
    <ScimSettings
      deps={{
        t,
        origin: await currentOrigin(),
        tenantId: tenant.id,
        entitled,
        unavailable: <Unavailable t={t} />,
      }}
      settings={settings}
      provisionedCount={provisionedCount}
      actions={{ issue: issueScim, toggle: toggleScim, saveOptions: saveScimOptions }}
    />
  );
}
