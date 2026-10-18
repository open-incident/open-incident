/**
 * Demo rows the V2 design shows for Atlas (atlas-core) — idempotent: every
 * row has an id derived from the workspace and a stable key, so a second run
 * finds what the first one wrote. Called by the demo seed and by
 * `run.ts --part atlas-core`. Owner: atlas-core.
 *
 * What it builds, on the demo's real services and incidents:
 *  - the allowed actions (the design's seven, the last one irreversible) and
 *    the workspace's Atlas settings (guardrails on, 400 € a month, 5 € a run);
 *  - a graded record for the history (INC-161 → INC-217) and an "Atlas era"
 *    of closed incidents over the last eight weeks, so that each service holds
 *    the level its record earns: auth-service L4, web-storefront L3,
 *    checkout-api L2, payments-worker L1 (lowered after a Miss, capped at L2);
 *  - the ladder's history (autonomy_events) and the audit lines it wrote;
 *  - INC-217's full journal (the rollback a person approved after 40 min);
 *  - two recent resolutions by Atlas waiting for review — one alone at L4,
 *    one at L3 with Thomas told — re-anchored on "now" at every run;
 *  - the open incidents: INC-218 with a proposal waiting for approval (L2),
 *    INC-219 with a fix held by the first-use guardrail (L4), INC-220
 *    investigated only (L1);
 *  - a completed 90-day backtest.
 *
 * Every figure the screens show is then computed from these rows; the
 * service_autonomy counters are recomputed from them at the end, with the same
 * definitions the engine uses.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  alertSources,
  alerts,
  auditEvents,
  followUps,
  incidentEvents,
  incidentRoles,
  incidentTypes,
  incidents,
  investigations,
  members,
  roleAssignments,
  services,
  severities,
  type Citation,
  type Finding,
  type Hypothesis,
  type InvestigationGrade,
} from "../../schema/app";
import {
  actionCatalog,
  atlasActions,
  atlasNotifyPrefs,
  atlasSettings,
  autonomyEvents,
  backtests,
  serviceAutonomy,
} from "../../schema/atlas";
import type { SeedTx } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A UUID derived from the workspace and a key — the same on every run. */
function sid(tenantId: string, key: string): string {
  const h = createHash("sha256").update(`atlas-core:${tenantId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/* ---------- The allowed actions ---------- */

type ActionKey =
  | "rollback_deploy"
  | "flag_off"
  | "restart_pods"
  | "scale_deployment"
  | "reload_keys"
  | "drain_node"
  | "db_failover";

/**
 * The design's seven. Labels and descriptions of these built-in keys are
 * rendered from the dictionary; what is stored is the English default, kept
 * for the API and for a renamed action. The endpoints are Skylark's own
 * automation (a fictional company's), where the signed requests go.
 */
export const ATLAS_DEFAULT_ACTIONS: Array<{
  key: ActionKey;
  label: string;
  description: string;
  executor: "open-change" | "kubernetes" | "flags" | "runbook";
  minLevel: 0 | 1 | 2 | 3 | 4;
  reversible: boolean;
  enabled: boolean;
  path: string;
}> = [
  {
    key: "rollback_deploy",
    label: "Roll back a deploy",
    description: "through your deploy pipeline · progressive, health-checked",
    executor: "open-change",
    minLevel: 3,
    reversible: true,
    enabled: true,
    path: "deploys/rollback",
  },
  {
    key: "flag_off",
    label: "Turn a feature flag off",
    description: "feature flags · one flag, one environment",
    executor: "flags",
    minLevel: 3,
    reversible: true,
    enabled: true,
    path: "flags/off",
  },
  {
    key: "restart_pods",
    label: "Restart pods, one at a time",
    description: "Kubernetes · stops if a pod fails its check",
    executor: "kubernetes",
    minLevel: 3,
    reversible: true,
    enabled: true,
    path: "k8s/restart",
  },
  {
    key: "scale_deployment",
    label: "Scale a deployment",
    description: "Kubernetes · ±50 % at most, within quotas",
    executor: "kubernetes",
    minLevel: 3,
    reversible: true,
    enabled: true,
    path: "k8s/scale",
  },
  {
    key: "reload_keys",
    label: "Reload a cache or signing keys",
    description: "service endpoint declared in the runbook",
    executor: "runbook",
    minLevel: 4,
    reversible: true,
    enabled: true,
    path: "runbook/reload",
  },
  {
    key: "drain_node",
    label: "Move pods off a node",
    description: "Kubernetes · cordon + reschedule",
    executor: "kubernetes",
    minLevel: 4,
    reversible: true,
    enabled: true,
    path: "k8s/drain",
  },
  {
    key: "db_failover",
    label: "Fail over the database",
    description: "not reversible in under 10 minutes",
    executor: "runbook",
    minLevel: 4,
    reversible: false,
    enabled: false,
    path: "db/failover",
  },
];

const AUTOMATION = "https://automation.skylark.dev/atlas";

/* ---------- Members, services, the incident's reference rows ---------- */

type Who = "AL" | "KH" | "NB" | "LG" | "TM" | "CD";
const EMAILS: Record<Who, string> = {
  AL: "amelie@skylark.dev",
  KH: "karim@skylark.dev",
  NB: "nadia@skylark.dev",
  LG: "lucas@skylark.dev",
  TM: "thomas@skylark.dev",
  CD: "claire@skylark.dev",
};
type Svc = "auth-service" | "web-storefront" | "checkout-api" | "payments-worker";

type Ctx = {
  tenantId: string;
  now: number;
  today: number;
  member: Record<Who, { id: string; name: string }>;
  service: Record<Svc, string>;
  sev: Record<string, string>;
  typeId: string;
  leadRoleId: string | null;
  source: Record<string, string>;
};

/** A moment N days before today (UTC), at hh:mm UTC. */
function ago(ctx: Ctx, days: number, hh: number, mm = 0): Date {
  return new Date(ctx.today - days * DAY + hh * HOUR + mm * MIN);
}

/* ---------- Journal ---------- */

type Kind = "read" | "oi_write" | "system" | "human";
type Step = {
  key: string;
  at: Date;
  kind: Kind;
  /** A fixed engine sentence, rendered from the dictionary (atlas.j.*). */
  text?: { key: string; params?: Record<string, string | number> };
  title: string;
  detail?: string;
  actionKey?: ActionKey;
  by?: Who;
  level: number;
  autonomous?: boolean;
  reversible?: boolean;
  approval?: "none" | "waiting" | "approved" | "rejected" | "withdrawn";
  requestedAt?: Date;
  approvedBy?: Who;
  executedAt?: Date;
  verifiedAt?: Date;
  cost: number;
  tokens: number;
  payload?: Record<string, unknown>;
  /** Write a timeline event for it (all do, by default). */
  timeline?: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

async function writeJournal(
  tx: SeedTx,
  ctx: Ctx,
  inc: { id: string; key: string },
  service: Svc,
  invId: string,
  steps: Step[],
): Promise<void> {
  for (const s of steps) {
    const id = sid(ctx.tenantId, `${inc.key}:a:${s.key}`);
    const member = s.by ? ctx.member[s.by] : null;
    const payload: Record<string, unknown> = {
      ...(s.payload ?? {}),
      ...(s.text ? { text: s.text } : {}),
    };
    const row = {
      id,
      tenantId: ctx.tenantId,
      investigationId: invId,
      incidentId: inc.id,
      serviceId: ctx.service[service],
      at: s.at,
      kind: s.kind,
      actionKey: s.actionKey ?? null,
      title: s.title,
      detail: s.detail ?? null,
      payload,
      decidedBy: (s.kind === "human" ? "member" : "atlas") as "member" | "atlas",
      decidedByMemberId: s.kind === "human" ? (member?.id ?? null) : null,
      level: s.level as 0 | 1 | 2 | 3 | 4,
      autonomous: Boolean(s.autonomous),
      approvalState: s.approval ?? "none",
      approvalRequestedAt: s.requestedAt ?? null,
      approvedByMemberId: s.approvedBy ? ctx.member[s.approvedBy].id : null,
      executedAt: s.executedAt ?? null,
      verifiedAt: s.verifiedAt ?? null,
      reversible: Boolean(s.reversible),
      undoneAt: null,
      undoneByMemberId: null,
      redoneAt: null,
      costEur: r2(s.cost),
      tokens: s.tokens,
      sources: [] as string[],
    };
    await tx
      .insert(atlasActions)
      .values(row)
      .onConflictDoUpdate({
        target: atlasActions.id,
        set: {
          at: row.at,
          title: row.title,
          detail: row.detail,
          payload: row.payload,
          approvalState: row.approvalState,
          approvalRequestedAt: row.approvalRequestedAt,
          approvedByMemberId: row.approvedByMemberId,
          executedAt: row.executedAt,
          verifiedAt: row.verifiedAt,
          undoneAt: null,
          undoneByMemberId: null,
          redoneAt: null,
          costEur: row.costEur,
          tokens: row.tokens,
        },
      });
    if (s.timeline === false) continue;
    // The timeline mirrors the journal: the proposal, the approval, then the
    // execution as its own line, each pointing at the journal row.
    const ev = async (suffix: string, at: Date, extra: Record<string, unknown>) => {
      const evId = sid(ctx.tenantId, `${inc.key}:e:${s.key}:${suffix}`);
      const values = {
        id: evId,
        tenantId: ctx.tenantId,
        incidentId: inc.id,
        kind: "atlas_action" as const,
        actorKind: (s.kind === "human" ? "member" : "ai") as "member" | "ai",
        actorMemberId: s.kind === "human" ? (member?.id ?? null) : null,
        actorName: s.kind === "human" ? (member?.name ?? null) : "Atlas",
        payload: {
          actionId: id,
          title: s.title,
          detail: s.detail ?? null,
          kind: s.kind,
          autonomous: Boolean(s.autonomous),
          reversible: Boolean(s.reversible),
          level: s.level,
          ...(s.text ? { text: s.text } : {}),
          ...extra,
        },
        occurredAt: at,
      };
      await tx
        .insert(incidentEvents)
        .values(values)
        .onConflictDoUpdate({
          target: incidentEvents.id,
          set: { occurredAt: values.occurredAt, payload: values.payload },
        });
    };
    await ev("main", s.at, s.kind === "system" ? { phase: "proposed" } : {});
    if (s.kind === "system" && s.executedAt && s.executedAt.getTime() !== s.at.getTime()) {
      const done = String(s.payload?.done ?? s.title);
      await ev("exec", s.executedAt, {
        phase: "executed",
        title: done,
        text: undefined,
        reversible: Boolean(s.reversible),
      });
    }
  }
}

async function upsertEvent(
  tx: SeedTx,
  ctx: Ctx,
  key: string,
  values: {
    incidentId: string;
    kind: string;
    actorKind: "member" | "system" | "api" | "ai";
    actorMemberId?: string | null;
    actorName?: string | null;
    payload: Record<string, unknown>;
    occurredAt: Date;
  },
): Promise<void> {
  const id = sid(ctx.tenantId, key);
  await tx
    .insert(incidentEvents)
    .values({ id, tenantId: ctx.tenantId, ...values })
    .onConflictDoUpdate({
      target: incidentEvents.id,
      set: { occurredAt: values.occurredAt, payload: values.payload },
    });
}

/* ---------- Investigations ---------- */

type InvSpec = {
  incidentId: string;
  key: string;
  whatsGoingOn: string;
  cause: string;
  hypothesis: string;
  why: string;
  contradicted?: Array<{ what: string; why: string; note: string }>;
  finding: string;
  nextSteps: string[];
  level: number;
  grade: InvestigationGrade | null;
  gradedBy?: Who;
  gradedAt?: Date;
  resolvedAlone?: boolean;
  reviewState?: "pending" | "ok" | "miss" | "reopened" | null;
  cost: number;
  tokens: number;
  startedAt: Date;
  completedAt: Date;
  checksAt?: number;
};

async function upsertInvestigation(tx: SeedTx, ctx: Ctx, s: InvSpec): Promise<string> {
  const citations: Citation[] = [
    { id: "E1", kind: "event", label: "Timeline", url: null },
    { id: "A1", kind: "alert", label: "Alerte liée", url: null },
    { id: "C1", kind: "change", label: "Changement récent", url: null },
  ];
  const findings: Finding[] = [
    { id: "F1", check: "alerts", statement: s.finding, citations: ["A1", "E1"] },
    { id: "F2", check: "changes", statement: s.cause, citations: ["C1"] },
  ];
  const hypotheses: Hypothesis[] = [
    {
      id: "H1",
      whatBroke: s.hypothesis,
      why: s.why,
      confidence: "strong",
      state: "open",
      findings: ["F1", "F2"],
      nextSteps: s.nextSteps,
      challenge: "Aucune objection : rien dans le matériel ne contredit cette cause.",
      challengeCitations: ["A1"],
    },
    ...(s.contradicted ?? []).map((c, i) => ({
      id: `H${i + 2}`,
      whatBroke: c.what,
      why: c.why,
      confidence: "speculation" as const,
      state: "contradicted" as const,
      findings: ["F1"],
      nextSteps: [],
      challenge: c.note,
      challengeCitations: ["E1"],
    })),
  ];
  const values = {
    id: sid(ctx.tenantId, `${s.key}:inv`),
    tenantId: ctx.tenantId,
    incidentId: s.incidentId,
    status: "completed" as const,
    trigger: "declaration" as const,
    paused: false,
    runs: 1,
    triage: {
      severityHint: null,
      scope: s.whatsGoingOn.slice(0, 120),
      escalate: false,
      rationale: "",
    },
    summary: {
      whatsGoingOn: s.whatsGoingOn,
      whatCaused: `${s.hypothesis} — ${s.why}`,
      topHypothesisId: "H1",
      nextSteps: s.nextSteps,
    },
    hypotheses,
    findings,
    citations,
    checks: (
      ["timeline", "alerts", "changes", "similar_incidents", "runbooks", "ownership"] as const
    ).map((kind, i) => ({
      kind,
      status: "done" as const,
      count: 1 + ((i * 7 + s.key.length) % 5),
      ms: 300 + i * 410,
      note: null,
    })),
    blastRadius: s.whatsGoingOn.slice(0, 160),
    model: null,
    provider: null,
    grade: s.grade,
    gradeNote: null,
    gradedByMemberId: s.gradedBy ? ctx.member[s.gradedBy].id : null,
    gradedAt: s.grade ? (s.gradedAt ?? null) : null,
    levelAtStart: s.level,
    resolvedAlone: Boolean(s.resolvedAlone),
    costEur: r2(s.cost),
    tokensTotal: s.tokens,
    reviewState: s.reviewState ?? null,
    error: null,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
  };
  const [row] = await tx
    .insert(investigations)
    .values(values)
    .onConflictDoUpdate({
      target: investigations.incidentId,
      set: {
        grade: values.grade,
        gradedByMemberId: values.gradedByMemberId,
        gradedAt: values.gradedAt,
        levelAtStart: values.levelAtStart,
        resolvedAlone: values.resolvedAlone,
        costEur: values.costEur,
        tokensTotal: values.tokensTotal,
        reviewState: values.reviewState,
        startedAt: values.startedAt,
        completedAt: values.completedAt,
        summary: values.summary,
        hypotheses: values.hypotheses,
        findings: values.findings,
        citations: values.citations,
        status: "completed",
        paused: false,
      },
    })
    .returning({ id: investigations.id });
  return row!.id as string;
}

/* ---------- Scenarios ---------- */

type Scenario = {
  title: string;
  action: ActionKey | null;
  todo: string;
  done: string;
  how: string;
  hypothesis: string;
  why: string;
  finding: string;
  verify: string;
};

const SCENARIOS: Record<Svc, Scenario[]> = {
  "auth-service": [
    {
      title: "Pods auth-service en CrashLoopBackOff après déploiement",
      action: "rollback_deploy",
      todo: "Revenir au déploiement précédent d'auth-service",
      done: "auth-service ramené au déploiement précédent",
      how: "Rollback progressif, 6/6 pods sains",
      hypothesis: "Une régression de configuration du dernier déploiement",
      why: "fait échouer le démarrage des pods (variable JWKS_URL vide)",
      finding: "Les pods redémarrent en boucle depuis le déploiement de 10 minutes plus tôt.",
      verify: "Pods stables depuis 10 min, erreurs de connexion à 0,1 %",
    },
    {
      title: "Taux d'échec du rafraîchissement de jeton au-dessus de 2 %",
      action: "restart_pods",
      todo: "Redémarrer un à un les 3 pods qui servent l'ancien JWKS",
      done: "3 pods redémarrés un à un",
      how: "Un pod à la fois, contrôle de santé entre chaque",
      hypothesis: "Trois pods ont gardé l'ancien jeu de clés en cache",
      why: "après la rotation des clés de signature",
      finding: "3 pods sur 6 répondent avec un kid de clé retiré.",
      verify: "Erreurs de rafraîchissement à 0,0 % depuis 5 min",
    },
    {
      title: "Saturation CPU des pods auth-service",
      action: "scale_deployment",
      todo: "Passer auth-service de 6 à 9 réplicas",
      done: "auth-service passé de 6 à 9 réplicas",
      how: "+50 %, dans le quota du namespace",
      hypothesis: "Le trafic de connexion dépasse la capacité provisionnée",
      why: "hausse de 40 % liée à une campagne marketing",
      finding: "CPU des pods à 96 %, latence p95 de connexion à 1,2 s.",
      verify: "CPU à 61 %, latence p95 sous 400 ms depuis 10 min",
    },
    {
      title: "Erreurs 401 en hausse après l'activation de login.passkeys",
      action: "flag_off",
      todo: "Désactiver le flag login.passkeys en production",
      done: "Flag login.passkeys désactivé en production",
      how: "Un flag, un environnement",
      hypothesis: "Le nouveau parcours passkeys rejette les sessions existantes",
      why: "le flag a été passé à 50 % juste avant la hausse",
      finding: "Les 401 viennent toutes de sessions ouvertes avant l'activation.",
      verify: "Taux de 401 revenu à 0,3 % en 4 min",
    },
    {
      title: "Latence p95 de connexion au-dessus de 800 ms",
      action: "drain_node",
      todo: "Déplacer 2 pods hors du nœud eu-w1-c",
      done: "2 pods déplacés hors du nœud eu-w1-c",
      how: "Cordon du nœud puis replanification",
      hypothesis: "Un voisin bruyant sur le nœud eu-w1-c",
      why: "CPU steal à 38 % sur ce nœud uniquement",
      finding: "Seuls les pods du nœud eu-w1-c sont lents.",
      verify: "Latence p95 revenue sous 300 ms en 2 min",
    },
  ],
  "web-storefront": [
    {
      title: "Erreurs 503 sur les pages produit",
      action: "scale_deployment",
      todo: "Passer web-storefront de 8 à 12 réplicas",
      done: "web-storefront passé de 8 à 12 réplicas",
      how: "+50 %, dans le quota du namespace",
      hypothesis: "Le pic de trafic du soir dépasse la capacité des pods",
      why: "CPU à 95 % sur tous les pods",
      finding: "Les 503 suivent la saturation CPU des pods storefront.",
      verify: "503 sous 0,2 % depuis 5 min",
    },
    {
      title: "Pic de 5xx sur le panier après déploiement",
      action: "rollback_deploy",
      todo: "Revenir au déploiement précédent de web-storefront",
      done: "web-storefront ramené au déploiement précédent",
      how: "Rollback progressif, contrôlé par la santé",
      hypothesis: "Une régression dans le dernier déploiement du panier",
      why: "les 5xx commencent 2 minutes après la mise en production",
      finding: "Les erreurs viennent toutes de la nouvelle route /cart/v2.",
      verify: "5xx sous 0,5 % depuis 5 min",
    },
    {
      title: "Latence p99 du storefront au-dessus de 3 s",
      action: "flag_off",
      todo: "Désactiver le flag storefront.recommendations-v2",
      done: "Flag storefront.recommendations-v2 désactivé",
      how: "Un flag, un environnement",
      hypothesis: "Le nouveau moteur de recommandations ralentit le rendu",
      why: "la latence suit l'activation du flag",
      finding: "Le temps passé dans les recommandations a été multiplié par 6.",
      verify: "p99 revenue sous 1 s en 3 min",
    },
    {
      title: "Pods web-storefront bloqués après une mise à jour de configuration",
      action: "restart_pods",
      todo: "Redémarrer un à un les pods web-storefront",
      done: "8 pods web-storefront redémarrés un à un",
      how: "Un pod à la fois, contrôle de santé entre chaque",
      hypothesis: "La nouvelle configuration n'a pas été rechargée à chaud",
      why: "les pods servent encore l'ancienne version de la config",
      finding: "Les pods annoncent une révision de config antérieure.",
      verify: "Tous les pods sur la révision courante, erreurs à 0,1 %",
    },
  ],
  "checkout-api": [
    {
      title: "Erreurs de validation d'adresse au checkout",
      action: "flag_off",
      todo: "Désactiver le flag checkout.address-autocomplete",
      done: "Flag checkout.address-autocomplete désactivé",
      how: "Un flag, un environnement",
      hypothesis: "L'autocomplétion d'adresse renvoie des codes postaux tronqués",
      why: "le flag a été élargi à 50 % juste avant",
      finding: "Les rejets de validation portent tous sur des adresses autocomplétées.",
      verify: "Rejets de validation revenus à 0,4 %",
    },
    {
      title: "Latence du paiement au-dessus de 2 s",
      action: "rollback_deploy",
      todo: "Revenir au déploiement précédent de checkout-api",
      done: "checkout-api ramené au déploiement précédent",
      how: "Rollback progressif, contrôlé par la santé",
      hypothesis: "Une requête N+1 introduite par le dernier déploiement",
      why: "le nombre de requêtes SQL par paiement a triplé",
      finding: "La latence suit le déploiement de 15 minutes plus tôt.",
      verify: "p99 du paiement sous 800 ms depuis 10 min",
    },
    {
      title: "Timeouts vers payments-worker depuis checkout-api",
      action: "scale_deployment",
      todo: "Passer checkout-api de 6 à 9 réplicas",
      done: "checkout-api passé de 6 à 9 réplicas",
      how: "+50 %, dans le quota du namespace",
      hypothesis: "Le pool de connexions de checkout-api sature au pic",
      why: "41 connexions en attente au pic de 12:30",
      finding: "Les timeouts coïncident avec la saturation du pool.",
      verify: "Timeouts revenus à 0 en 5 min",
    },
  ],
  "payments-worker": [
    {
      title: "File de webhooks en retard sur payments-worker",
      action: "scale_deployment",
      todo: "Passer payments-worker de 4 à 6 réplicas",
      done: "payments-worker passé de 4 à 6 réplicas",
      how: "+50 %, dans le quota du namespace",
      hypothesis: "Les consommateurs ne suivent plus le débit de webhooks",
      why: "file à 12 000 messages, consommation stable",
      finding: "Le retard croît linéairement depuis 20 minutes.",
      verify: "File revenue sous 500 messages",
    },
    {
      title: "Échecs de capture de paiement après déploiement",
      action: "rollback_deploy",
      todo: "Revenir au déploiement précédent de payments-worker",
      done: "payments-worker ramené au déploiement précédent",
      how: "Rollback progressif, contrôlé par la santé",
      hypothesis: "Une régression dans le dernier déploiement de payments-worker",
      why: "les échecs commencent après la mise en production",
      finding: "Les captures échouent avec un timeout côté fournisseur.",
      verify: "Échecs de capture toujours à 3 % après le rollback",
    },
  ],
};

/* ---------- The plan: who did what, at which level ---------- */

type Pattern =
  /** Investigated only — findings and maybe a draft. */
  | "investigate"
  /** L2: proposal approved unchanged / with a change / rejected. */
  | "approved"
  | "modified"
  | "rejected"
  /** L3: acted and paged at the same moment, then resolved. */
  | "act_tell"
  /** L4: acted, verified, resolved; nobody paged. */
  | "alone";

type EraIncident = {
  key: string;
  svc: Svc;
  daysAgo: number;
  hh: number;
  mm: number;
  level: number;
  pattern: Pattern;
  scenario: number;
  grade: InvestigationGrade;
  grader: Who;
  sev: "SEV3" | "SEV4";
};

function eraPlan(): EraIncident[] {
  const out: EraIncident[] = [];
  const add = (
    svc: Svc,
    days: number[],
    level: number,
    pattern: Pattern | ((i: number) => Pattern),
    opts: {
      scenario?: (i: number) => number;
      grade?: (i: number) => InvestigationGrade;
      graders: Who[];
    },
  ) => {
    days.forEach((d, i) => {
      out.push({
        key: `era:${svc}:${d}`,
        svc,
        daysAgo: d,
        hh: [1, 3, 8, 10, 13, 15, 19, 22][(d * 3 + i) % 8]!,
        mm: (d * 7 + i * 11) % 60,
        level,
        pattern: typeof pattern === "function" ? pattern(i) : pattern,
        scenario: opts.scenario ? opts.scenario(i) : i,
        grade: opts.grade ? opts.grade(i) : i % 3 === 1 ? "on_target" : "bullseye",
        grader: opts.graders[i % opts.graders.length]!,
        sev: (d + i) % 4 === 0 ? "SEV3" : "SEV4",
      });
    });
  };
  // auth-service: L2 (proposals approved, every action used once with a
  // person), then L3 from 38 days ago, then L4 from 16 days ago.
  add("auth-service", [52, 50, 48, 47, 45, 43, 42, 40, 39], 2, "approved", {
    scenario: (i) => i % 5,
    graders: ["AL", "KH", "TM"],
  });
  add(
    "auth-service",
    [37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 19],
    3,
    "act_tell",
    { scenario: (i) => i % 4, graders: ["KH", "AL", "TM", "LG"] },
  );
  add("auth-service", [14, 11, 8, 5, 2], 4, "alone", {
    scenario: (i) => [4, 1, 2, 0, 4][i]!,
    graders: ["AL", "KH"],
  });
  // web-storefront: L2 for six incidents, L3 from 32 days ago.
  add("web-storefront", [50, 47, 44, 41, 37, 34], 2, "approved", {
    scenario: (i) => i % 4,
    graders: ["TM", "LG", "AL"],
  });
  add(
    "web-storefront",
    [30, 27, 24, 20, 15, 12, 9, 4],
    3,
    (i) => (i === 3 ? "investigate" : "act_tell"),
    { scenario: (i) => i % 4, graders: ["TM", "LG"] },
  );
  // checkout-api: L2 throughout.
  add(
    "checkout-api",
    [48, 40, 33, 25, 19, 12, 6],
    2,
    (i) =>
      (
        [
          "approved",
          "approved",
          "rejected",
          "modified",
          "investigate",
          "approved",
          "investigate",
        ] as const
      )[i]!,
    { scenario: (i) => i % 3, graders: ["AL", "KH"] },
  );
  // payments-worker: one right run that earns L2 back, then the Miss of Oct 12.
  add("payments-worker", [28], 2, "approved", { scenario: () => 0, graders: ["NB"] });
  add("payments-worker", [6], 2, "approved", {
    scenario: () => 1,
    grade: () => "miss",
    graders: ["NB"],
  });
  return out.sort((a, b) => b.daysAgo - a.daysAgo || a.hh - b.hh);
}

/** The demo history's grades: which run each service got wrong, by number. */
const HISTORY_MISSES = new Set([163, 188, 173, 192, 175, 210, 195, 197]);
/** History incidents Atlas never graded (nobody did), and the ones it never read. */
const HISTORY_UNGRADED = new Set([194, 205]);
const HISTORY_SKIP = new Set([212, 215]);
/** The level each service held when a history incident was declared, by number. */
const HISTORY_LEVEL: Record<number, number> = {
  // auth-service: L1 from Jun 1, L2 from Jul 26
  163: 0,
  188: 0,
  191: 0,
  185: 0,
  199: 1,
  184: 1,
  193: 1,
  161: 1,
  176: 1,
  181: 1,
  177: 2,
  162: 2,
  208: 2,
  // web-storefront: L1 from Jun 22, L2 from Aug 5
  173: 0,
  192: 0,
  167: 0,
  183: 0,
  198: 0,
  174: 1,
  166: 1,
  171: 1,
  206: 1,
  196: 1,
  170: 2,
  200: 2,
  204: 2,
  213: 2,
  // checkout-api: L1 from Jun 22, L2 from Aug 23
  175: 0,
  201: 0,
  211: 0,
  203: 0,
  172: 0,
  189: 1,
  207: 1,
  182: 1,
  187: 1,
  214: 1,
  217: 2,
  // payments-worker: L1 from Jun 23, L2 from Jul 27
  210: 0,
  195: 0,
  209: 0,
  197: 0,
  179: 0,
  205: 1,
  194: 1,
  178: 1,
  180: 1,
  202: 1,
  164: 1,
  186: 1,
  168: 1,
  165: 1,
  169: 1,
  190: 2,
  216: 2,
};
/** History incidents at L2 where Atlas's proposal was approved. */
const HISTORY_APPROVED: Record<number, number> = {
  177: 2,
  162: 1,
  208: 4,
  170: 0,
  200: 1,
  204: 2,
  190: 0,
};

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  const ctx = await context(tx, tenantId);
  if (!ctx) return;
  await ensureSettings(tx, ctx);
  await ensureActions(tx, ctx);
  await gradeHistory(tx, ctx);
  await seedIncident217(tx, ctx);
  const era = await seedEra(tx, ctx);
  await seedRecent(tx, ctx);
  await seedOpen(tx, ctx);
  await seedLadder(tx, ctx);
  await seedBacktest(tx, ctx);
  await seedAudit(tx, ctx, era);
  await recompute(tx, ctx);
}

async function context(tx: SeedTx, tenantId: string): Promise<Ctx | null> {
  const ms = await tx
    .select({ id: members.id, name: members.name, email: members.email })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), inArray(members.email, Object.values(EMAILS))));
  const member = {} as Ctx["member"];
  for (const [k, email] of Object.entries(EMAILS) as Array<[Who, string]>) {
    const m = ms.find((x: { email: string }) => x.email === email);
    if (!m) return null;
    member[k] = { id: m.id, name: m.name };
  }
  const svcs = await tx
    .select({ id: services.id, key: services.key })
    .from(services)
    .where(eq(services.tenantId, tenantId));
  const service = {} as Ctx["service"];
  for (const k of ["auth-service", "web-storefront", "checkout-api", "payments-worker"] as Svc[]) {
    const s = svcs.find((x: { key: string }) => x.key === k);
    if (!s) return null;
    service[k] = s.id;
  }
  const sevs = await tx
    .select({ id: severities.id, name: severities.name })
    .from(severities)
    .where(eq(severities.tenantId, tenantId));
  const sev: Record<string, string> = {};
  for (const s of sevs) sev[s.name] = s.id;
  const [type] = await tx
    .select({ id: incidentTypes.id })
    .from(incidentTypes)
    .where(and(eq(incidentTypes.tenantId, tenantId), eq(incidentTypes.isDefault, true)));
  if (!type) return null;
  const [lead] = await tx
    .select({ id: incidentRoles.id })
    .from(incidentRoles)
    .where(and(eq(incidentRoles.tenantId, tenantId), eq(incidentRoles.isLead, true)));
  const srcs = await tx
    .select({ id: alertSources.id, name: alertSources.name })
    .from(alertSources)
    .where(eq(alertSources.tenantId, tenantId));
  const source: Record<string, string> = {};
  for (const s of srcs) source[s.name] = s.id;
  const now = Date.now();
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    tenantId,
    now,
    today,
    member,
    service,
    sev,
    typeId: type.id,
    leadRoleId: lead?.id ?? null,
    source,
  };
}

async function ensureSettings(tx: SeedTx, ctx: Ctx): Promise<void> {
  await tx
    .insert(atlasSettings)
    .values({
      tenantId: ctx.tenantId,
      killSwitch: false,
      budgetMonthEur: 400,
      capPerRunEur: 5,
      executorNonce: sid(ctx.tenantId, "executor-nonce"),
    })
    .onConflictDoUpdate({
      target: atlasSettings.tenantId,
      set: {
        killSwitch: false,
        killSwitchAt: null,
        killSwitchByMemberId: null,
        budgetMonthEur: 400,
        capPerRunEur: 5,
        guardrails: {
          sev1: true,
          securityAndPrivate: true,
          firstUseOnService: true,
          changeFreeze: true,
          publicStatusPage: true,
          catalogOnly: true,
        },
      },
    });
  // Thomas wants the silent push right away; everyone else keeps the 09:00 summary.
  await tx
    .insert(atlasNotifyPrefs)
    .values({ tenantId: ctx.tenantId, memberId: ctx.member.TM.id, mode: "push" })
    .onConflictDoUpdate({ target: atlasNotifyPrefs.memberId, set: { mode: "push" } });
}

async function ensureActions(tx: SeedTx, ctx: Ctx): Promise<void> {
  for (const a of ATLAS_DEFAULT_ACTIONS) {
    const http = {
      doUrl: `${AUTOMATION}/${a.path}`,
      undoUrl: a.reversible ? `${AUTOMATION}/${a.path}/undo` : null,
      verifyUrl: a.reversible ? `${AUTOMATION}/${a.path}/status` : null,
    };
    await tx
      .insert(actionCatalog)
      .values({
        tenantId: ctx.tenantId,
        key: a.key,
        label: a.label,
        description: a.description,
        executor: a.executor,
        reversible: a.reversible,
        minLevel: a.minLevel,
        enabled: a.enabled,
        limits: { http },
      })
      .onConflictDoUpdate({
        target: [actionCatalog.tenantId, actionCatalog.key],
        set: {
          label: a.label,
          description: a.description,
          executor: a.executor,
          reversible: a.reversible,
          minLevel: a.minLevel,
          enabled: a.enabled,
          limits: { http },
          updatedAt: new Date(),
        },
      });
  }
}

/* ---------- History: INC-161 → INC-216 ---------- */

async function gradeHistory(tx: SeedTx, ctx: Ctx): Promise<void> {
  const rows = await tx
    .select({
      id: incidents.id,
      number: incidents.number,
      name: incidents.name,
      serviceId: incidents.serviceId,
      declaredAt: incidents.declaredAt,
      resolvedAt: incidents.resolvedAt,
      closedAt: incidents.closedAt,
    })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, ctx.tenantId),
        sql`${incidents.number} between 161 and 216`,
        eq(incidents.mode, "live"),
      ),
    );
  const bySvc = Object.fromEntries(
    Object.entries(ctx.service).map(([k, v]) => [v, k as Svc]),
  ) as Record<string, Svc>;
  const graders: Who[] = ["AL", "KH", "NB", "TM", "LG"];
  for (const inc of rows) {
    if (HISTORY_SKIP.has(inc.number) || !inc.serviceId) continue;
    const svc = bySvc[inc.serviceId];
    if (!svc) continue;
    const level = HISTORY_LEVEL[inc.number] ?? 1;
    const key = `hist:${inc.number}`;
    const scenarioIndex = HISTORY_APPROVED[inc.number];
    const sc =
      scenarioIndex !== undefined ? SCENARIOS[svc][scenarioIndex % SCENARIOS[svc].length]! : null;
    const miss = HISTORY_MISSES.has(inc.number);
    const grade: InvestigationGrade | null = HISTORY_UNGRADED.has(inc.number)
      ? null
      : miss
        ? "miss"
        : inc.number % 3 === 0
          ? "on_target"
          : "bullseye";
    const t0 = inc.declaredAt.getTime();
    const cost = 0.35 + ((inc.number * 37) % 120) / 100;
    const tokens = Math.round(cost * 31_000);
    const invId = await upsertInvestigation(tx, ctx, {
      incidentId: inc.id,
      key,
      whatsGoingOn: `${inc.name}. Atlas a rassemblé l'alerte, les changements récents et les incidents similaires.`,
      cause: sc ? sc.finding : "Le symptôme suit un changement récent sur le service.",
      hypothesis: sc ? sc.hypothesis : `Un changement récent sur ${svc}`,
      why: sc ? sc.why : "le symptôme commence juste après",
      finding: sc ? sc.finding : "L'alerte et la timeline situent le début du symptôme.",
      nextSteps: sc ? [sc.todo] : ["Vérifier le dernier changement du service"],
      level,
      grade,
      gradedBy: grade ? graders[inc.number % graders.length] : undefined,
      gradedAt: grade
        ? new Date((inc.closedAt ?? inc.resolvedAt ?? inc.declaredAt).getTime() + 3 * HOUR)
        : undefined,
      cost,
      tokens,
      startedAt: new Date(t0 + MIN),
      completedAt: new Date(t0 + 4 * MIN),
    });
    const steps: Step[] = [
      {
        key: "started",
        at: new Date(t0 + MIN),
        kind: "read",
        text: { key: "atlas.j.started", params: {} },
        title: "Started on the incident",
        detail: "Premier passage : sévérité, périmètre, astreinte.",
        level,
        autonomous: true,
        cost: cost * 0.08,
        tokens: Math.round(tokens * 0.08),
      },
      {
        key: "checks",
        at: new Date(t0 + 2 * MIN),
        kind: "read",
        text: { key: "atlas.j.checks", params: { n: 6 } },
        title: "Ran 6 checks in parallel",
        detail:
          "Changements récents, incidents similaires, alertes, runbooks, responsables, notes.",
        level,
        autonomous: true,
        cost: cost * 0.6,
        tokens: Math.round(tokens * 0.6),
      },
    ];
    if (sc && level === 2) {
      const req = t0 + 5 * MIN;
      const approvedAt = req + (12 + (inc.number % 20)) * MIN;
      const approver = graders[(inc.number + 1) % graders.length]!;
      steps.push(
        {
          key: "proposal",
          at: new Date(req),
          kind: "system",
          actionKey: sc.action!,
          text: { key: "atlas.j.proposed", params: { what: sc.todo } },
          title: `Proposed: ${sc.todo}`,
          detail: `${sc.how} · réversible`,
          level,
          reversible: true,
          approval: "approved",
          requestedAt: new Date(req),
          approvedBy: approver,
          executedAt: new Date(approvedAt + MIN),
          verifiedAt: new Date(approvedAt + 9 * MIN),
          cost: cost * 0.32,
          tokens: Math.round(tokens * 0.32),
          payload: { todo: sc.todo, done: sc.done, approvedAt: new Date(approvedAt).toISOString() },
        },
        {
          key: "approval",
          at: new Date(approvedAt),
          kind: "human",
          by: approver,
          text: {
            key: "atlas.j.approved",
            params: { member: ctx.member[approver].name, what: sc.todo },
          },
          title: `${ctx.member[approver].name} approved: ${sc.todo}`,
          detail: "Approuvé depuis l'incident.",
          level,
          cost: 0,
          tokens: 0,
        },
      );
    }
    await writeJournal(tx, ctx, { id: inc.id, key }, svc, invId, steps);
  }
}

