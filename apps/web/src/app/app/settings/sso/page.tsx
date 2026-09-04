import {
  listSsoConnections,
  SsoSettings,
  Unavailable,
  type Translate,
} from "@openincident/ee-web/sso";
import { getT } from "@/i18n/server";
import { entitlementsFor } from "@/lib/entitlements";
import { requireMember } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import { createSso, removeSso } from "./actions";

/** Settings → Single sign-on — the shell; the screen lives in ee/web. */
export default async function SsoPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; removed?: string; error?: string; detail?: string }>;
}) {
  const { tenant } = await requireMember();
  const t = (await getT()) as unknown as Translate;
  const params = await searchParams;
  const entitled = entitlementsFor(tenant).sso;
  const connections = entitled ? await listSsoConnections(tenant.id) : [];
  const notice = params.saved
    ? ({ kind: "saved" } as const)
    : params.removed
      ? ({ kind: "removed" } as const)
      : params.error
        ? ({ kind: "error", code: params.error, detail: params.detail } as const)
        : undefined;
  return (
    <SsoSettings
      deps={{
        t,
        origin: await currentOrigin(),
        tenantId: tenant.id,
        entitled,
        unavailable: <Unavailable t={t} />,
      }}
      connections={connections}
      notice={notice}
      actions={{ create: createSso, remove: removeSso }}
    />
  );
}
