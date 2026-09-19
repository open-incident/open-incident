import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";
import * as authSchema from "./schema/auth";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://openincident_app:openincident_app@localhost:5441/openincident";

/**
 * Lazy connection: postgres.js only opens the connection on the first query.
 *
 * Cached on `globalThis`, and that is not a micro-optimisation. In
 * development, every recompile re-evaluates this module and leaves the
 * previous pool behind, holding up to ten connections that nothing will ever
 * close. Half an hour of editing exhausts a hundred-connection Postgres, and
 * the symptom is the least helpful one imaginable: every page answers 404,
 * because the tenant lookup is the first query each request makes and a
 * workspace that cannot be read is a workspace that does not exist.
 *
 * In production the module is evaluated once and the cache changes nothing.
 */
const POOL = Symbol.for("openincident.db.pool");
type PoolHolder = { [POOL]?: ReturnType<typeof postgres> };
const holder = globalThis as unknown as PoolHolder;
/**
 * Ten connections is postgres.js's default and it was not a choice anyone made.
 * It is the ceiling a request hits when something takes a second connection
 * while holding the first, and the number an operator needs to raise when they
 * run more concurrency than the default worker does.
 */
const POOL_SIZE = Number(process.env.DATABASE_POOL_SIZE ?? 10);
const queryClient = (holder[POOL] ??= postgres(connectionString, {
  prepare: false,
  max: Number.isFinite(POOL_SIZE) && POOL_SIZE > 0 ? POOL_SIZE : 10,
}));

/**
 * The whole schema, for THIS package: seeds, the workspace command, the tests.
 * Not exported from index.ts — an app that could import it would be one query
 * away from reading the `app` schema outside a tenant context, and the policies
 * would make that query return nothing rather than fail loudly.
 */
export const db = drizzle(queryClient, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The client Better Auth adapts — typed with the `auth` schema only. Global
 * tables, no tenant column, no policy: sessions are one identity across
 * workspaces.
 */
export const authDb = drizzle(queryClient, { schema: authSchema });

/**
 * Runs `fn` inside a transaction where RLS is active for the given tenant.
 * Every query on the `app` schema goes through here: outside it the policies in
 * sql/rls.sql let no row through — for the application role, which does not own
 * the tables (see apply-rls.ts).
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
