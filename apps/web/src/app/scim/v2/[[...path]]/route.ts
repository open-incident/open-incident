import { scimHandlers } from "@openincident/ee-web/scim";
import { withTenant, workspaces } from "@openincident/db";
import { eq } from "drizzle-orm";
import { entitlementsFor } from "@/lib/entitlements";
import { sendMemberInvite } from "@/lib/member-invite";

export const dynamic = "force-dynamic";

/* The SCIM 2.0 endpoint of a workspace — served here, implemented in ee/web. */
const handlers = scimHandlers({
  entitled: (tenant) => entitlementsFor(tenant).sso,
  inviteMember: async (tenant, member) => {
    const name = await withTenant(tenant.id, async (tx) => {
      const [w] = await tx
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.tenantId, tenant.id));
      return w?.name ?? "Open Incident";
    });
    await sendMemberInvite(tenant, name, member, "SCIM provisioning");
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = handlers;
