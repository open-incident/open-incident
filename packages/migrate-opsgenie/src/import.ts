/**
 * Step 4's button: everything the account holds, created here INACTIVE.
 *
 * Schedules are drafts (nothing pages a draft), policies have no published
 * version (an escalation cannot start on them), alert sources and rules are
 * switched off, heartbeats are paused. Nobody is paged until a team is
 * switched — and a switch is exactly the activation of that team's objects
 * (switch.ts). Each Opsgenie object remembers what it became, in its item's
 * `data.oi`, so a switch, a rollback and a second read know what to touch.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { encryptSecret } from "@openincident/crypto";
import {
  alertPriorities,
  alertRoutes,
  alertSources,
  escalationPaths,
  heartbeats,
  members,
  migrationItems,
  migrationRuns,
  migrationTeamSwitch,
  registerApiKeyLookup,
  rotations,
  scheduleOverrides,
  schedules,
  teamMembers,
  teams,
  workingHoursSets,
  type EscalationGraph,
  type EscalationRule,
  type Tx,
} from "@openincident/db";
import { newHeartbeatToken, shiftsBetween } from "@openincident/oncall";
import {
  activityOf as activityFor,
  convertCriteria,
  escalationGraph,
  isNobody,
  repointHint,
  shapeSchedule,
  targetOf,
  type PeopleIndex,
  type ScheduleShape,
  type ShapePart,
  type StoredSchedule,
} from "./convert";
import type { StoredIntegration, StoredTeam } from "./inventory";
import {
  indexItems,
  itemsOf,
  loadSnapshot,
  peopleIndex,
  peopleOf,
  setStep,
  type ItemRow,
  type Run,
} from "./run";
import type { OgEscalation, OgHeartbeat, OgRoutingRule } from "./types";

const WEEK = 7 * 86_400_000;

/** What an imported object became, kept in its item's data. */
export type OiLink = {
  team: string | null;
  parts?: Array<{
    key: string;
    scheduleId: string;
    gateSetId: string | null;
    rotationIds: Record<string, string>;
    overrideIds: string[];
  }>;
  mode?: "union" | "precedence";
  pathId?: string | null;
  defaultPathId?: string | null;
  previousPolicyPathId?: string | null;
  /** The team did not exist here before the import. */
  createdHere?: boolean;
  notes?: string[];
};

export const linkOf = (item: Pick<ItemRow, "data">): OiLink | null =>
  (item.data as { oi?: OiLink }).oi ?? null;