/* ---------- INC-217, the design's reference run ---------- */

async function seedIncident217(tx: SeedTx, ctx: Ctx): Promise<void> {
  const [inc] = await tx
    .select({ id: incidents.id, declaredAt: incidents.declaredAt })
    .from(incidents)
    .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.number, 217)));
  if (!inc) return;
  const t0 = inc.declaredAt.getTime(); // 14:02 CEST
  const at = (m: number) => new Date(t0 + m * MIN);
  const key = "inc217";
  const invId = await upsertInvestigation(tx, ctx, {
    incidentId: inc.id,
    key,
    whatsGoingOn:
      "Résolu. La p99 checkout est revenue sous 300 ms depuis 15:12 ; 4 % des tentatives de paiement ont expiré entre 14:02 et 14:58 en eu-west-1.",
    cause:
      "Le déploiement payments-worker v2026.08.26-1 de 13:55 double la taille du pool de connexions du worker.",
    hypothesis:
      "Une fuite de connexions dans payments-worker v2026.08.26-1 épuise le pool partagé de la base",
    why: "le pool est à 20/20 avec 41 requêtes en attente depuis le déploiement de 13:55",
    contradicted: [
      {
        what: "Un pic de trafic checkout sature le pool",
        why: "les ventes de fin d'été",
        note: "Contredit : le trafic checkout est en baisse de 8 % sur la période.",
      },
      {
        what: "Une dégradation réseau en eu-west-1",
        why: "les timeouts sont limités à une région",
        note: "Contredit : AWS et Stripe sont opérationnels, les autres services de la région sont sains.",
      },
    ],
    finding: "Le pool de connexions partagé est saturé (20/20, 41 en attente) depuis 13:57.",
    nextSteps: [
      "Revenir de payments-worker v2026.08.26-1 à v2026.08.25-3",
      "Alerter sur la saturation du pool de connexions",
    ],
    level: 2,
    grade: "bullseye",
    gradedBy: "AL",
    gradedAt: new Date(t0 + 19.5 * HOUR),
    cost: 1.84,
    tokens: 61_000,
    startedAt: at(0),
    completedAt: at(4),
  });
  const todo = "Revenir de payments-worker v2026.08.26-1 à v2026.08.25-3";
  const done = "payments-worker ramené à v2026.08.25-3";
  const [fu] = await tx
    .select({ id: followUps.id })
    .from(followUps)
    .where(
      and(
        eq(followUps.tenantId, ctx.tenantId),
        eq(followUps.incidentId, inc.id),
        sql`${followUps.title} like 'Alerter sur la saturation%'`,
      ),
    );
  await writeJournal(tx, ctx, { id: inc.id, key }, "checkout-api", invId, [
    {
      key: "started",
      at: at(0),
      kind: "read",
      text: { key: "atlas.j.startedAlert", params: { source: "Datadog" } },
      title: "Started on the Datadog alert",
      detail:
        "Premier passage en 14 s : SEV2 probable, checkout en eu-west-1, Platform d'astreinte.",
      level: 2,
      autonomous: true,
      cost: 0.08,
      tokens: 4_000,
    },
    {
      key: "severity",
      at: at(2),
      kind: "oi_write",
      text: { key: "atlas.j.suggestedSeverity", params: { severity: "SEV2" } },
      title: "Suggested SEV2",
      detail: "4 % des paiements expirent dans une région. Accepté au triage par Amélie à 14:07.",
      level: 2,
      cost: 0,
      tokens: 0,
      payload: { accepted: true, acceptedBy: ctx.member.AL.name },
    },
    {
      key: "checks",
      at: at(3),
      kind: "read",
      text: { key: "atlas.j.checks", params: { n: 6 } },
      title: "Ran 6 checks in parallel",
      detail:
        "Changements récents, incidents similaires, métriques, logs, traces, statut des fournisseurs (AWS, Stripe : opérationnels).",
      level: 2,
      autonomous: true,
      cost: 1.12,
      tokens: 38_000,
    },
    {
      key: "draft",
      at: at(7),
      kind: "oi_write",
      text: { key: "atlas.j.draftedUpdate", params: {} },
      title: "Posted the first update draft",
      detail: "Publié par Amélie Laurent à 14:15 avec un mot changé.",
      level: 2,
      cost: 0.14,
      tokens: 4_000,
      payload: { draft: true, publishedBy: ctx.member.AL.name },
    },
    {
      key: "proposal",
      at: at(8),
      kind: "system",
      actionKey: "rollback_deploy",
      text: { key: "atlas.j.proposed", params: { what: todo } },
      title: `Proposed: ${todo}`,
      detail: "Depuis les actions autorisées · réversible · rayon d'impact : 1 service, 6 pods.",
      level: 2,
      reversible: true,
      approval: "approved",
      requestedAt: at(8),
      approvedBy: "AL",
      executedAt: at(50),
      verifiedAt: at(70),
      cost: 0.36,
      tokens: 11_000,
      payload: {
        todo,
        done,
        how: "Exécuté par l'automatisation de déploiement, progressif, 6/6 pods sains à 14:56.",
        approvedAt: at(48).toISOString(),
        blastRadius: "1 service, 6 pods",
        challenger: "holds",
      },
    },
    {
      key: "approval",
      at: at(48),
      kind: "human",
      by: "AL",
      text: { key: "atlas.j.approved", params: { member: ctx.member.AL.name, what: todo } },
      title: `${ctx.member.AL.name} approved: ${todo}`,
      detail: "Depuis Slack, un tap sur Approve.",
      level: 2,
      cost: 0,
      tokens: 0,
    },
    {
      key: "verified",
      at: at(70),
      kind: "read",
      text: { key: "atlas.j.verified", params: {} },
      title: "Verified recovery",
      detail: "p99 sous 300 ms depuis 15 min, pool à 7/20, taux d'erreur 0,1 %.",
      level: 2,
      autonomous: true,
      cost: 0.06,
      tokens: 2_000,
    },
    {
      key: "followup",
      at: at(72),
      kind: "oi_write",
      text: {
        key: "atlas.j.followUp",
        params: { title: "Alerter sur la saturation du pool de connexions DB" },
      },
      title: "Created follow-up: Alerter sur la saturation du pool de connexions DB",
      detail: "Priorité P1, responsable Platform.",
      level: 2,
      autonomous: true,
      reversible: true,
      cost: 0.05,
      tokens: 1_500,
      payload: { followUpId: fu?.id ?? null, op: "follow_up" },
    },
    {
      key: "resolve",
      at: at(76),
      kind: "oi_write",
      text: { key: "atlas.j.proposedResolve", params: {} },
      title: "Proposed to resolve",
      detail: "Accepté par Amélie Laurent. Flux post-incident lancé (règle SEV2).",
      level: 2,
      cost: 0.03,
      tokens: 500,
      payload: { accepted: true, acceptedBy: ctx.member.AL.name },
    },
  ]);
}

