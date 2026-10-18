"use server";

/**
 * The wizard's actions. Each one does the real thing — reads Opsgenie, writes
 * the import, switches a team — and returns what the screen says about it.
 * Network calls to Opsgenie happen outside any transaction; the background
 * work (inventory, archive) is handed to `after()` and to the worker's sweep,
 * whichever takes the lease first.
 */
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { decryptSecret } from "@openincident/crypto";
import {
  members,
  migrationItems,
  migrationRuns,
  scheduleOverrides,
  shadowDecisions,
  withTenant,
} from "@openincident/db";
import {
  OpsgenieClient,
  OpsgenieError,
  STEP_ORDER,
  advanceRun,
  checkKey,
  checksPass,
  clientFor,
  fetchOverrides,
  importInactive,
  itemsOf,
  latestRun,
  linkOf,
  peopleOf,
  recheck,
  resolvePerson,
  rollbackTeam,
  saveConnection,
  setConfirmation,
  setStep,
  switchTeam,
  toggleChecklist,
  unresolved,
  writeOverrides,
  type Region,
  type Run,
} from "@openincident/migrate-opsgenie";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { sendMemberInvite } from "@/lib/member-invite";
import { requirePermission } from "@/lib/session";
import { loadBase, previewModel } from "./data";

const PATH = "/app/settings/migrate";
export type ActionResult = { ok: boolean; message?: string };

async function current() {
  return requirePermission("settings.platform");
}

async function runOf(tenantId: string): Promise<Run> {
  const run = await withTenant(tenantId, (tx) => latestRun(tx, tenantId));
  if (!run) throw new Error("no migration");
  return run;
}

/** Background work: now, in this process, after the response; the worker picks up what is left. */
function kick(tenantId: string, runId: string) {
  after(async () => {
    await advanceRun(tenantId, runId, { budgetMs: 10 * 60_000 }).catch(() => {});
  });
}

const errText = (e: unknown) =>
  e instanceof OpsgenieError ? e.message : e instanceof Error ? e.message : String(e);

/* ---------- 1 · Connect ---------- */

export type CheckState = {
  checked: boolean;
  ok: boolean;
  rows: Array<{
    key: "reach" | "read" | "config" | "account";
    ok: boolean;
    detail: string;
    name?: string;
    teams?: number;
    teamKey?: boolean;
  }>;
  hint: "ok" | "config" | "team" | "unauthorized" | "unreachable" | "empty" | "idle";
};

/** Checks a key (the one typed, else the one saved) and saves it when every check passes. */
export async function checkConnection(
  _prev: CheckState | null,
  formData: FormData,
): Promise<CheckState> {
  const me = await current();
  const region = z.enum(["eu", "us"]).parse(formData.get("region") ?? "eu") as Region;
  const typed = String(formData.get("key") ?? "").trim();
  const existing = await withTenant(me.tenant.id, (tx) => latestRun(tx, me.tenant.id));
  // Nothing typed: the saved key is checked again (it never comes back to the page).
  const key = typed || (existing ? (decryptSecret(existing.encryptedKey) ?? "") : "");
  if (!key) return { checked: false, ok: false, rows: [], hint: "empty" };
  const client = new OpsgenieClient({ region, key, maxRetries: 3 });
  const checks = await checkKey(client);
  const rows: CheckState["rows"] = [
    { key: "reach", ...checks.reach },
    { key: "read", ...checks.read },
    { key: "config", ...checks.config },
    { key: "account", ...checks.account },
  ];
  const ok = checksPass(checks);
  const hint: CheckState["hint"] = ok
    ? "ok"
    : !checks.reach.ok
      ? "unreachable"
      : !checks.read.ok
        ? "unauthorized"
        : !checks.config.ok
          ? "config"
          : "team";
  if (ok) {
    await withTenant(me.tenant.id, async (tx) => {
      await saveConnection(tx, me.tenant.id, {
        region,
        key,
        checks,
        memberId: me.member.id,
        account: checks.account.name ?? null,
      });
      await recordAudit(tx, me, "security", "migration.key_saved", {
        provider: "opsgenie",
        region,
      });
    });
    revalidatePath(PATH);
  }
  return { checked: true, ok, rows, hint };
}

