import { listRoles, RolesSettings } from "@openincident/ee-web/roles";
import { Unavailable, type Translate } from "@openincident/ee-web/sso";
import { getT } from "@/i18n/server";
import { entitlementsFor } from "@/lib/entitlements";
import { requireMember } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import { removeRole, saveRole } from "./actions";

/** Settings → Custom roles — the shell; the screen lives in ee/web. */
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; removed?: string; error?: string; detail?: string }>;
}) {
  const { tenant } = await requireMember();
  const t = (await getT()) as unknown as Translate;
  const params = await searchParams;
  const entitled = entitlementsFor(tenant).customRoles;
  const roles = entitled ? await listRoles(tenant.id) : [];
  const notice = params.saved
    ? ({ kind: "saved" } as const)
    : params.removed
      ? ({ kind: "removed" } as const)
      : params.error
        ? ({ kind: "error", code: params.error, detail: params.detail } as const)
        : undefined;
  return (
    <RolesSettings
      deps={{
        t,
        origin: await currentOrigin(),
        tenantId: tenant.id,
        entitled,
        unavailable: <Unavailable t={t} />,
      }}
      roles={roles}
      notice={notice}
      actions={{ save: saveRole, remove: removeRole }}
    />
  );
}
