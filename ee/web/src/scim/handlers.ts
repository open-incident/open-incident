/**
 * The SCIM 2.0 endpoint: one handler per verb, routed on the path under
 * /scim/v2. The workspace comes from the host (the app's middleware headers),
 * the token from the Authorization header; every write runs in the
 * workspace's transaction and leaves an audit line.
 */
import {
  getTenantByCustomDomain,
  getTenantBySlug,
  ssoConnections,
  withTenant,
} from "@openincident/db";
import { eq } from "drizzle-orm";
import {
  ScimError,
  listResponse,
  paging,
  parseEqFilter,
  parsePatch,
  readJsonBody,
  resourceTypes,
  schemas,
  scimError,
  scimJson,
  serviceProviderConfig,
} from "./protocol";
import { authenticateScim, type ScimSettingsRow } from "./store";
import {
  createMember,
  deactivateMember,
  getMember,
  listMembers,
  patchMember,
  readUser,
  replaceMember,
  toScimUser,
  type MemberRow,
} from "./users";
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  patchGroup,
  replaceGroup,
  toScimGroup,
} from "./groups";

export type ScimDeps = {
  /** Whether the workspace is entitled to SSO/SCIM on this instance. */
  entitled: (tenant: { id: string; entitlements: unknown }) => boolean;
  /** Sends the invitation email to a member the provider created (when the settings ask for it). */
  inviteMember?: (tenant: { id: string }, member: { id: string; email: string }) => Promise<void>;
};

type Ctx = {
  tenantId: string;
  settings: ScimSettingsRow;
  base: string;
  url: URL;
};

async function resolveTenant(request: Request) {
  const slug = request.headers.get("x-tenant-slug");
  if (slug) return getTenantBySlug(slug);
  const host = request.headers.get("x-tenant-host");
  if (host) return getTenantByCustomDomain(host);
  return null;
}

function baseOf(request: Request): string {
  const proto =
    request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    new URL(request.url).host;
  return `${proto}://${host}/scim/v2`;
}

function pathOf(request: Request): string[] {
  const path = new URL(request.url).pathname.replace(/^\/scim\/v2\/?/, "");
  return path.split("/").filter(Boolean).map(decodeURIComponent);
}

async function withScim(
  request: Request,
  deps: ScimDeps,
  fn: (ctx: Ctx, body: unknown) => Promise<Response>,
): Promise<Response> {
  try {
    const tenant = await resolveTenant(request);
    if (!tenant) return scimError(404, "No workspace at this host");
    if (!deps.entitled(tenant))
      return scimError(403, "SCIM provisioning is not enabled on this instance");
    const settings = await authenticateScim(tenant.id, request.headers.get("authorization"));
    if (!settings)
      return scimJson(
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          status: "401",
          detail: "Invalid or missing bearer token",
        },
        401,
        { "www-authenticate": 'Bearer realm="scim"' },
      );
    const body = ["POST", "PUT", "PATCH"].includes(request.method)
      ? readJsonBody(await request.text())
      : {};
    return await fn(
      { tenantId: tenant.id, settings, base: baseOf(request), url: new URL(request.url) },
      body,
    );
  } catch (e) {
    if (e instanceof ScimError) return scimError(e.status, e.message, e.scimType);
    throw e;
  }
}

/** Members created by the provider are active when SSO lets them in; invited (with the email) otherwise. */
async function newMemberStatus(tenantId: string): Promise<"active" | "invited"> {
  const n = await withTenant(
    tenantId,
    async (tx) =>
      (
        await tx
          .select({ id: ssoConnections.id })
          .from(ssoConnections)
          .where(eq(ssoConnections.tenantId, tenantId))
      ).length,
  );
  return n > 0 ? "active" : "invited";
}