async function setLink(
  tx: Tx,
  itemId: string,
  link: OiLink,
  oi?: {
    id: string | null;
    table: string | null;
    status?: ItemRow["status"];
    conflict?: Record<string, unknown> | null;
  },
) {
  await tx
    .update(migrationItems)
    .set({
      data: sql`${migrationItems.data} || ${JSON.stringify({ oi: link })}::jsonb`,
      ...(oi
        ? {
            oiId: oi.id,
            oiTable: oi.table,
            status: oi.status ?? "created",
            conflict: oi.conflict ?? null,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(migrationItems.id, itemId));
}

/** A name not taken yet in that table: "Platform primary", else "Platform primary (Opsgenie)", then numbered. */
async function freeName(
  tx: Tx,
  tenantId: string,
  table:
    | typeof schedules
    | typeof escalationPaths
    | typeof alertSources
    | typeof alertRoutes
    | typeof workingHoursSets
    | typeof heartbeats,
  base: string,
): Promise<string> {
  const taken = new Set(
    (await tx.select({ name: table.name }).from(table).where(eq(table.tenantId, tenantId))).map(
      (r) => r.name.toLowerCase(),
    ),
  );
  const candidates = [base, `${base} (Opsgenie)`];
  for (let i = 2; i < 50; i++) candidates.push(`${base} (Opsgenie ${i})`);
  return (
    candidates.find((c) => !taken.has(c.toLowerCase())) ??
    `${base} ${randomBytes(3).toString("hex")}`
  );
}

/** Who owns an object: its owner team, else the first team whose rules point at it. */
function ownerOf(
  ownerTeam: { id: string } | null | undefined,
  referencedBy: string[],
): string | null {
  return ownerTeam?.id ?? referencedBy[0] ?? null;
}

export type ImportCounts = {
  members: number;
  teams: number;
  schedules: number;
  rotations: number;
  policies: number;
  rules: number;
  sources: number;
  monitors: number;
};

/** What the import will create, counted from the inventory and the people as matched. */
export function importCounts(
  snap: Awaited<ReturnType<typeof loadSnapshot>>,
  people: PeopleIndex,
  p5ToP4 = true,
): ImportCounts {
  const shapes = snap.schedules.map((s) => shapeSchedule(s as StoredSchedule, people));
  const readAt = new Date(snap.readAt);
  const teamsWithSources = new Set(
    snap.integrations
      .filter(
        (x) => targetOf(x.type, activityOf(x, readAt), Boolean(x.lastAlertAt)).kind !== "skip",
      )
      .map((x) => integrationTeam(x)),
  );
  const helperSchedules = new Set<string>();
  let rules = 0;
  for (const t of snap.teams)
    for (const r of t.routingRules) {
      if (r.notify.type === "schedule" && r.notify.id) helperSchedules.add(r.notify.id);
      if (isDefaultRule(r, t) || !teamsWithSources.has(t.id)) continue;
      // A rule none of whose conditions survive is not imported.
      if (r.criteria.type !== "match-all" && !convertCriteria(r.criteria, { p5ToP4 }).groups.length)
        continue;
      rules += 1;
    }
  const mapped = new Set([...people.values()].filter((m): m is string => !isNobody(m)));
  return {
    members: mapped.size,
    teams: snap.teams.length,
    schedules: shapes.reduce((n, s) => n + s.parts.length, 0),
    rotations: shapes.reduce((n, s) => n + s.parts.reduce((k, p) => k + p.rotations.length, 0), 0),
    policies: snap.escalations.length + helperSchedules.size,
    rules,
    sources: snap.integrations.filter(
      (x) => targetOf(x.type, activityOf(x, readAt), Boolean(x.lastAlertAt)).kind !== "skip",
    ).length,
    monitors: snap.heartbeats.length,
  };
}

function activityOf(x: StoredIntegration, now: Date) {
  return activityFor(x.lastAlertAt, now);
}
export const integrationTeam = (x: StoredIntegration): string | null =>
  x.teamId ?? x.ownerTeam?.id ?? null;

/** A team's default rule: the one marked so, else the last catch-all. */
export function isDefaultRule(r: OgRoutingRule, team: StoredTeam): boolean {
  if (r.isDefault) return true;
  if (team.routingRules.some((x) => x.isDefault)) return false;
  const catchAll = team.routingRules.filter(
    (x) => x.criteria.type === "match-all" && !x.timeRestriction,
  );
  return catchAll[catchAll.length - 1]?.id === r.id;
}

/**
 * The import. One transaction; runs again safely — an object that already
 * became something here is left as it is.
 */
export async function importInactive(
  tx: Tx,
  tenantId: string,
  run: Run,
  actorMemberId: string | null,
  now = new Date(),
): Promise<{ created: number }> {
  const snap = await loadSnapshot(tx, run);
  const peopleRows = await peopleOf(tx, run.id);
  const people = peopleIndex(peopleRows);
  const items = await itemsOf(tx, run.id);
  const byType = (t: ItemRow["type"]) => indexItems(items, t);
  let created = 0;

  // P5 becomes P4 — the workspace's lowest severity answers to "P5" from now on.
  if (run.confirmations?.p5) {
    const prios = await tx
      .select()
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenantId));
    if (!prios.some((p) => p.name.toLowerCase() === "p5")) {
      const lowest = prios.slice().sort((a, b) => b.rank - a.rank)[0];
      if (lowest && !lowest.aliases.map((a) => a.toLowerCase()).includes("p5"))
        await tx
          .update(alertPriorities)
          .set({ aliases: [...lowest.aliases, "p5"] })
          .where(eq(alertPriorities.id, lowest.id));
    }
  }

  /* Teams: an existing team of the same name is the same team. */
  const teamItems = byType("team");
  const teamIdOf = new Map<string, string>();
  const existingTeams = await tx.select().from(teams).where(eq(teams.tenantId, tenantId));
  for (const t of snap.teams) {
    const item = teamItems.get(t.id)!;
    let id = item.oiId;
    if (!id) {
      const same = existingTeams.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
      if (same) id = same.id;
      else {
        const [row] = await tx
          .insert(teams)
          .values({ tenantId, name: t.name })
          .returning({ id: teams.id });
        id = row!.id;
        created++;
      }
      const existing = existingTeams.find((x) => x.id === id);
      await setLink(
        tx,
        item.id,
        {
          team: t.id,
          createdHere: !existing,
          previousPolicyPathId: existing?.policyPathId ?? null,
        },
        { id, table: "teams" },
      );
    }
    teamIdOf.set(t.id, id);
    const memberIds = (t.members ?? [])
      .map((m) => people.get(m.user.id))
      .filter((m): m is string => Boolean(m) && !isNobody(m));
    if (memberIds.length) {
      const known = new Set(
        (
          await tx.select({ id: members.id }).from(members).where(inArray(members.id, memberIds))
        ).map((r) => r.id),
      );
      const rows = memberIds
        .filter((m) => known.has(m))
        .map((memberId) => ({ tenantId, teamId: id!, memberId }));
      if (rows.length) await tx.insert(teamMembers).values(rows).onConflictDoNothing();
    }
  }

  // Which team points at what: the owner of an object without one.
  const referencedBy = new Map<string, string[]>();
  const refer = (objectId: string | undefined, teamId: string) => {
    if (!objectId) return;
    referencedBy.set(objectId, [...(referencedBy.get(objectId) ?? []), teamId]);
  };
  for (const t of snap.teams) for (const r of t.routingRules) refer(r.notify.id, t.id);
  for (const e of snap.escalations) {
    const owner = e.ownerTeam?.id ?? referencedBy.get(e.id)?.[0];
    if (owner)
      for (const r of e.rules) if (r.recipient.type === "schedule") refer(r.recipient.id, owner);
  }

  /* Schedules: one per layer where layers or days need a condition. Drafts. */
  const scheduleItems = byType("schedule");
  const shapes = new Map<string, ScheduleShape>();
  for (const s of snap.schedules) {
    const item = scheduleItems.get(s.id)!;
    const link = linkOf(item);
    const shape = shapeSchedule(s as StoredSchedule, people);
    if (link?.parts) {
      // Already imported: point the shape at the rows.
      for (const part of shape.parts) {
        const done = link.parts.find((p) => p.key === part.key);
        if (done) {
          part.scheduleId = done.scheduleId;
          part.gateSetId = done.gateSetId ?? undefined;
        }
      }
      shapes.set(s.id, shape);
      continue;
    }
    const parts: NonNullable<OiLink["parts"]> = [];
    for (const part of shape.parts) {
      const done = await createPart(tx, tenantId, part, actorMemberId, now);
      created += 1 + done.rotations;
      part.scheduleId = done.scheduleId;
      part.gateSetId = done.gateSetId ?? undefined;
      parts.push({
        key: part.key,
        scheduleId: done.scheduleId,
        gateSetId: done.gateSetId,
        rotationIds: done.rotationIds,
        overrideIds: done.overrideIds,
      });
    }
    shapes.set(s.id, shape);
    await setLink(
      tx,
      item.id,
      {
        team: ownerOf(s.ownerTeam, referencedBy.get(s.id) ?? []),
        parts,
        mode: shape.mode,
        notes: shape.notes,
      },
      {
        id: parts[0]?.scheduleId ?? null,
        table: "schedules",
        status: shape.notes.length ? "conflict" : "created",
        conflict: shape.notes.length ? { notes: shape.notes } : null,
      },
    );
  }

  const ctx = {
    member: (id: string) => people.get(id) ?? null,
    team: (id: string) => teamIdOf.get(id) ?? null,
    schedule: (id: string) => shapes.get(id) ?? null,
  };

  /* Policies: draft graphs, never published here. */
  const escItems = byType("escalation");
  const pathOf = new Map<string, string>();
  for (const e of snap.escalations) {
    const item = escItems.get(e.id)!;
    if (item.oiId) {
      pathOf.set(e.id, item.oiId);
      continue;
    }
    const { graph, notes } = escalationGraph(e, ctx);
    const name = await freeName(tx, tenantId, escalationPaths, e.name);
    const [row] = await tx
      .insert(escalationPaths)
      .values({
        tenantId,
        name,
        description: e.description || "Imported from Opsgenie.",
        draftGraph: graph,
      })
      .returning({ id: escalationPaths.id });
    created++;
    pathOf.set(e.id, row!.id);
    await setLink(
      tx,
      item.id,
      { team: ownerOf(e.ownerTeam, referencedBy.get(e.id) ?? []), pathId: row!.id, notes },
      {
        id: row!.id,
        table: "escalation_paths",
        status: notes.length ? "conflict" : "created",
        conflict: notes.length ? { notes } : null,
      },
    );
  }

  // A rule that pages a schedule directly gets a one-level policy of its own.
  const helperPaths: Record<string, string> = {
    ...((run.meta?.helperPaths as Record<string, string>) ?? {}),
  };
  const pathForSchedule = async (scheduleId: string): Promise<string | null> => {
    if (helperPaths[scheduleId]) return helperPaths[scheduleId]!;
    const s = snap.schedules.find((x) => x.id === scheduleId);
    if (!s) return null;
    const synthetic: OgEscalation = {
      id: `schedule:${scheduleId}`,
      name: s.name,
      rules: [
        {
          condition: "if-not-acked",
          notifyType: "default",
          delay: { timeAmount: 0 },
          recipient: { type: "schedule", id: scheduleId },
        },
      ],
    };
    const { graph } = escalationGraph(synthetic, ctx);
    const name = await freeName(tx, tenantId, escalationPaths, `${s.name} on call`);
    const [row] = await tx
      .insert(escalationPaths)
      .values({
        tenantId,
        name,
        description: "Imported from Opsgenie: a rule that paged the schedule directly.",
        draftGraph: graph,
      })
      .returning({ id: escalationPaths.id });
    created++;
    helperPaths[scheduleId] = row!.id;
    return row!.id;
  };
  const pathForNotify = async (n: OgRoutingRule["notify"]): Promise<string | null> =>
    n.type === "escalation" && n.id
      ? (pathOf.get(n.id) ?? null)
      : n.type === "schedule" && n.id
        ? pathForSchedule(n.id)
        : null;

  /* Teams' default policy: what their catch-all rule paged. */
  const defaultPathOf = new Map<string, string | null>();
  for (const t of snap.teams) {
    const def = t.routingRules.find((r) => isDefaultRule(r, t));
    const pathId = def ? await pathForNotify(def.notify) : null;
    defaultPathOf.set(t.id, pathId);
    const item = teamItems.get(t.id)!;
    const link = linkOf(
      (await tx.select().from(migrationItems).where(eq(migrationItems.id, item.id)))[0]!,
    ) ?? { team: t.id };
    await setLink(tx, item.id, { ...link, defaultPathId: pathId });
  }

  /* Alert sources: switched off, their own answer is the team's default policy. */
  const intItems = byType("integration");
  const sourcesOfTeam = new Map<string, string[]>();
  for (const x of snap.integrations) {
    const item = intItems.get(x.id)!;
    const team = integrationTeam(x);
    const target = targetOf(x.type, activityOf(x, new Date(snap.readAt)), Boolean(x.lastAlertAt));
    if (item.oiId) {
      if (team) sourcesOfTeam.set(team, [...(sourcesOfTeam.get(team) ?? []), item.oiId]);
      continue;
    }
    if (target.kind === "skip" || target.kind === "heartbeat" || x.enabled === false) {
      await setLink(tx, item.id, { team }, { id: null, table: null, status: "skipped" });
      continue;
    }
    const secret = `oisrc_${randomBytes(20).toString("hex")}`;
    const pathId = team ? (defaultPathOf.get(team) ?? null) : null;
    const name = await freeName(tx, tenantId, alertSources, x.name);
    const escalations: EscalationRule[] = pathId ? [{ kind: "path", pathId }] : [];
    const [row] = await tx
      .insert(alertSources)
      .values({
        tenantId,
        kind: target.kind,
        name,
        description: `Imported from Opsgenie (${x.type}).`,
        secretHash: createHash("sha256").update(secret).digest("hex"),
        escalations,
        incidentOpens: "never",
        autoResolve: true,
        active: false,
        createdByMemberId: actorMemberId,
      })
      .returning({ id: alertSources.id });
    created++;
    await registerApiKeyLookup(`src:${row!.id}`, tenantId, tx);
    if (team) sourcesOfTeam.set(team, [...(sourcesOfTeam.get(team) ?? []), row!.id]);
    await setLink(tx, item.id, { team }, { id: row!.id, table: "alert_sources" });
  }

  /* Rules: a team's exceptions, ahead of the workspace's own, for its sources only. Off. */
  const ruleItems = byType("routing_rule");
  const [{ min } = { min: 0 }] = await tx
    .select({ min: sql<number>`coalesce(min(${alertRoutes.position}), 0)::int` })
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId));
  let position = min - 1000;
  for (const t of snap.teams) {
    const ordered = t.routingRules.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const r of ordered) {
      const item = ruleItems.get(r.id)!;
      if (item.oiId || item.status === "skipped") continue;
      if (isDefaultRule(r, t)) {
        await setLink(
          tx,
          item.id,
          { team: t.id, pathId: defaultPathOf.get(t.id) ?? null },
          { id: null, table: "alert_sources", status: "created" },
        );
        continue;
      }
      const sourceIds = sourcesOfTeam.get(t.id) ?? [];
      if (!sourceIds.length) {
        await setLink(
          tx,
          item.id,
          { team: t.id },
          { id: null, table: null, status: "skipped", conflict: { reason: "no_source" } },
        );
        continue;
      }
      const { groups, dropped } = convertCriteria(r.criteria, {
        p5ToP4: Boolean(run.confirmations?.p5),
      });
      const notes = [
        ...dropped.map((d) => `condition:${d.field}:${d.operation}`),
        ...(r.timeRestriction ? ["time-restriction"] : []),
      ];
      // Nothing of its conditions survived: imported, it would catch every
      // alert of the team. It is not imported, and the screens say so.
      if (r.criteria.type !== "match-all" && groups.length === 0) {
        await setLink(
          tx,
          item.id,
          { team: t.id, notes },
          {
            id: null,
            table: null,
            status: "skipped",
            conflict: { reason: "untranslatable", notes },
          },
        );
        continue;
      }
      const pathId = await pathForNotify(r.notify);
      const name = await freeName(tx, tenantId, alertRoutes, `${t.name} — ${r.name ?? "rule"}`);
      const [row] = await tx
        .insert(alertRoutes)
        .values({
          tenantId,
          name,
          description: "Imported from Opsgenie.",
          active: false,
          sourceIds,
          conditions: groups,
          escalations: pathId ? [{ kind: "path", pathId }] : [],
          escalationMode: pathId ? "static" : "none",
          escalationPathId: pathId,
          incidentMode: "never",
          position: position++,
        })
        .returning({ id: alertRoutes.id });
      created++;
      await setLink(
        tx,
        item.id,
        { team: t.id, pathId, notes },
        {
          id: row!.id,
          table: "alert_routes",
          status: notes.length ? "conflict" : "created",
          conflict: notes.length ? { notes } : null,
        },
      );
    }
  }

  /* Heartbeats: paused until the first ping, and off until the switch. */
  const hbItems = byType("heartbeat");
  for (const h of snap.heartbeats) {
    const item = hbItems.get(h.name)!;
    if (item.oiId) continue;
    const name = await freeName(tx, tenantId, heartbeats, h.name);
    const unit = h.intervalUnit === "days" ? 86_400 : h.intervalUnit === "hours" ? 3_600 : 60;
    const [row] = await tx
      .insert(heartbeats)
      .values({
        tenantId,
        name,
        description: h.description || "Imported from Opsgenie.",
        intervalSeconds: Math.max(60, h.interval * unit),
        graceSeconds: 300,
        encryptedToken: encryptSecret(newHeartbeatToken()),
        status: "waiting",
        active: false,
      })
      .returning({ id: heartbeats.id });
    created++;
    await setLink(
      tx,
      item.id,
      { team: h.ownerTeam?.id ?? null },
      { id: row!.id, table: "heartbeats" },
    );
  }

  /* One switch per team, with the integrations to repoint. */
  const existingSwitches = await tx
    .select({ team: migrationTeamSwitch.teamExternalId })
    .from(migrationTeamSwitch)
    .where(eq(migrationTeamSwitch.runId, run.id));
  for (const t of snap.teams) {
    if (existingSwitches.some((s) => s.team === t.id)) continue;
    const checklist = [
      ...snap.integrations
        .filter((x) => integrationTeam(x) === t.id)
        .filter(
          (x) =>
            targetOf(x.type, activityOf(x, new Date(snap.readAt)), Boolean(x.lastAlertAt)).kind !==
            "skip",
        )
        .map((x) => ({
          key: x.id,
          label: x.name,
          done: false,
          hint: repointHint(x.type),
          sourceId: intItems.get(x.id)?.oiId ?? null,
        })),
      ...snap.heartbeats
        .filter((h: OgHeartbeat) => h.ownerTeam?.id === t.id)
        .map((h) => ({
          key: `heartbeat:${h.name}`,
          label: h.name,
          done: false,
          hint: repointHint("Heartbeat"),
          heartbeat: true,
        })),
    ];
    await tx.insert(migrationTeamSwitch).values({
      tenantId,
      runId: run.id,
      teamExternalId: t.id,
      teamId: teamIdOf.get(t.id) ?? null,
      state: "pending",
      checklist: checklist as Array<{ key: string; label: string; done: boolean }>,
    });
  }

  /* The shadow webhook's token: hashed for the lookup, encrypted to show the URL again. */
  let tokenPatch: Partial<Run> = {};
  if (!run.shadowTokenHash) {
    const token = randomBytes(18).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    await registerApiKeyLookup(`og:${hash}`, tenantId, tx);
    tokenPatch = { shadowTokenHash: hash, shadowTokenEncrypted: encryptSecret(token) };
  }
  await tx
    .update(migrationRuns)
    .set({
      meta: { ...run.meta, helperPaths },
      ...tokenPatch,
      shadowStartedAt: run.shadowStartedAt ?? now,
    })
    .where(eq(migrationRuns.id, run.id));
  await setStep(tx, run.id, {
    step: "shadow",
    steps: { people: "done", preview: "done", shadow: "running" },
  });
  return { created };
}