export async function startInventory(): Promise<void> {
  const me = await current();
  const run = await runOf(me.tenant.id);
  if (!run.encryptedKey) redirect(`${PATH}?step=connect`);
  await withTenant(me.tenant.id, async (tx) => {
    await setStep(tx, run.id, {
      step: "inventory",
      steps: { connect: "done", inventory: "running" },
      extra: { progress: 0, progressLabel: "account", error: null, leaseUntil: null },
    });
    await recordAudit(tx, me, "data", "migration.inventory_started", { provider: "opsgenie" });
  });
  kick(me.tenant.id, run.id);
  redirect(`${PATH}?step=inventory`);
}

/** "Read again": the same read, from the start, until a team is switched. */
export async function readAgain(): Promise<ActionResult> {
  const me = await current();
  const run = await runOf(me.tenant.id);
  await withTenant(me.tenant.id, (tx) =>
    setStep(tx, run.id, {
      steps: { inventory: "running" },
      extra: { progress: 0, progressLabel: "account", error: null, leaseUntil: null },
    }),
  );
  kick(me.tenant.id, run.id);
  revalidatePath(PATH);
  return { ok: true };
}

/** Moves to a step the run may reach, and remembers it as reached. */
export async function goTo(step: string): Promise<void> {
  const me = await current();
  const s = z.enum(STEP_ORDER as [string, ...string[]]).parse(step) as (typeof STEP_ORDER)[number];
  const run = await runOf(me.tenant.id);
  await withTenant(me.tenant.id, (tx) => setStep(tx, run.id, { step: s }));
  redirect(`${PATH}?step=${s}`);
}

/* ---------- 3 · People ---------- */

export async function choosePerson(externalUserId: string, value: string): Promise<ActionResult> {
  const me = await current();
  const t = await getT();
  const run = await runOf(me.tenant.id);
  const person = (await withTenant(me.tenant.id, (tx) => peopleOf(tx, run.id))).find(
    (p) => p.externalUserId === externalUserId,
  );
  if (!person) return { ok: false };
  let message: string | undefined;
  if (value === "invite") {
    const email = (person.externalEmail ?? "").toLowerCase();
    if (!z.string().email().safeParse(email).success) return { ok: false };
    const invited = await withTenant(me.tenant.id, async (tx) => {
      const [existing] = await tx
        .select({ id: members.id, status: members.status })
        .from(members)
        .where(and(eq(members.tenantId, me.tenant.id), eq(members.email, email)));
      const id =
        existing?.id ??
        (
          await tx
            .insert(members)
            .values({
              tenantId: me.tenant.id,
              email,
              name: person.externalName ?? email,
              role: "responder",
              status: "invited",
            })
            .returning({ id: members.id })
        )[0]!.id;
      await resolvePerson(tx, run.id, externalUserId, { kind: "invite", memberId: id });
      await recordAudit(tx, me, "members", "member.invited", { email, from: "opsgenie" });
      return { id, fresh: !existing || existing.status === "invited" };
    });
    if (invited.fresh)
      await sendMemberInvite(
        me.tenant,
        me.workspace.name,
        { id: invited.id, email },
        me.member.name,
      ).catch(() => {});
    message = t("migrate.people.invited", { email });
  } else if (value === "gap") {
    await withTenant(me.tenant.id, (tx) =>
      resolvePerson(tx, run.id, externalUserId, { kind: "gap" }),
    );
  } else if (value.startsWith("member:")) {
    const memberId = z.string().uuid().parse(value.slice("member:".length));
    await withTenant(me.tenant.id, async (tx) => {
      const [m] = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.tenantId, me.tenant.id), eq(members.id, memberId)));
      if (m) await resolvePerson(tx, run.id, externalUserId, { kind: "member", memberId });
    });
  } else {
    await withTenant(me.tenant.id, (tx) =>
      resolvePerson(tx, run.id, externalUserId, { kind: "clear" }),
    );
  }
  revalidatePath(PATH);
  return { ok: true, message };
}

