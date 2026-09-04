/**
 * `auth` schema — Better Auth tables (global, not tenant-scoped).
 * Workspace membership is carried by app.members (matched on email): one and the
 * same identity can be a member of several workspaces.
 * Structure expected by better-auth 1.7 (Drizzle adapter) — `account.issuer`
 * arrived with that version and is required, so a schema written for 1.3
 * creates users whose credential account silently fails to land.
 */
import { boolean, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const authSchema = pgSchema("auth");

export const authUsers = authSchema.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = authSchema.table("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authAccounts = authSchema.table(
  "account",
  {
    id: text("id").primaryKey(),
    /** Who issued the account — "credential" for a password, the IdP for OAuth. */
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("account_issuer_account_id").on(t.issuer, t.accountId)],
);

export const authVerifications = authSchema.table("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * SSO providers of the `@better-auth/sso` plugin (enterprise edition). One row
 * per workspace connection; `organization_id` carries the tenant id, the
 * product's own settings live in app.sso_connections.
 */
export const authSsoProviders = authSchema.table("sso_provider", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  oidcConfig: text("oidc_config"),
  samlConfig: text("saml_config"),
  userId: text("user_id").references(() => authUsers.id, { onDelete: "set null" }),
  providerId: text("provider_id").notNull().unique(),
  organizationId: text("organization_id"),
  domain: text("domain").notNull(),
  domainVerified: boolean("domain_verified").notNull().default(false),
});