/** Creates one schedule part: the draft, its rotations, its overrides and its gate. */
async function createPart(
  tx: Tx,
  tenantId: string,
  part: ShapePart,
  actor: string | null,
  now: Date,
): Promise<{
  scheduleId: string;
  gateSetId: string | null;
  rotations: number;
  rotationIds: Record<string, string>;
  overrideIds: string[];
}> {
  const name = await freeName(tx, tenantId, schedules, part.name);
  const [sched] = await tx
    .insert(schedules)
    .values({
      tenantId,
      name,
      timezone: part.timezone,
      handoverTime: part.handoverTime,
      status: "draft",
      icalToken: randomBytes(24).toString("hex"),
      createdByMemberId: actor,
    })
    .returning({ id: schedules.id });
  const scheduleId = sched!.id;
  const rotationIds: Record<string, string> = {};
  const overrideIds: string[] = [];
  const gaps: Array<{ rotationId: string; start: Date; end: Date }> = [];
  for (const rot of part.rotations) {
    // A gap keeps its place in the turns: someone holds it, and a NOBODY
    // override covers each of its turns for the year to come.
    const real = rot.memberIds.filter((m) => !isNobody(m));
    const memberIds = rot.memberIds.map((m, i) => {
      if (!isNobody(m)) return m;
      for (let k = 1; k < rot.memberIds.length; k++) {
        const prev = rot.memberIds[(i - k + rot.memberIds.length) % rot.memberIds.length]!;
        if (!isNobody(prev)) return prev;
      }
      return m;
    });
    const [row] = await tx
      .insert(rotations)
      .values({
        tenantId,
        scheduleId,
        name: rot.name,
        interval: rot.interval,
        handoverDay: rot.handoverDay,
        activeStart: rot.activeStart,
        activeEnd: rot.activeEnd,
        memberIds: real.length ? memberIds : [],
        effectiveFrom: rot.effectiveFrom,
        position: rot.position,
      })
      .returning({ id: rotations.id });
    rotationIds[rot.ogRotationId] = row!.id;
    if (real.length && real.length < rot.memberIds.length) {
      for (const sh of shiftsBetween(
        { timezone: part.timezone, handoverTime: part.handoverTime },
        rot,
        [],
        now,
        new Date(now.getTime() + 52 * WEEK),
      ))
        if (isNobody(sh.memberId))
          gaps.push({ rotationId: row!.id, start: sh.startAt, end: sh.endAt });
    }
  }
  const row = (o: {
    rotationId: string | null;
    memberId: string | null;
    startAt: Date;
    endAt: Date;
  }) => ({
    tenantId,
    scheduleId,
    rotationId: o.rotationId ? (rotationIds[o.rotationId] ?? o.rotationId) : null,
    memberId: o.memberId && !isNobody(o.memberId) ? o.memberId : null,
    startAt: o.startAt,
    endAt: o.endAt,
    reason: "override" as const,
    createdByMemberId: actor,
  });
  const future = part.overrides.filter((o) => o.endAt.getTime() > now.getTime());
  // Opsgenie's overrides are tracked (a new read replaces them); the slots
  // fixed here and the gaps are this side's own and stay.
  const fromOpsgenie = future.filter((o) => o.id.startsWith("og-override"));
  const ours = [
    ...future.filter((o) => !o.id.startsWith("og-override")),
    ...gaps.map((g) => ({
      rotationId: g.rotationId,
      memberId: null,
      startAt: g.start,
      endAt: g.end,
    })),
  ];
  if (fromOpsgenie.length) {
    const rows = await tx
      .insert(scheduleOverrides)
      .values(fromOpsgenie.map(row))
      .returning({ id: scheduleOverrides.id });
    overrideIds.push(...rows.map((r) => r.id));
  }
  if (ours.length) await tx.insert(scheduleOverrides).values(ours.map(row));
  let gateSetId: string | null = null;
  if (part.gate) {
    const gname = await freeName(tx, tenantId, workingHoursSets, part.name);
    const [g] = await tx
      .insert(workingHoursSets)
      .values({
        tenantId,
        name: gname,
        timezone: part.gate.timezone,
        days: part.gate.days,
        startTime: part.gate.startTime,
        endTime: part.gate.endTime,
      })
      .returning({ id: workingHoursSets.id });
    gateSetId = g!.id;
  }
  return { scheduleId, gateSetId, rotations: part.rotations.length, rotationIds, overrideIds };
}