export async function toggleTranslation(kind: string): Promise<ActionResult> {
  const me = await current();
  const k = z.enum(["delays", "layers", "p5", "repeat"]).parse(kind);
  const run = await runOf(me.tenant.id);
  await withTenant(me.tenant.id, (tx) => setConfirmation(tx, run.id, k, !run.confirmations?.[k]));
  revalidatePath(PATH);
  return { ok: true };
}

/** "Preview the import →" — only once every slot has a person and every conversion is confirmed. */
export async function toPreview(): Promise<void> {
  const me = await current();
  const run = await runOf(me.tenant.id);
  const ok = await withTenant(me.tenant.id, async (tx) => {
    const base = await loadBase(tx, run);
    return base.matchOk;
  });
  if (!ok) redirect(`${PATH}?step=people`);
  await withTenant(me.tenant.id, (tx) =>
    setStep(tx, run.id, { step: "preview", steps: { people: "done" } }),
  );
  redirect(`${PATH}?step=preview`);
}

/* ---------- 4 · Preview ---------- */

/** Hands one slot to a member: a fix kept with the schedule (an override once imported). */
export async function fixSlot(input: {
  scheduleId: string;
  partKey: string;
  start: string;
  end: string;
  memberId: string;
}): Promise<ActionResult> {
  const me = await current();
  const t = await getT();
  const parsed = z
    .object({
      scheduleId: z.string().min(1).max(80),
      partKey: z.string().min(1).max(80),
      start: z.string().datetime(),
      end: z.string().datetime(),
      memberId: z.string().uuid(),
    })
    .parse(input);
  const run = await runOf(me.tenant.id);
  await withTenant(me.tenant.id, async (tx) => {
    const [item] = await tx
      .select()
      .from(migrationItems)
      .where(
        and(
          eq(migrationItems.runId, run.id),
          eq(migrationItems.type, "schedule"),
          eq(migrationItems.externalId, parsed.scheduleId),
        ),
      );
    if (!item) return;
    const data = item.data as { fixes?: Array<Record<string, unknown>> };
    const fixes = [
      ...(data.fixes ?? []),
      { partKey: parsed.partKey, start: parsed.start, end: parsed.end, memberId: parsed.memberId },
    ];
    await tx
      .update(migrationItems)
      .set({ data: { ...(item.data as Record<string, unknown>), fixes }, updatedAt: new Date() })
      .where(eq(migrationItems.id, item.id));
    // Already imported: the fix is an override on the layer in force.
    const part =
      linkOf(item)?.parts?.find((p) => p.key === parsed.partKey) ?? linkOf(item)?.parts?.[0];
    if (part)
      await tx.insert(scheduleOverrides).values({
        tenantId: me.tenant.id,
        scheduleId: part.scheduleId,
        rotationId: null,
        memberId: parsed.memberId,
        startAt: new Date(parsed.start),
        endAt: new Date(parsed.end),
        reason: "override",
        createdByMemberId: me.member.id,
      });
    await recordAudit(tx, me, "config", "migration.slot_fixed", {
      schedule: item.name,
      start: parsed.start,
    });
  });
  revalidatePath(PATH);
  return { ok: true, message: t("migrate.toast.fixed") };
}

/** Reads a schedule's overrides (and timeline) again from Opsgenie. */
export async function rereadOverrides(scheduleIds: string[]): Promise<ActionResult> {
  const me = await current();
  const t = await getT();
  const ids = z.array(z.string().min(1).max(80)).max(20).parse(scheduleIds);
  const run = await runOf(me.tenant.id);
  const client = clientFor(run);
  if (!client) return { ok: false, message: t("migrate.toast.error", { error: "key" }) };
  try {
    const fresh = await fetchOverrides(client, ids);
    await withTenant(me.tenant.id, (tx) =>
      writeOverrides(tx, me.tenant.id, run, fresh, me.member.id),
    );
  } catch (e) {
    return { ok: false, message: t("migrate.toast.error", { error: errText(e) }) };
  }
  revalidatePath(PATH);
  return { ok: true, message: t("migrate.toast.reread") };
}

