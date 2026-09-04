import { defineConfig } from "drizzle-kit";

/**
 * Migrations run as the database OWNER (DATABASE_ADMIN_URL): the application
 * role must never own the tables, or row-level security would not apply to it.
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_ADMIN_URL ??
      process.env.DATABASE_URL ??
      "postgres://openincident:openincident@localhost:5441/openincident",
  },
  schemaFilter: ["app", "auth", "directory"],
});