/* ---------- The Atlas era: closed incidents of the last eight weeks ---------- */

type Created = { id: string; number: number; key: string };

async function ensureIncident(
  tx: SeedTx,
  ctx: Ctx,
  key: string,
  values: {
    name: string;
    summary: string;
    svc: Svc;
    sev: string;
    phase: "closed" | "post_incident" | "active" | "triage";
    declaredAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    closedAt: Date | null;
    source: string;
  },
): Promise<Created> {
  const id = sid(ctx.tenantId, `${key}:incident`);
  const [existing] = await tx
    .select({ id: incidents.id, number: incidents.number })
    .from(incidents)
    .where(eq(incidents.id, id));
  const row = {
    name: values.name,
    summary: values.summary,
    severityId: ctx.sev[values.sev] ?? null,
    phase: values.phase,
    serviceId: ctx.service[values.svc],
    declaredAt: values.declaredAt,
    acceptedAt: values.acknowledgedAt,
    acknowledgedAt: values.acknowledgedAt,
    resolvedAt: values.resolvedAt,
    closedAt: values.closedAt,
    lastActivityAt: values.closedAt ?? values.resolvedAt ?? values.declaredAt,
  };
  if (existing) {
    await tx.update(incidents).set(row).where(eq(incidents.id, id));
    return { id, number: existing.number, key };
  }
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${incidents.number}), 0) + 1` })
    .from(incidents)
    .where(eq(incidents.tenantId, ctx.tenantId));
  await tx.insert(incidents).values({
    id,
    tenantId: ctx.tenantId,
    number: Number(next),
    typeId: ctx.typeId,
    mode: "live",
    visibility: "public",
    source: values.source,
    customFields: { region: "eu-west-1" },
    ...row,
  });
  return { id, number: Number(next), key };
}

async function seedEra(tx: SeedTx, ctx: Ctx): Promise<Created[]> {
  const out: Created[] = [];
  const plan = eraPlan();
  for (const p of plan) {
    const sc = SCENARIOS[p.svc][p.scenario % SCENARIOS[p.svc].length]!;
    const t0 = ago(ctx, p.daysAgo, p.hh, p.mm).getTime();
    const minutesToFix =
      p.pattern === "alone"
        ? 6 + (p.daysAgo % 5)
        : p.pattern === "act_tell"
          ? 9 + (p.daysAgo % 7)
          : 35 + (p.daysAgo % 40);
    const resolvedAt = new Date(t0 + minutesToFix * MIN);
    const closedAt = new Date(resolvedAt.getTime() + 4 * HOUR);
    const told: Who = (["KH", "TM", "AL", "LG"] as Who[])[p.daysAgo % 4]!;
    const source = p.svc === "web-storefront" ? "Sentry" : "Datadog";
    const inc = await ensureIncident(tx, ctx, p.key, {
      name: sc.title,
      summary: `${sc.finding} ${sc.verify}.`,
      svc: p.svc,
      sev: p.sev,
      phase: "closed",
      declaredAt: new Date(t0),
      acknowledgedAt: p.pattern === "alone" ? null : new Date(t0 + 3 * MIN),
      resolvedAt,
      closedAt,
      source: "alert",
    });
    out.push(inc);
    const cost =
      p.pattern === "alone" ? 0.45 + (p.daysAgo % 4) * 0.08 : 0.7 + ((p.daysAgo * 13) % 90) / 100;
    const tokens = Math.round(cost * 33_000);
    const atlasResolved = p.pattern === "alone" || p.pattern === "act_tell";
    const invId = await upsertInvestigation(tx, ctx, {
      incidentId: inc.id,
      key: p.key,
      whatsGoingOn: `${sc.finding} ${atlasResolved ? "Résolu par Atlas." : ""}`.trim(),
      cause: sc.finding,
      hypothesis: sc.hypothesis,
      why: sc.why,
      finding: sc.finding,
      nextSteps: [sc.todo],
      level: p.level,
      grade: p.grade,
      gradedBy: p.grader,
      gradedAt: new Date(closedAt.getTime() + 2 * HOUR),
      resolvedAlone: p.pattern === "alone",
      reviewState: atlasResolved ? (p.grade === "miss" ? "miss" : "ok") : null,
      cost,
      tokens,
      startedAt: new Date(t0 + 20_000),
      completedAt: new Date(t0 + 3 * MIN),
    });
    // The timeline's own lines: the alert, the resolution, the closure.
    await upsertEvent(tx, ctx, `${p.key}:ev:created`, {
      incidentId: inc.id,
      kind: "created_from_alert",
      actorKind: "system",
      payload: { source, title: sc.title },
      occurredAt: new Date(t0),
    });
    const steps: Step[] = [
      {
        key: "started",
        at: new Date(t0 + 20_000),
        kind: "read",
        text: { key: "atlas.j.startedAlert", params: { source } },
        title: `Started on the ${source} alert`,
        detail: "Premier passage : sévérité, périmètre, astreinte.",
        level: p.level,
        autonomous: true,
        cost: cost * 0.08,
        tokens: Math.round(tokens * 0.08),
      },
      {
        key: "checks",
        at: new Date(t0 + 2 * MIN),
        kind: "read",
        text: { key: "atlas.j.checks", params: { n: 6 } },
        title: "Ran 6 checks in parallel",
        detail: sc.finding,
        level: p.level,
        autonomous: true,
        cost: cost * 0.55,
        tokens: Math.round(tokens * 0.55),
      },
    ];
    const proposalAt = t0 + 3 * MIN;
    if (p.pattern === "approved" || p.pattern === "modified" || p.pattern === "rejected") {
      const waited = 6 + ((p.daysAgo * 5) % 30);
      const decidedAt = proposalAt + waited * MIN;
      const approver: Who = p.svc === "payments-worker" ? "NB" : p.grader;
      const ok = p.pattern !== "rejected";
      steps.push(
        {
          key: "proposal",
          at: new Date(proposalAt),
          kind: "system",
          actionKey: sc.action!,
          text: { key: "atlas.j.proposed", params: { what: sc.todo } },
          title: `Proposed: ${sc.todo}`,
          detail: `${sc.how} · réversible`,
          level: p.level,
          reversible: true,
          approval: ok ? "approved" : "rejected",
          requestedAt: new Date(proposalAt),
          approvedBy: ok ? approver : undefined,
          executedAt: ok ? new Date(decidedAt + MIN) : undefined,
          verifiedAt: ok && p.grade !== "miss" ? new Date(decidedAt + 8 * MIN) : undefined,
          cost: cost * 0.25,
          tokens: Math.round(tokens * 0.25),
          payload: {
            todo: sc.todo,
            done: sc.done,
            approvedAt: new Date(decidedAt).toISOString(),
            ...(p.pattern === "modified" ? { modified: true } : {}),
          },
        },
        {
          key: "decision",
          at: new Date(decidedAt),
          kind: "human",
          by: approver,
          text: {
            key: ok ? "atlas.j.approved" : "atlas.j.rejected",
            params: { member: ctx.member[approver].name, what: sc.todo },
          },
          title: `${ctx.member[approver].name} ${ok ? "approved" : "rejected"}: ${sc.todo}`,
          detail:
            p.pattern === "modified"
              ? "Approuvé avec une modification : la cible a été changée."
              : ok
                ? "Approuvé en un tap."
                : "Refusé : un autre correctif a été appliqué à la main.",
          level: p.level,
          cost: 0,
          tokens: 0,
        },
      );
      if (ok)
        steps.push({
          key: "verified",
          at: new Date(decidedAt + 8 * MIN),
          kind: "read",
          text: {
            key: p.grade === "miss" ? "atlas.j.notVerified" : "atlas.j.verified",
            params: {},
          },
          title: p.grade === "miss" ? "Recovery not verified" : "Verified recovery",
          detail: sc.verify,
          level: p.level,
          autonomous: true,
          cost: cost * 0.04,
          tokens: Math.round(tokens * 0.04),
        });
    } else if (p.pattern === "act_tell" || p.pattern === "alone") {
      const execAt = proposalAt + MIN;
      const verifiedAt = resolvedAt.getTime() - MIN;
      steps.push({
        key: "action",
        at: new Date(execAt),
        kind: "system",
        actionKey: sc.action!,
        text: undefined,
        title: sc.done,
        detail: `${sc.how} · ${p.level === 4 ? "seul, niveau 4" : "seul, niveau 3"}`,
        level: p.level,
        autonomous: true,
        reversible: true,
        approval: "none",
        executedAt: new Date(execAt),
        verifiedAt: new Date(verifiedAt),
        cost: cost * 0.25,
        tokens: Math.round(tokens * 0.25),
        payload: { todo: sc.todo, done: sc.done, challenger: "holds" },
      });
      if (p.pattern === "act_tell")
        steps.push({
          key: "paged",
          at: new Date(execAt),
          kind: "oi_write",
          text: { key: "atlas.j.paged", params: { member: ctx.member[told].name } },
          title: `Paged ${ctx.member[told].name}`,
          detail: "Le niveau 3 prévient une personne au moment où il agit.",
          level: p.level,
          autonomous: true,
          cost: 0,
          tokens: 0,
          payload: { memberId: ctx.member[told].id },
        });
      steps.push(
        {
          key: "verified",
          at: new Date(verifiedAt),
          kind: "read",
          text: { key: "atlas.j.verified", params: {} },
          title: "Verified recovery",
          detail: sc.verify,
          level: p.level,
          autonomous: true,
          cost: cost * 0.07,
          tokens: Math.round(tokens * 0.07),
        },
        {
          key: "resolved",
          at: resolvedAt,
          kind: "oi_write",
          text: { key: "atlas.j.resolved", params: { incident: `INC-${inc.number}` } },
          title: `Resolved INC-${inc.number} and wrote the summary`,
          detail:
            p.pattern === "alone" ? "Personne n'a été pagé." : `${ctx.member[told].name} prévenu.`,
          level: p.level,
          autonomous: true,
          reversible: true,
          cost: cost * 0.05,
          tokens: Math.round(tokens * 0.05),
          payload: { op: "resolve" },
        },
      );
      if (p.pattern === "act_tell") {
        await upsertEvent(tx, ctx, `${p.key}:ev:ack`, {
          incidentId: inc.id,
          kind: "escalation_acknowledged",
          actorKind: "member",
          actorMemberId: ctx.member[told].id,
          actorName: ctx.member[told].name,
          payload: { channel: "webpush", afterMinutes: 1 },
          occurredAt: new Date(execAt + MIN),
        });
      }
    }
    await writeJournal(tx, ctx, inc, p.svc, invId, steps);
    const resolver: Who = p.grader;
    await upsertEvent(tx, ctx, `${p.key}:ev:resolved`, {
      incidentId: inc.id,
      kind: "resolved",
      actorKind: atlasResolved ? "ai" : "member",
      actorMemberId: atlasResolved ? null : ctx.member[resolver].id,
      actorName: atlasResolved ? "Atlas" : ctx.member[resolver].name,
      payload: { durationMinutes: minutesToFix },
      occurredAt: resolvedAt,
    });
    await upsertEvent(tx, ctx, `${p.key}:ev:closed`, {
      incidentId: inc.id,
      kind: "closed",
      actorKind: "system",
      payload: {},
      occurredAt: closedAt,
    });
    if (!atlasResolved && ctx.leadRoleId)
      await tx
        .insert(roleAssignments)
        .values({
          tenantId: ctx.tenantId,
          incidentId: inc.id,
          roleId: ctx.leadRoleId,
          memberId: ctx.member[resolver].id,
          assignedAt: new Date(t0 + 4 * MIN),
        })
        .onConflictDoNothing();
  }
  return out;
}

/* ---------- The two recent resolutions, waiting for review ---------- */

async function seedRecent(tx: SeedTx, ctx: Ctx): Promise<void> {
  // Yesterday afternoon: web-storefront at L3 turned a flag off and told Thomas.
  {
    const key = "recent:storefront";
    const t0 = ctx.now - 20 * HOUR;
    const at = (m: number) => new Date(t0 + m * MIN);
    const inc = await ensureIncident(tx, ctx, key, {
      name: "Erreurs 503 sur la recherche après l'activation du flag search-v2",
      summary:
        "Les 503 de la recherche ont atteint 4 % après le passage du flag search-v2 à 100 %. Atlas a désactivé le flag et prévenu Thomas Moreau au même moment.",
      svc: "web-storefront",
      sev: "SEV3",
      phase: "closed",
      declaredAt: at(0),
      acknowledgedAt: at(4),
      resolvedAt: at(10),
      closedAt: at(10),
      source: "alert",
    });
    const invId = await upsertInvestigation(tx, ctx, {
      incidentId: inc.id,
      key,
      whatsGoingOn:
        "Résolu par Atlas. Les 503 de la recherche sont revenues sous 0,5 % 5 min après la désactivation du flag search-v2.",
      cause: "Le flag search-v2 est passé à 100 % à 16:05, deux minutes avant la hausse.",
      hypothesis: "Le nouveau moteur de recherche (flag search-v2) sature son pool de workers",
      why: "les 503 commencent deux minutes après le passage du flag à 100 %",
      finding: "Les 503 viennent toutes des requêtes routées vers search-v2.",
      nextSteps: ["Désactiver le flag search-v2 en production"],
      level: 3,
      grade: null,
      resolvedAlone: false,
      reviewState: "pending",
      cost: 1.1,
      tokens: 37_000,
      startedAt: at(0),
      completedAt: at(3),
    });
    await upsertEvent(tx, ctx, `${key}:ev:created`, {
      incidentId: inc.id,
      kind: "created_from_alert",
      actorKind: "system",
      payload: { source: "Sentry", title: "web-storefront 5xx above 2 %" },
      occurredAt: at(0),
    });
    await writeJournal(tx, ctx, inc, "web-storefront", invId, [
      {
        key: "matched",
        at: at(0.5),
        kind: "read",
        text: { key: "atlas.j.matchedChange", params: { change: "search-v2 → 100 %" } },
        title: "Matched the 503 spike to the search-v2 flag change",
        detail: "Changement de flag à 16:05, hausse des 503 à 16:07.",
        level: 3,
        autonomous: true,
        cost: 0.42,
        tokens: 14_000,
      },
      {
        key: "action",
        at: at(3),
        kind: "system",
        actionKey: "flag_off",
        title: "Flag search-v2 désactivé en production",
        detail: "Un flag, un environnement · seul, niveau 3",
        level: 3,
        autonomous: true,
        reversible: true,
        approval: "none",
        executedAt: at(3),
        verifiedAt: at(9),
        cost: 0.36,
        tokens: 12_000,
        payload: {
          todo: "Désactiver le flag search-v2 en production",
          done: "Flag search-v2 désactivé en production",
          challenger: "holds",
        },
      },
      {
        key: "paged",
        at: at(3),
        kind: "oi_write",
        text: { key: "atlas.j.paged", params: { member: ctx.member.TM.name } },
        title: `Paged ${ctx.member.TM.name}`,
        detail: "Le niveau 3 prévient une personne au moment où il agit.",
        level: 3,
        autonomous: true,
        cost: 0,
        tokens: 0,
        payload: { memberId: ctx.member.TM.id },
      },
      {
        key: "resolved",
        at: at(10),
        kind: "oi_write",
        text: { key: "atlas.j.resolvedAfter", params: { minutes: 5 } },
        title: "Resolved after 5 min under 0.5 % 503",
        detail: "Thomas Moreau a acquitté à la minute suivante et l'a laissé faire.",
        level: 3,
        autonomous: true,
        reversible: true,
        cost: 0.32,
        tokens: 11_000,
        payload: { op: "resolve" },
      },
    ]);
    await upsertEvent(tx, ctx, `${key}:ev:ack`, {
      incidentId: inc.id,
      kind: "escalation_acknowledged",
      actorKind: "member",
      actorMemberId: ctx.member.TM.id,
      actorName: ctx.member.TM.name,
      payload: { channel: "webpush", afterMinutes: 1 },
      occurredAt: at(4),
    });
    await upsertEvent(tx, ctx, `${key}:ev:resolved`, {
      incidentId: inc.id,
      kind: "resolved",
      actorKind: "ai",
      actorName: "Atlas",
      payload: { durationMinutes: 10 },
      occurredAt: at(10),
    });
    await upsertEvent(tx, ctx, `${key}:ev:closed`, {
      incidentId: inc.id,
      kind: "closed",
      actorKind: "system",
      payload: {},
      occurredAt: at(10),
    });
    await ensureAlert(tx, ctx, `${key}:alert`, {
      incidentId: inc.id,
      source: "Sentry",
      title: "web-storefront 5xx above 2 %",
      firstAt: at(0),
      resolvedAt: at(9),
      group: 2,
      svc: "web-storefront",
    });
  }
  // Last night: auth-service at L4 restarted three pods and resolved, nobody paged.
  {
    const key = "recent:auth";
    const t0 = ctx.now - 8 * HOUR;
    const at = (m: number) => new Date(t0 + m * MIN);
    const inc = await ensureIncident(tx, ctx, key, {
      name: "Erreurs de rafraîchissement de jeton après la rotation de certificat",
      summary:
        "Les appels de rafraîchissement ont échoué avec « invalid signature » pendant 7 minutes. Atlas a redémarré les 3 pods qui gardaient l'ancien jeu de clés. Personne n'a été pagé.",
      svc: "auth-service",
      sev: "SEV3",
      phase: "closed",
      declaredAt: at(0),
      acknowledgedAt: null,
      resolvedAt: at(7),
      closedAt: at(7),
      source: "alert",
    });
    const invId = await upsertInvestigation(tx, ctx, {
      incidentId: inc.id,
      key,
      whatsGoingOn:
        "Résolu par Atlas, personne n'a été pagé. Les erreurs de rafraîchissement sont à 0,0 % depuis la fin du redémarrage.",
      cause:
        "La rotation du certificat de signature a eu lieu 12 minutes avant la première erreur.",
      hypothesis: "Trois pods ont gardé l'ancien JWKS en cache après la rotation",
      why: "3 pods sur 6 répondent avec un kid de clé retiré",
      finding: "3 pods sur 6 servent encore l'ancien JWKS.",
      nextSteps: ["Redémarrer un à un les 3 pods qui servent l'ancien JWKS"],
      level: 4,
      grade: null,
      resolvedAlone: true,
      reviewState: "pending",
      cost: 0.62,
      tokens: 22_000,
      startedAt: at(0),
      completedAt: at(2),
    });
    await upsertEvent(tx, ctx, `${key}:ev:created`, {
      incidentId: inc.id,
      kind: "created_from_alert",
      actorKind: "system",
      payload: { source: "Datadog", title: "auth-service token refresh errors" },
      occurredAt: at(0),
    });
    await writeJournal(tx, ctx, inc, "auth-service", invId, [
      {
        key: "investigated",
        at: at(0.3),
        kind: "read",
        text: undefined,
        title: "Investigated: 3 of 6 pods still served the old JWKS",
        detail:
          "Datadog #5120983, logs auth-service (412 lignes), événement cert-manager de 02:00.",
        level: 4,
        autonomous: true,
        cost: 0.28,
        tokens: 10_000,
      },
      {
        key: "action",
        at: at(2),
        kind: "system",
        actionKey: "restart_pods",
        title: "3 pods redémarrés un à un",
        detail: "Un pod à la fois, contrôle de santé entre chaque · seul, niveau 4",
        level: 4,
        autonomous: true,
        reversible: true,
        approval: "none",
        executedAt: at(2),
        verifiedAt: at(5),
        cost: 0.18,
        tokens: 6_500,
        payload: {
          todo: "Redémarrer un à un les 3 pods qui servent l'ancien JWKS",
          done: "3 pods redémarrés un à un",
          challenger: "holds",
        },
      },
      {
        key: "verified",
        at: at(5),
        kind: "read",
        text: { key: "atlas.j.verified", params: {} },
        title: "Verified recovery",
        detail: "Erreurs de rafraîchissement à 0,0 % depuis 2 min.",
        level: 4,
        autonomous: true,
        cost: 0.06,
        tokens: 2_000,
      },
      {
        key: "resolved",
        at: at(7),
        kind: "oi_write",
        text: { key: "atlas.j.resolved", params: { incident: `INC-${inc.number}` } },
        title: `Resolved INC-${inc.number} and wrote the summary`,
        detail: "Personne n'a été pagé — vous êtes prévenus maintenant.",
        level: 4,
        autonomous: true,
        reversible: true,
        cost: 0.1,
        tokens: 3_500,
        payload: { op: "resolve" },
      },
    ]);
    await upsertEvent(tx, ctx, `${key}:ev:resolved`, {
      incidentId: inc.id,
      kind: "resolved",
      actorKind: "ai",
      actorName: "Atlas",
      payload: { durationMinutes: 7 },
      occurredAt: at(7),
    });
    await upsertEvent(tx, ctx, `${key}:ev:closed`, {
      incidentId: inc.id,
      kind: "closed",
      actorKind: "system",
      payload: {},
      occurredAt: at(7),
    });
    await ensureAlert(tx, ctx, `${key}:alert`, {
      incidentId: inc.id,
      source: "Datadog",
      title: "auth-service token refresh errors",
      firstAt: at(0),
      resolvedAt: at(6),
      group: 5,
      svc: "auth-service",
    });
  }
}

async function ensureAlert(
  tx: SeedTx,
  ctx: Ctx,
  key: string,
  a: {
    incidentId: string;
    source: string;
    title: string;
    firstAt: Date;
    resolvedAt: Date;
    group: number;
    svc: Svc;
  },
): Promise<void> {
  const sourceId = ctx.source[a.source];
  if (!sourceId) return;
  const id = sid(ctx.tenantId, key);
  const values = {
    id,
    tenantId: ctx.tenantId,
    sourceId,
    dedupKey: `atlas-demo-${id.slice(0, 8)}`,
    status: "resolved" as const,
    title: a.title,
    payload: { title: a.title, service: a.svc },
    attributes: { service: a.svc, env: "production", region: "eu-west-1" },
    groupCount: a.group,
    incidentId: a.incidentId,
    firstAt: a.firstAt,
    lastAt: a.resolvedAt,
    resolvedAt: a.resolvedAt,
    createdAt: a.firstAt,
  };
  await tx
    .insert(alerts)
    .values(values)
    .onConflictDoUpdate({
      target: alerts.id,
      set: {
        firstAt: values.firstAt,
        lastAt: values.lastAt,
        resolvedAt: values.resolvedAt,
        createdAt: values.createdAt,
      },
    });
}

/* ---------- The open incidents ---------- */

async function seedOpen(tx: SeedTx, ctx: Ctx): Promise<void> {
  const open = await tx
    .select({ id: incidents.id, number: incidents.number, declaredAt: incidents.declaredAt })
    .from(incidents)
    .where(and(eq(incidents.tenantId, ctx.tenantId), inArray(incidents.number, [218, 219, 220])));
  const by = (n: number) => open.find((o: { number: number }) => o.number === n);

  // INC-218 · checkout-api at L2: the fix is prepared, a person approves.
  const i218 = by(218);
  if (i218) {
    const key = "open:218";
    const t0 = i218.declaredAt.getTime();
    const at = (m: number) => new Date(t0 + m * MIN);
    const todo = "Désactiver le flag checkout.new-address-form en production";
    const invId = await upsertInvestigation(tx, ctx, {
      incidentId: i218.id,
      key,
      whatsGoingOn:
        "Des TypeError à la confirmation de commande depuis l'élargissement du flag checkout.new-address-form à 25 %.",
      cause: "Le flag checkout.new-address-form est passé à 25 % à 11:20.",
      hypothesis: "Le nouveau formulaire d'adresse envoie un champ nul à la confirmation",
      why: "les TypeError ne touchent que les sessions qui ont le flag",
      finding: "Toutes les TypeError viennent de sessions exposées au flag.",
      nextSteps: [todo],
      level: 2,
      grade: null,
      cost: 0.71,
      tokens: 24_000,
      startedAt: at(0.3),
      completedAt: at(3),
    });
    await writeJournal(tx, ctx, { id: i218.id, key }, "checkout-api", invId, [
      {
        key: "started",
        at: at(0.3),
        kind: "read",
        text: { key: "atlas.j.startedAlert", params: { source: "Sentry" } },
        title: "Started on the Sentry alert",
        detail: "Premier passage : SEV3 probable, checkout, Platform d'astreinte.",
        level: 2,
        autonomous: true,
        cost: 0.06,
        tokens: 2_000,
      },
      {
        key: "checks",
        at: at(1),
        kind: "read",
        text: { key: "atlas.j.checks", params: { n: 6 } },
        title: "Ran 6 checks in parallel",
        detail:
          "Changements récents (flag checkout.new-address-form → 25 %), incidents similaires, traces.",
        level: 2,
        autonomous: true,
        cost: 0.45,
        tokens: 15_000,
      },
      {
        key: "proposal",
        at: at(3),
        kind: "system",
        actionKey: "flag_off",
        text: { key: "atlas.j.proposed", params: { what: todo } },
        title: `Proposed: ${todo}`,
        detail:
          "Depuis les actions autorisées · réversible · checkout-api est au niveau 2, une personne approuve.",
        level: 2,
        reversible: true,
        approval: "waiting",
        requestedAt: at(3),
        cost: 0.2,
        tokens: 7_000,
        payload: {
          todo,
          done: "Flag checkout.new-address-form désactivé en production",
          target: "checkout.new-address-form",
          why: "level",
          challenger: "holds",
        },
      },
    ]);
  }

  // INC-219 · auth-service at L4, but the fix was never used on this service.
  const i219 = by(219);
  if (i219) {
    const key = "open:219";
    const t0 = i219.declaredAt.getTime();
    const at = (m: number) => new Date(t0 + m * MIN);
    const todo = "Recharger les clés de signature sur les pods auth-service";
    const invId = await upsertInvestigation(tx, ctx, {
      incidentId: i219.id,
      key,
      whatsGoingOn:
        "Le taux d'erreur d'auth-service est à 4,2 % sur 5 min, concentré sur la validation des jetons.",
      cause:
        "Les erreurs sont des « invalid signature » sur des jetons signés par la nouvelle clé.",
      hypothesis: "Une partie des pods n'a pas chargé la nouvelle clé de signature",
      why: "les erreurs viennent de 2 pods sur 6",
      finding: "Les « invalid signature » viennent de 2 pods sur 6.",
      nextSteps: [todo],
      level: 4,
      grade: null,
      cost: 0.58,
      tokens: 19_000,
      startedAt: at(0.3),
      completedAt: at(2),
    });
    await writeJournal(tx, ctx, { id: i219.id, key }, "auth-service", invId, [
      {
        key: "started",
        at: at(0.3),
        kind: "read",
        text: { key: "atlas.j.startedAlert", params: { source: "Datadog" } },
        title: "Started on the Datadog alert",
        detail: "Premier passage : 3 alertes groupées, auth-service, Platform d'astreinte.",
        level: 4,
        autonomous: true,
        cost: 0.06,
        tokens: 2_000,
      },
      {
        key: "checks",
        at: at(1),
        kind: "read",
        text: { key: "atlas.j.checks", params: { n: 6 } },
        title: "Ran 6 checks in parallel",
        detail: "Logs auth-service, métriques par pod, changements récents, runbook des clés.",
        level: 4,
        autonomous: true,
        cost: 0.38,
        tokens: 12_500,
      },
      {
        key: "proposal",
        at: at(2),
        kind: "system",
        actionKey: "reload_keys",
        text: { key: "atlas.j.proposed", params: { what: todo } },
        title: `Proposed: ${todo}`,
        detail:
          "auth-service est au niveau 4, mais cette action n'a jamais servi sur ce service : une personne est consultée d'abord.",
        level: 4,
        reversible: true,
        approval: "waiting",
        requestedAt: at(2),
        cost: 0.14,
        tokens: 4_500,
        payload: {
          todo,
          done: "Clés de signature rechargées sur les pods auth-service",
          why: "guardrail",
          guardrail: "firstUseOnService",
          challenger: "holds",
        },
      },
    ]);
  }

  // INC-220 · payments-worker at L1 (capped at L2): it investigates, people act.
  const i220 = by(220);
  if (i220) {
    const key = "open:220";
    const t0 = i220.declaredAt.getTime();
    const at = (m: number) => new Date(t0 + m * MIN);
    const invId = await upsertInvestigation(tx, ctx, {
      incidentId: i220.id,
      key,
      whatsGoingOn:
        "Les webhooks de paiement partent avec plus de 5 minutes de retard ; la file de payments-worker dépasse 10 000 messages.",
      cause: "La consommation de la file est stable alors que le débit entrant a doublé.",
      hypothesis: "Les consommateurs de payments-worker ne suivent plus le débit entrant",
      why: "la file croît linéairement depuis 11:20",
      finding: "La profondeur de file dépasse 10 000 messages et croît.",
      nextSteps: ["Augmenter le nombre de consommateurs de payments-worker"],
      level: 1,
      grade: null,
      cost: 0.66,
      tokens: 22_000,
      startedAt: at(0.3),
      completedAt: at(3),
    });
    await writeJournal(tx, ctx, { id: i220.id, key }, "payments-worker", invId, [
      {
        key: "started",
        at: at(0.3),
        kind: "read",
        text: { key: "atlas.j.startedAlert", params: { source: "Grafana" } },
        title: "Started on the Grafana alert",
        detail: "Premier passage : SEV2 probable, payments-worker, Payments d'astreinte.",
        level: 1,
        autonomous: true,
        cost: 0.06,
        tokens: 2_000,
      },
      {
        key: "checks",
        at: at(1),
        kind: "read",
        text: { key: "atlas.j.checks", params: { n: 6 } },
        title: "Ran 6 checks in parallel",
        detail: "Profondeur de file, débit entrant, changements récents, incidents similaires.",
        level: 1,
        autonomous: true,
        cost: 0.48,
        tokens: 16_000,
      },
      {
        key: "draft",
        at: at(4),
        kind: "oi_write",
        text: { key: "atlas.j.draftedUpdate", params: {} },
        title: "Posted the first update draft",
        detail: "Brouillon · Atlas, en attente d'une personne pour publier.",
        level: 1,
        cost: 0.12,
        tokens: 4_000,
        payload: { draft: true },
      },
    ]);
  }
}

/* ---------- The ladder ---------- */

async function seedLadder(tx: SeedTx, ctx: Ctx): Promise<void> {
  const E = (
    key: string,
    svc: Svc,
    from: number,
    to: number,
    cause: "promotion" | "grade" | "cap",
    at: Date,
    by: Who | null,
    note: string,
  ) => ({
    id: sid(ctx.tenantId, `ladder:${key}`),
    tenantId: ctx.tenantId,
    serviceId: ctx.service[svc],
    fromLevel: from,
    toLevel: to,
    cause,
    byMemberId: by ? ctx.member[by].id : null,
    note,
    createdAt: at,
  });
  const d = (iso: string) => new Date(iso);
  const rows = [
    E(
      "auth-1",
      "auth-service",
      0,
      1,
      "promotion",
      d("2026-06-01T12:00:00Z"),
      null,
      "5 incidents seen",
    ),
    E(
      "auth-2",
      "auth-service",
      1,
      2,
      "promotion",
      d("2026-07-26T09:00:00Z"),
      null,
      "10 graded runs · 80 % right",
    ),
    E(
      "auth-3",
      "auth-service",
      2,
      3,
      "promotion",
      ago(ctx, 38, 9),
      null,
      "22 graded runs · 91 % right · 12 proposals approved unchanged",
    ),
    E(
      "auth-4",
      "auth-service",
      3,
      4,
      "promotion",
      ago(ctx, 16, 9),
      null,
      "40 graded runs · 95 % right · 18 level-3 fixes never undone",
    ),
    E(
      "web-1",
      "web-storefront",
      0,
      1,
      "promotion",
      d("2026-06-22T09:00:00Z"),
      null,
      "5 incidents seen",
    ),
    E(
      "web-2",
      "web-storefront",
      1,
      2,
      "promotion",
      d("2026-08-05T09:00:00Z"),
      null,
      "10 graded runs · 80 % right",
    ),
    E(
      "web-3",
      "web-storefront",
      2,
      3,
      "promotion",
      ago(ctx, 32, 9),
      null,
      "20 graded runs · 90 % right · 9 proposals approved unchanged",
    ),
    E(
      "checkout-1",
      "checkout-api",
      0,
      1,
      "promotion",
      d("2026-06-22T09:30:00Z"),
      null,
      "5 incidents seen",
    ),
    E(
      "checkout-2",
      "checkout-api",
      1,
      2,
      "promotion",
      d("2026-08-23T09:00:00Z"),
      null,
      "10 graded runs · 90 % right",
    ),
    E(
      "payments-1",
      "payments-worker",
      0,
      1,
      "promotion",
      d("2026-06-23T09:00:00Z"),
      null,
      "5 incidents seen",
    ),
    E(
      "payments-2",
      "payments-worker",
      1,
      2,
      "promotion",
      d("2026-07-27T09:00:00Z"),
      null,
      "15 graded runs · 80 % right",
    ),
    E("payments-3", "payments-worker", 2, 1, "grade", ago(ctx, 6, 16, 2), "NB", "graded Miss"),
    E(
      "payments-cap",
      "payments-worker",
      1,
      1,
      "cap",
      ago(ctx, 5, 7, 10),
      "AL",
      "capped at level 2",
    ),
  ];
  for (const r of rows)
    await tx
      .insert(autonomyEvents)
      .values(r)
      .onConflictDoUpdate({
        target: autonomyEvents.id,
        set: { createdAt: r.createdAt, note: r.note },
      });
  const levels: Record<Svc, { level: number; cap: number | null; changed: Date; reason: string }> =
    {
      "auth-service": { level: 4, cap: null, changed: ago(ctx, 16, 9), reason: "promotion" },
      "web-storefront": { level: 3, cap: null, changed: ago(ctx, 32, 9), reason: "promotion" },
      "checkout-api": {
        level: 2,
        cap: null,
        changed: d("2026-08-23T09:00:00Z"),
        reason: "promotion",
      },
      "payments-worker": { level: 1, cap: 2, changed: ago(ctx, 6, 16, 2), reason: "grade" },
    };
  for (const [svc, l] of Object.entries(levels) as Array<[Svc, (typeof levels)[Svc]]>) {
    await tx
      .insert(serviceAutonomy)
      .values({
        tenantId: ctx.tenantId,
        serviceId: ctx.service[svc],
        level: l.level as 0 | 1 | 2 | 3 | 4,
        cap: l.cap as 0 | 1 | 2 | 3 | 4 | null,
        changedAt: l.changed,
        reason: l.reason,
      })
      .onConflictDoUpdate({
        target: serviceAutonomy.serviceId,
        set: {
          level: l.level as 0 | 1 | 2 | 3 | 4,
          cap: l.cap as 0 | 1 | 2 | 3 | 4 | null,
          changedAt: l.changed,
          reason: l.reason,
        },
      });
  }
}

async function seedBacktest(tx: SeedTx, ctx: Ctx): Promise<void> {
  const perService = {
    [ctx.service["auth-service"]]: { incidents: 15, right: 14 },
    [ctx.service["web-storefront"]]: { incidents: 18, right: 16 },
    [ctx.service["checkout-api"]]: { incidents: 16, right: 14 },
    [ctx.service["payments-worker"]]: { incidents: 12, right: 9 },
  };
  const id = sid(ctx.tenantId, "backtest:latest");
  const runAt = ago(ctx, 3, 2, 10);
  const values = {
    id,
    tenantId: ctx.tenantId,
    serviceId: null,
    status: "completed" as const,
    windowDays: 90,
    incidents: 61,
    grades: { bullseye: 34, on_target: 19, miss: 6, nowhere_near: 2 },
    costEur: 14.2,
    runAt,
    completedAt: new Date(runAt.getTime() + 22 * MIN),
    stats: { replayed: 61, resolvedAlone: 23, medianMinutesSooner: 41, perService, done: 61 },
  };
  await tx
    .insert(backtests)
    .values(values)
    .onConflictDoUpdate({
      target: backtests.id,
      set: { runAt: values.runAt, completedAt: values.completedAt, stats: values.stats },
    });
}

async function seedAudit(tx: SeedTx, ctx: Ctx, era: Created[]): Promise<void> {
  void era;
  const [recentAuth] = await tx
    .select({ number: incidents.number, resolvedAt: incidents.resolvedAt })
    .from(incidents)
    .where(eq(incidents.id, sid(ctx.tenantId, "recent:auth:incident")));
  const [recentWeb] = await tx
    .select({ number: incidents.number })
    .from(incidents)
    .where(eq(incidents.id, sid(ctx.tenantId, "recent:storefront:incident")));
  const A = (
    key: string,
    at: Date,
    actor: Who | null,
    action: string,
    target: Record<string, unknown>,
  ) => ({
    id: sid(ctx.tenantId, `audit:${key}`),
    tenantId: ctx.tenantId,
    actorMemberId: actor ? ctx.member[actor].id : null,
    actorName: actor ? ctx.member[actor].name : "Atlas",
    category: "config" as const,
    action,
    target,
    createdAt: at,
  });
  const rows = [
    A("auth-l4", ago(ctx, 16, 9), null, "atlas.level_changed", {
      service: "auth-service",
      from: 3,
      to: 4,
      cause: "promotion",
    }),
    A("payments-miss", ago(ctx, 6, 16, 2), null, "atlas.level_changed", {
      service: "payments-worker",
      from: 2,
      to: 1,
      cause: "grade",
      grade: "miss",
      by: ctx.member.NB.name,
    }),
    A("payments-cap", ago(ctx, 5, 7, 10), "AL", "atlas.capped", {
      service: "payments-worker",
      cap: 2,
    }),
  ];
  if (recentWeb)
    rows.push(
      A("recent-web", new Date(ctx.now - 20 * HOUR + 3 * MIN), null, "atlas.acted", {
        incident: recentWeb.number,
        service: "web-storefront",
        level: 3,
        action: "Flag search-v2 désactivé en production",
        paged: ctx.member.TM.name,
      }),
    );
  if (recentAuth)
    rows.push(
      A("recent-auth-act", new Date(ctx.now - 8 * HOUR + 2 * MIN), null, "atlas.acted", {
        incident: recentAuth.number,
        service: "auth-service",
        level: 4,
        action: "3 pods redémarrés un à un",
        paged: null,
      }),
      A("recent-auth-resolved", new Date(ctx.now - 8 * HOUR + 7 * MIN), null, "atlas.resolved", {
        incident: recentAuth.number,
        service: "auth-service",
        level: 4,
        alone: true,
        undoUntil: new Date(ctx.now - 8 * HOUR + 7 * MIN + DAY).toISOString(),
      }),
    );
  for (const r of rows)
    await tx
      .insert(auditEvents)
      .values(r)
      .onConflictDoUpdate({
        target: auditEvents.id,
        set: { createdAt: r.createdAt, target: r.target },
      });
}

/**
 * The counters of every service, from the rows — the same definitions as the
 * engine's `recomputeServiceAutonomy` (packages/investigations).
 */
async function recompute(tx: SeedTx, ctx: Ctx): Promise<void> {
  const [bt] = await tx
    .select({ stats: backtests.stats })
    .from(backtests)
    .where(and(eq(backtests.tenantId, ctx.tenantId), eq(backtests.status, "completed")))
    .orderBy(sql`${backtests.completedAt} desc`)
    .limit(1);
  for (const serviceId of Object.values(ctx.service)) {
    const [c] = await tx
      .execute(
        sql`
      select
        count(*) filter (where i.mode = 'live')::int as seen,
        count(v.grade)::int as graded,
        count(*) filter (where v.grade in ('bullseye', 'on_target'))::int as right_n,
        max(v.graded_at) filter (where v.grade in ('miss', 'nowhere_near')) as last_miss
      from app.investigations v
      join app.incidents i on i.id = v.incident_id
      where v.tenant_id = ${ctx.tenantId} and i.service_id = ${serviceId}
    `,
      )
      .then((r: { rows?: unknown[] } | unknown[]) => (Array.isArray(r) ? r : (r.rows ?? [])));
    const [a] = await tx
      .execute(
        sql`
      select
        count(*) filter (where kind = 'system' and approval_state = 'approved'
          and coalesce((payload->>'modified')::boolean, false) = false)::int as proposals_ok,
        count(*) filter (where kind = 'system' and autonomous and level = 3
          and executed_at is not null and undone_at is null
          and executed_at < now() - interval '24 hours')::int as l3_ok
      from app.atlas_actions
      where tenant_id = ${ctx.tenantId} and service_id = ${serviceId}
    `,
      )
      .then((r: { rows?: unknown[] } | unknown[]) => (Array.isArray(r) ? r : (r.rows ?? [])));
    const cr = c as {
      seen: number;
      graded: number;
      right_n: number;
      last_miss: Date | string | null;
    };
    const ar = a as { proposals_ok: number; l3_ok: number };
    const per = (bt?.stats as { perService?: Record<string, { incidents: number; right: number }> })
      ?.perService?.[serviceId];
    await tx
      .update(serviceAutonomy)
      .set({
        incidentsSeen: cr.seen,
        gradedRuns: cr.graded,
        rightPct: cr.graded ? Math.round((cr.right_n / cr.graded) * 1000) / 10 : null,
        lastMissAt: cr.last_miss ? new Date(cr.last_miss) : null,
        proposalsOk: ar.proposals_ok,
        l3FixesOk: ar.l3_ok,
        backtestPct:
          per && per.incidents ? Math.round((per.right / per.incidents) * 1000) / 10 : null,
        updatedAt: new Date(),
      })
      .where(eq(serviceAutonomy.serviceId, serviceId));
  }
}