export async function importNow(): Promise<ActionResult> {
  const me = await current();
  const t = await getT();
  const run = await runOf(me.tenant.id);
  const ready = await withTenant(me.tenant.id, async (tx) => {
    const base = await loadBase(tx, run);
    if (!base.matchOk) return false;
    if (base.imported) return true;
    const preview = await previewModel(tx, me.tenant.id, t, base);
    return preview.open === 0;
  });
  if (!ready) return { ok: false };
  try {
    await withTenant(me.tenant.id, async (tx) => {
      const people = await peopleOf(tx, run.id);
      if (people.some(unresolved)) throw new Error("people");
      await importInactive(tx, me.tenant.id, run, me.member.id);
      await recordAudit(tx, me, "config", "migration.imported", {
        provider: "opsgenie",
        inactive: true,
      });
    });
  } catch (e) {
    return { ok: false, message: t("migrate.toast.error", { error: errText(e) }) };
  }
  revalidatePath(PATH);
  redirect(`${PATH}?step=shadow&toast=imported`);
}

/* ---------- 5 · Shadow ---------- */

/** A disagreement caused by an override: read the schedule's overrides again, then compare again. */
export async function settleOverride(decisionId: string): Promise<ActionResult> {
  const me = await current();
  const t = await getT();
  const id = z.string().uuid().parse(decisionId);
  const run = await runOf(me.tenant.id);
  const [d] = await withTenant(me.tenant.id, (tx) =>
    tx
      .select()
      .from(shadowDecisions)
      .where(and(eq(shadowDecisions.runId, run.id), eq(shadowDecisions.id, id))),
  );
  if (!d) return { ok: false };
  const scheduleIds = ((d.detail as { scheduleIds?: string[] }).scheduleIds ?? []).slice(0, 10);
  const client = clientFor(run);
  if (!client) return { ok: false, message: t("migrate.toast.error", { error: "key" }) };
  try {
    const fresh = await fetchOverrides(client, scheduleIds);
    const fixed = await withTenant(me.tenant.id, async (tx) => {
      await writeOverrides(tx, me.tenant.id, run, fresh, me.member.id);
      const n = await recheck(tx, me.tenant.id, run, [id]);
      if (n) {
        await tx
          .update(shadowDecisions)
          .set({ resolvedByMemberId: me.member.id })
          .where(eq(shadowDecisions.id, id));
        await recordAudit(tx, me, "config", "migration.disagreement_resolved", {
          alert: d.alertTitle,
        });
      }
      return n;
    });
    revalidatePath(PATH);
    return {
      ok: true,
      message: fixed ? t("migrate.toast.resolved") : t("migrate.toast.stillDiffers"),
    };
  } catch (e) {
    return { ok: false, message: t("migrate.toast.error", { error: errText(e) }) };
  }
}

/* ---------- 6 · Switch ---------- */

export async function switchTeamAction(team: string): Promise<ActionResult> {
  const me = await current();
  const t = await getT();
  const teamId = z.string().min(1).max(80).parse(team);
  const run = await runOf(me.tenant.id);
  // Overrides are read again at the moment of the switch.
  const scheduleIds = await withTenant(me.tenant.id, async (tx) =>
    (await itemsOf(tx, run.id, "schedule"))
      .filter((i) => linkOf(i)?.team === teamId)
      .map((i) => i.externalId),
  );
  const client = clientFor(run);
  try {
    if (client && scheduleIds.length) {
      const fresh = await fetchOverrides(client, scheduleIds);
      await withTenant(me.tenant.id, (tx) =>
        writeOverrides(tx, me.tenant.id, run, fresh, me.member.id),
      );
    }
  } catch (e) {
    return { ok: false, message: t("migrate.toast.error", { error: errText(e) }) };
  }
  const result = await withTenant(me.tenant.id, async (tx) => {
    const r = await switchTeam(tx, me.tenant.id, run, teamId, me.member.id);
    if (r.ok) {
      await setStep(tx, run.id, { step: "switch" });
      await recordAudit(tx, me, "config", "migration.team_switched", { team: teamId });
    }
    return r;
  });
  const name = await teamName(me.tenant.id, run, teamId);
  revalidatePath(PATH);
  return result.ok
    ? { ok: true, message: t("migrate.toast.switched", { team: name }) }
    : { ok: false, message: t("migrate.switch.blocked", { count: 1 }) };
}

