/**
 * Atlas's jobs in the worker (owner: atlas-core):
 *  - atlas-sweep, every minute: fixes waiting for verification (and the
 *    resolution that follows at level 3–4), incidents reopened after Atlas
 *    resolved them, the 09:00 summaries, the promotions an undo window
 *    closing earns;
 *  - atlas-backtest, on demand: one 90-day replay, started from Settings › Atlas.
 * The writes inside incidents and the notifications go through the web app's
 * signed internal route (the engine's http host).
 */
import type { Processor } from "bullmq";
import { listLiveTenants } from "@openincident/db";
import { atlas } from "@openincident/investigations";

export const atlasSweep: Processor = async () => {
  const tenants = (await listLiveTenants()).map((t) => t.id);
  const out = await atlas.atlasSweep(tenants, atlas.httpHost());
  const n = out.verified + out.reopened + out.summaries + out.promoted;
  if (n)
    console.log(
      `[atlas-sweep] ${out.verified} verified · ${out.reopened} reopened · ${out.summaries} summaries · ${out.promoted} promoted`,
    );
};

export const atlasBacktest: Processor = async (job) => {
  await atlas.runBacktest(job.data as atlas.BacktestJob);
};