/** The schedules as imported: the same shapes, read back from the rows. */
export async function importedShapes(
  tx: Tx,
  runId: string,
  people: PeopleIndex,
): Promise<Map<string, ScheduleShape>> {
  const items = await itemsOf(tx, runId, "schedule");
  const out = new Map<string, ScheduleShape>();
  const ids = items.flatMap((i) => linkOf(i)?.parts?.map((p) => p.scheduleId) ?? []);
  if (!ids.length) return out;
  const scheds = await tx.select().from(schedules).where(inArray(schedules.id, ids));
  const rots = await tx.select().from(rotations).where(inArray(rotations.scheduleId, ids));
  const ovs = await tx
    .select()
    .from(scheduleOverrides)
    .where(inArray(scheduleOverrides.scheduleId, ids));
  const gateIds = items.flatMap(
    (i) =>
      linkOf(i)
        ?.parts?.map((p) => p.gateSetId)
        .filter((x): x is string => Boolean(x)) ?? [],
  );
  const gates = gateIds.length
    ? await tx.select().from(workingHoursSets).where(inArray(workingHoursSets.id, gateIds))
    : [];
  for (const item of items) {
    const link = linkOf(item);
    if (!link?.parts) continue;
    const og = item.data as unknown as StoredSchedule;
    const planned = shapeSchedule(og, people);
    const parts: ShapePart[] = [];
    for (const p of link.parts) {
      const s = scheds.find((x) => x.id === p.scheduleId);
      if (!s) continue;
      const g = gates.find((x) => x.id === p.gateSetId);
      parts.push({
        key: p.key,
        name: s.name,
        timezone: s.timezone,
        handoverTime: s.handoverTime,
        rotations: rots
          .filter((r) => r.scheduleId === s.id)
          .map((r) => ({
            id: r.id,
            ogRotationId: Object.entries(p.rotationIds).find(([, v]) => v === r.id)?.[0] ?? r.id,
            name: r.name,
            interval: r.interval,
            handoverDay: r.handoverDay,
            activeStart: r.activeStart,
            activeEnd: r.activeEnd,
            memberIds: r.memberIds,
            effectiveFrom: r.effectiveFrom,
            position: r.position,
            previousOrders:
              (r as { previousOrders?: Array<{ memberIds: string[]; effectiveFrom: string }> })
                .previousOrders ?? [],
          })),
        overrides: ovs
          .filter((o) => o.scheduleId === s.id)
          .map((o) => ({
            id: o.id,
            rotationId: o.rotationId,
            memberId: o.memberId,
            startAt: o.startAt,
            endAt: o.endAt,
            reason: o.reason,
          })),
        gate: g
          ? { days: g.days, startTime: g.startTime, endTime: g.endTime, timezone: g.timezone }
          : null,
        scheduleId: s.id,
        gateSetId: g?.id,
      });
    }
    out.set(item.externalId, {
      ogId: item.externalId,
      name: og.name,
      mode: link.mode ?? planned.mode,
      parts,
      notes: link.notes ?? [],
    });
  }
  return out;
}

/** The published graph of a path, else its draft. */
export async function graphOf(tx: Tx, pathId: string): Promise<EscalationGraph | null> {
  const [p] = await tx.select().from(escalationPaths).where(eq(escalationPaths.id, pathId));
  if (!p) return null;
  return p.draftGraph ?? null;
}