export async function rollbackTeamAction(team: string): Promise<ActionResult> {
  const me = await current();
  const t = await getT();
  const teamId = z.string().min(1).max(80).parse(team);
  const run = await runOf(me.tenant.id);
  await withTenant(me.tenant.id, async (tx) => {
    if (await rollbackTeam(tx, me.tenant.id, run, teamId))
      await recordAudit(tx, me, "config", "migration.team_rolled_back", { team: teamId });
  });
  revalidatePath(PATH);
  return {
    ok: true,
    message: t("migrate.toast.rolledBack", { team: await teamName(me.tenant.id, run, teamId) }),
  };
}

async function teamName(tenantId: string, run: Run, teamId: string): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const [item] = await tx
      .select({ name: migrationItems.name })
      .from(migrationItems)
      .where(
        and(
          eq(migrationItems.runId, run.id),
          eq(migrationItems.type, "team"),
          eq(migrationItems.externalId, teamId),
        ),
      );
    return item?.name ?? teamId;
  });
}

export async function toggleRepoint(team: string, key: string): Promise<ActionResult> {
  const me = await current();
  const run = await runOf(me.tenant.id);
  await withTenant(me.tenant.id, (tx) =>
    toggleChecklist(tx, run.id, z.string().max(80).parse(team), z.string().max(200).parse(key)),
  );
  revalidatePath(PATH);
  return { ok: true };
}

/* ---------- 7 · Archive ---------- */

/** "Archive history →": starts (or resumes) the archive and goes to it. */
export async function startArchive(): Promise<void> {
  const me = await current();
  const run = await runOf(me.tenant.id);
  if (run.steps.preview !== "done") redirect(`${PATH}?step=preview`);
  if (run.steps.archive !== "done") {
    await withTenant(me.tenant.id, async (tx) => {
      await setStep(tx, run.id, {
        step: "archive",
        steps: { switch: run.steps.switch ?? "running", archive: "running" },
        extra: { error: null, leaseUntil: null },
      });
      await recordAudit(tx, me, "data", "migration.archive_started", { provider: "opsgenie" });
    });
    kick(me.tenant.id, run.id);
  } else await withTenant(me.tenant.id, (tx) => setStep(tx, run.id, { step: "archive" }));
  redirect(`${PATH}?step=archive`);
}

export async function finishMigration(): Promise<ActionResult> {
  const me = await current();
  const t = await getT();
  const run = await runOf(me.tenant.id);
  const out = await withTenant(me.tenant.id, async (tx) => {
    const base = await loadBase(tx, run);
    const pending = base.switches.filter((s) => s.state !== "switched").length;
    if (!base.switches.length || pending)
      return { ok: false, message: t("migrate.toast.switchFirst") };
    if (run.steps.archive !== "done") return { ok: false, message: t("migrate.toast.waitArchive") };
    await tx
      .update(migrationRuns)
      .set({ completedAt: new Date(), updatedAt: new Date() })
      .where(eq(migrationRuns.id, run.id));
    await recordAudit(tx, me, "config", "migration.completed", { provider: "opsgenie" });
    const cursor = run.archiveCursor as { imported?: number } | null;
    return {
      ok: true,
      message: t("migrate.toast.complete", {
        count: base.switches.length,
        teams: base.switches.length,
        alerts: cursor?.imported ?? 0,
      }),
    };
  });
  revalidatePath(PATH);
  return out;
}