export function scimHandlers(deps: ScimDeps) {
  const GET = (request: Request) =>
    withScim(request, deps, async (ctx) => {
      const [resource, id] = pathOf(request);
      if (resource === "ServiceProviderConfig") return scimJson(serviceProviderConfig(ctx.base));
      if (resource === "ResourceTypes")
        return id
          ? scimJson(
              resourceTypes(ctx.base).find((r) => r.id === id) ??
                scimError(404, "No such resource type"),
            )
          : scimJson(listResponse(resourceTypes(ctx.base), 2, 1));
      if (resource === "Schemas")
        return id
          ? scimJson(schemas(ctx.base).find((s) => s.id === id) ?? scimError(404, "No such schema"))
          : scimJson(listResponse(schemas(ctx.base), 2, 1));
      const filter = parseEqFilter(ctx.url.searchParams.get("filter"));
      const { startIndex, count } = paging(ctx.url);
      if (resource === "Users") {
        return withTenant(ctx.tenantId, async (tx) => {
          if (id) return scimJson(toScimUser(await getMember(tx, ctx.tenantId, id), ctx.base));
          const { rows, total } = await listMembers(tx, ctx.tenantId, filter, startIndex, count);
          return scimJson(
            listResponse(
              rows.map((m) => toScimUser(m, ctx.base)),
              total,
              startIndex,
            ),
          );
        });
      }
      if (resource === "Groups") {
        return withTenant(ctx.tenantId, async (tx) => {
          if (id)
            return scimJson(
              await toScimGroup(tx, ctx.tenantId, await getGroup(tx, ctx.tenantId, id), ctx.base),
            );
          const { rows, total } = await listGroups(tx, ctx.tenantId, filter, startIndex, count);
          const resources = [];
          for (const e of rows) resources.push(await toScimGroup(tx, ctx.tenantId, e, ctx.base));
          return scimJson(listResponse(resources, total, startIndex));
        });
      }
      return scimError(404, `Unknown resource ${resource ?? ""}`);
    });

  const POST = (request: Request) =>
    withScim(request, deps, async (ctx, body) => {
      const [resource] = pathOf(request);
      if (resource === "Users") {
        const status = await newMemberStatus(ctx.tenantId);
        const created: MemberRow = await withTenant(ctx.tenantId, (tx) =>
          createMember(tx, ctx.tenantId, readUser(body), {
            role: ctx.settings.defaultRole,
            status,
          }),
        );
        if (status === "invited" && ctx.settings.sendInvites && deps.inviteMember)
          await deps
            .inviteMember({ id: ctx.tenantId }, { id: created.id, email: created.email })
            .catch(() => undefined);
        return scimJson(toScimUser(created, ctx.base), 201, {
          location: `${ctx.base}/Users/${created.id}`,
        });
      }
      if (resource === "Groups") {
        return withTenant(ctx.tenantId, async (tx) => {
          const row = await createGroup(tx, ctx.tenantId, body);
          return scimJson(await toScimGroup(tx, ctx.tenantId, row, ctx.base), 201, {
            location: `${ctx.base}/Groups/${row.id}`,
          });
        });
      }
      if (resource === "Bulk") return scimError(501, "Bulk operations are not supported");
      return scimError(404, `Unknown resource ${resource ?? ""}`);
    });

  const PUT = (request: Request) =>
    withScim(request, deps, async (ctx, body) => {
      const [resource, id] = pathOf(request);
      if (!id) return scimError(404, "A resource id is required");
      if (resource === "Users")
        return withTenant(ctx.tenantId, async (tx) =>
          scimJson(toScimUser(await replaceMember(tx, ctx.tenantId, id, readUser(body)), ctx.base)),
        );
      if (resource === "Groups")
        return withTenant(ctx.tenantId, async (tx) =>
          scimJson(
            await toScimGroup(
              tx,
              ctx.tenantId,
              await replaceGroup(tx, ctx.tenantId, id, body),
              ctx.base,
            ),
          ),
        );
      return scimError(404, `Unknown resource ${resource ?? ""}`);
    });

  const PATCH = (request: Request) =>
    withScim(request, deps, async (ctx, body) => {
      const [resource, id] = pathOf(request);
      if (!id) return scimError(404, "A resource id is required");
      const ops = parsePatch(body);
      if (resource === "Users")
        return withTenant(ctx.tenantId, async (tx) =>
          scimJson(toScimUser(await patchMember(tx, ctx.tenantId, id, ops), ctx.base)),
        );
      if (resource === "Groups")
        return withTenant(ctx.tenantId, async (tx) =>
          scimJson(
            await toScimGroup(
              tx,
              ctx.tenantId,
              await patchGroup(tx, ctx.tenantId, id, ops),
              ctx.base,
            ),
          ),
        );
      return scimError(404, `Unknown resource ${resource ?? ""}`);
    });

  const DELETE = (request: Request) =>
    withScim(request, deps, async (ctx) => {
      const [resource, id] = pathOf(request);
      if (!id) return scimError(404, "A resource id is required");
      if (resource === "Users") {
        await withTenant(ctx.tenantId, (tx) => deactivateMember(tx, ctx.tenantId, id));
        return new Response(null, { status: 204 });
      }
      if (resource === "Groups") {
        await withTenant(ctx.tenantId, (tx) => deleteGroup(tx, ctx.tenantId, id));
        return new Response(null, { status: 204 });
      }
      return scimError(404, `Unknown resource ${resource ?? ""}`);
    });

  return { GET, POST, PUT, PATCH, DELETE };
}
