"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  QA_SUITES,
  activeQaRuns,
  createQaRun,
  enqueueQaRun,
  qaCapabilities,
  requestQaCancel,
} from "@openincident/qa";
import { withTenant, type QaSuite } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

/** QA is an owner's act: it seeds and purges workspaces and drives the instance. */
async function requireOwner() {
  const current = await requireManager();
  if (current.member.role !== "owner") throw new Error("forbidden: owners only");
  return current;
}

const suiteSchema = z.enum(QA_SUITES as [QaSuite, ...QaSuite[]]);

/** Queues one suite, or every suite in order when `suite` is "all". */
export async function runQaSuite(formData: FormData): Promise<void> {
  const current = await requireOwner();
  const raw = String(formData.get("suite") ?? "");
  const suites: QaSuite[] = raw === "all" ? [...QA_SUITES] : [suiteSchema.parse(raw)];
  if (!qaCapabilities().repoRoot) redirect("/app/settings/qa?error=unavailable");
  const active = await activeQaRuns(current.tenant.id);
  const busy = suites.filter((s) => active.some((r) => r.suite === s));
  if (busy.length) redirect(`/app/settings/qa?error=busy&suite=${busy[0]}`);
  let firstId: string | null = null;
  for (const suite of suites) {
    const run = await createQaRun(current.tenant.id, suite, {
      memberId: current.member.id,
      name: current.member.name,
    });
    const queued = await enqueueQaRun({ tenantId: current.tenant.id, runId: run.id });
    if (!queued) redirect("/app/settings/qa?error=queue");
    firstId ??= run.id;
    await withTenant(current.tenant.id, (tx) =>
      recordAudit(tx, current, "config", "qa.run_queued", { suite, runId: run.id }),
    );
  }
  revalidatePath("/app/settings/qa");
  redirect(suites.length === 1 && firstId ? `/app/settings/qa/${firstId}` : "/app/settings/qa");
}

export async function cancelQaRun(formData: FormData): Promise<void> {
  const current = await requireOwner();
  const id = z.string().uuid().parse(formData.get("id"));
  await requestQaCancel(current.tenant.id, id);
  await withTenant(current.tenant.id, (tx) =>
    recordAudit(tx, current, "config", "qa.run_cancelled", { runId: id }),
  );
  revalidatePath(`/app/settings/qa/${id}`);
  redirect(`/app/settings/qa/${id}`);
}
