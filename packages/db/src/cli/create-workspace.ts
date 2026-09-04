/**
 * Creates a workspace on a self-hosted instance and prints the owner's
 * invitation link. Runs as the database owner (DATABASE_ADMIN_URL).
 *
 *   pnpm workspace:create -- --slug acme --name "Acme Corp" \
 *     --owner-email jane@acme.example --owner-name "Jane Doe" [--locale fr] [--timezone Europe/Paris]
 */
import { inviteToken } from "@openincident/crypto";
import { isValidSlug } from "@openincident/config";
import { provisionWorkspace } from "../provision";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const slug = arg("slug");
const name = arg("name");
const ownerEmail = arg("owner-email");
const ownerName = arg("owner-name") ?? ownerEmail?.split("@")[0] ?? "Owner";

if (!slug || !name || !ownerEmail) {
  console.error(
    "Usage: pnpm workspace:create -- --slug <slug> --name <name> --owner-email <email> [--owner-name <name>] [--locale en] [--timezone Europe/Paris]",
  );
  process.exit(2);
}
if (!isValidSlug(slug)) {
  console.error(
    `"${slug}" is not a valid slug: 3–40 lowercase letters, digits and hyphens, not a reserved subdomain.`,
  );
  process.exit(2);
}

const result = await provisionWorkspace({
  slug,
  name,
  locale: arg("locale"),
  timezone: arg("timezone"),
  owner: { email: ownerEmail, name: ownerName },
});

const baseDomain = process.env.BASE_DOMAIN ?? "localhost:3100";
const proto = baseDomain.startsWith("localhost") ? "http" : "https";
const link = `${proto}://${slug}.${baseDomain}/invite/${inviteToken(result.tenantId, result.ownerMemberId)}`;

console.log(
  result.created
    ? `Workspace "${name}" created (${slug}).`
    : `Workspace "${slug}" already existed.`,
);
console.log(`Owner invitation for ${ownerEmail} (valid 7 days):\n  ${link}`);
process.exit(0);
