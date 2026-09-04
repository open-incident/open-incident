/**
 * "demo" seed — the FROZEN demonstration data set + the install defaults.
 *
 * Workspace "Skylark Systems" (slug skylark, accent #B4552D, French, Europe/Paris),
 * reference incident INC-217 "Checkout latency spike in eu-west-1" — SEV2,
 * resolved, full timeline, post-mortem in review, three follow-ups. Every
 * screenshot in the documentation and every mockup is built on it.
 *
 * Replayable: the workspace is found or created, and INC-217 is recreated when
 * it is missing — even on a database seeded before. Usage: pnpm db:seed.
 */
import { and, eq, sql } from "drizzle-orm";
import { adminClient, provisionWorkspace } from "../provision";
import {
  aiCalls,
  aiSettings,
  alertEvents,
  alertPriorities,
  changeEvents,
  heartbeats,
  payRules,
  componentImpactHistory,
  statusPageComponents,
  statusPageIncidentUpdates,
  statusPageIncidents,
  statusPageMaintenanceUpdates,
  statusPageMaintenances,
  statusPageSubscribers,
  statusPageTemplates,
  statusPages,
  alertRoutes,
  alertSources,
  alerts,
  announcementRules,
  announcementTemplates,
  announcements,
  apiKeys,
  auditEvents,
  escalationEvents,
  escalationPathVersions,
  escalationPaths,
  escalations,
  notificationDeliveries,
  notificationMethods,
  notificationRules,
  rotations,
  scheduleOverrides,
  schedules,
  workingHoursSets,
  catalogEntries,
  catalogTypes,
  debriefs,
  followUpPriorities,
  followUps,
  incidentEvents,
  incidentFields,
  incidentParticipants,
  incidentRoles,
  incidentStatuses,
  incidentTypes,
  incidentUpdates,
  incidents,
  members,
  postIncidentTasks,
  postMortems,
  roleAssignments,
  severities,
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
} from "../schema/app";
import { DEMO_INVITED, DEMO_MEMBERS, DEMO_SLUG } from "./demo-data";
import { createHash, randomBytes } from "node:crypto";
import { registerApiKeyLookup, upsertStatusSnapshot } from "../directory";
import { encryptSecret } from "@openincident/crypto";
import { apiKeyLookup } from "../schema/directory";
import { installDemoHistory } from "./history";

type Tx = Parameters<Parameters<ReturnType<typeof adminClient>["db"]["transaction"]>[0]>[0];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A Paris wall-clock moment of August 2026 (CEST = UTC+2). */
function paris(day: string, time: string): Date {
  return new Date(`2026-${day}T${time}:00+02:00`);
}

/** Today at a Paris wall-clock time — yesterday if that moment has not come yet. */
function todayAt(time: string): Date {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const [h, m] = time.split(":").map(Number);
  const candidate = new Date(
    now.getTime() + ((h! - local.getHours()) * 60 + (m! - local.getMinutes())) * MIN,
  );
  candidate.setSeconds(0, 0);
  return candidate.getTime() > now.getTime() ? new Date(candidate.getTime() - DAY) : candidate;
}

/** The demo is "skylark"; SEED_SLUG seeds the same data under another slug (the smoke suite's throwaway workspace). */
const SLUG = process.env.SEED_SLUG ?? DEMO_SLUG;
const IS_DEMO = SLUG === DEMO_SLUG;

const result = await provisionWorkspace({
  slug: SLUG,
  name: "Skylark Systems",
  locale: "fr",
  timezone: "Europe/Paris",
  accentColor: "#B4552D",
  owner: { email: DEMO_MEMBERS[0].email, name: DEMO_MEMBERS[0].name, status: "active" },
});
const tenantId = result.tenantId;

const { db, end } = adminClient();
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await ensureMembers(tx);
    const ctx = await loadContext(tx);
    await ensureTypes(tx, ctx);
    await ensureCatalog(tx, ctx);
    await ensureFields(tx, ctx);
    await ensureIncidents(tx, ctx);
    await ensureAudit(tx, ctx);
    await ensureAnnouncements(tx, ctx);
    await ensureApiAndWebhooks(tx, ctx);
    await ensureOnCall(tx, ctx);
    await ensureHeartbeats(tx, ctx);
    await ensurePayRules(tx);
    await ensureStatusPage(tx, ctx);
    await ensureAiAndChanges(tx, ctx);
    await installDemoHistory(tx, tenantId, ctx);
  });
  console.log(`Demo workspace "${SLUG}" ready — INC-217 and its history are in place.`);
} finally {
  await end();
}
process.exit(0);

/* ------------------------------------------------------------------------ */

type Ctx = {
  memberId: (name: string) => string;
  sevId: Record<string, string>;
  typeId: Record<string, string>;
  statusId: Record<string, string>;
  roleLead: string;
  roleComms: string;
  prioId: Record<string, string>;
  catType: Record<string, string>;
  entryId: Record<string, string>;
};

async function ensureMembers(tx: Tx) {
  for (const m of DEMO_MEMBERS) {
    await tx
      .insert(members)
      .values({ tenantId, email: m.email, name: m.name, role: m.role, status: "active" })
      .onConflictDoNothing();
  }
  await tx
    .insert(members)
    .values({
      tenantId,
      email: DEMO_INVITED.email,
      name: DEMO_INVITED.name,
      role: DEMO_INVITED.role,
      status: "invited",
    })
    .onConflictDoNothing();
  // The workspace speaks French; the design was drawn in it.
  await tx.update(workspaces).set({ locale: "fr" }).where(eq(workspaces.tenantId, tenantId));
}

async function loadContext(tx: Tx): Promise<Ctx> {
  const memberRows = await tx.select().from(members).where(eq(members.tenantId, tenantId));
  const sevRows = await tx.select().from(severities).where(eq(severities.tenantId, tenantId));
  const typeRows = await tx
    .select()
    .from(incidentTypes)
    .where(eq(incidentTypes.tenantId, tenantId));
  const roleRows = await tx
    .select()
    .from(incidentRoles)
    .where(eq(incidentRoles.tenantId, tenantId));
  const prioRows = await tx
    .select()
    .from(followUpPriorities)
    .where(eq(followUpPriorities.tenantId, tenantId));
  const catRows = await tx.select().from(catalogTypes).where(eq(catalogTypes.tenantId, tenantId));
  const defaultType = typeRows.find((t) => t.isDefault)!;
  const statusRows = await tx
    .select()
    .from(incidentStatuses)
    .where(
      and(eq(incidentStatuses.tenantId, tenantId), eq(incidentStatuses.typeId, defaultType.id)),
    );
  const byRank = (rank: number) => statusRows.find((s) => s.rank === rank)!.id;
  return {
    memberId: (name) => {
      const row = memberRows.find((m) => m.name === name);
      if (!row) throw new Error(`demo member missing: ${name}`);
      return row.id;
    },
    sevId: Object.fromEntries(sevRows.map((s) => [s.name, s.id])),
    typeId: { default: defaultType.id },
    statusId: { investigating: byRank(0), fixing: byRank(1), monitoring: byRank(2) },
    roleLead: roleRows.find((r) => r.isLead)!.id,
    roleComms: roleRows.find((r) => !r.isLead)!.id,
    prioId: Object.fromEntries(prioRows.map((p) => [p.name, p.id])),
    catType: Object.fromEntries(catRows.map((c) => [c.key, c.id])),
    entryId: {},
  };
}

/** The two Skylark-specific types of the design: Security (restricted, private) and Data. */
async function ensureTypes(tx: Tx, ctx: Ctx) {
  const specs = [
    {
      key: "security",
      name: "Sécurité",
      description:
        "Visibilité réduite — privé par défaut, déclarable par la seule équipe Sécurité.",
      privateByDefault: true,
      postIncidentFromRank: -1,
      position: 1,
      statuses: [
        [
          "Investigation",
          "Qualification de l'alerte — étendue et vecteur encore inconnus.",
          15,
          null,
        ],
        ["Confinement", "La propagation est stoppée — accès coupés, secrets révoqués.", 30, null],
        [
          "Remédiation",
          "Retour à un état sain vérifié — correctifs et rotation des accès.",
          60,
          null,
        ],
      ],
      declareForm: [
        { key: "title", required: true },
        { key: "severity", required: true },
        { key: "suspected_vector", required: true },
        { key: "runbook_url", required: false },
      ],
    },
    {
      key: "data",
      name: "Données",
      description: "Incidents de qualité ou de perte de données — post-mortem dédié.",
      privateByDefault: false,
      postIncidentFromRank: 2,
      position: 2,
      statuses: [
        [
          "Investigation",
          "On borne le périmètre — quelles tables, quelles périodes, quels clients.",
          30,
          "investigating",
        ],
        [
          "Correction",
          "Le pipeline fautif est corrigé — re-traitement en cours.",
          60,
          "identified",
        ],
        [
          "Vérification",
          "Contrôles d'intégrité sur les données réparées avant résolution.",
          60,
          "monitoring",
        ],
      ],
      declareForm: [
        { key: "title", required: true },
        { key: "severity", required: true },
        { key: "service", required: true },
        { key: "data_scope", required: true },
      ],
    },
  ] as const;

  for (const spec of specs) {
    const [inserted] = await tx
      .insert(incidentTypes)
      .values({
        tenantId,
        name: spec.name,
        description: spec.description,
        privateByDefault: spec.privateByDefault,
        postIncidentFromRank: spec.postIncidentFromRank,
        position: spec.position,
        declareForm: [...spec.declareForm],
      })
      .onConflictDoNothing()
      .returning({ id: incidentTypes.id });
    const id =
      inserted?.id ??
      (
        await tx
          .select({ id: incidentTypes.id })
          .from(incidentTypes)
          .where(and(eq(incidentTypes.tenantId, tenantId), eq(incidentTypes.name, spec.name)))
      )[0]!.id;
    ctx.typeId[spec.key] = id;
    if (inserted) {
      await tx.insert(incidentStatuses).values(
        spec.statuses.map(([name, description, reminder, pub], rank) => ({
          tenantId,
          typeId: id,
          name,
          description,
          rank,
          updateReminderMinutes: reminder,
          publicStatus: pub,
          countsInMttr: !(spec.key === "data" && rank === 2),
        })),
      );
    }
  }
  // The default type, in the design: 58 incidents, "Défaut". Its declare form
  // gains the two custom fields the workspace added.
  await tx
    .update(incidentTypes)
    .set({
      declareForm: [
        { key: "title", required: true },
        { key: "severity", required: true },
        { key: "service", required: true },
        { key: "summary", required: false },
        { key: "region", required: true },
        { key: "customer_impact", required: false },
      ],
    })
    .where(eq(incidentTypes.id, ctx.typeId.default!));
}

async function ensureCatalog(tx: Tx, ctx: Ctx) {
  const upsert = async (
    typeKey: string,
    name: string,
    description: string,
    externalId: string | null,
    attributes: Record<string, unknown>,
  ) => {
    const typeId = ctx.catType[typeKey]!;
    const [row] = await tx
      .insert(catalogEntries)
      .values({ tenantId, typeId, name, description, externalId, attributes })
      .onConflictDoUpdate({
        target: [catalogEntries.typeId, catalogEntries.name],
        set: { description, attributes, updatedAt: new Date() },
      })
      .returning({ id: catalogEntries.id });
    ctx.entryId[name] = row!.id;
  };
  const m = ctx.memberId;
  await upsert("team", "Platform", "Infrastructure, API et données", "team_platform", {
    members: [
      m("Amélie Laurent"),
      m("Karim Haddad"),
      m("Thomas Moreau"),
      m("Nadia Benali"),
      m("Lucas Girard"),
    ],
    escalation_path: "Platform primary",
    chat_channel: "#team-platform",
  });
  await upsert("team", "Payments", "Chaîne de paiement et conformité", "team_payments", {
    members: [m("Nadia Benali"), m("Lucas Girard"), m("Karim Haddad"), m("Claire Dubois")],
    escalation_path: "Payments escalation",
    chat_channel: "#team-payments",
  });
  await upsert("team", "Storefront", "Expérience boutique et checkout front", "team_storefront", {
    members: [m("Thomas Moreau"), m("Claire Dubois"), m("Amélie Laurent")],
    escalation_path: "Platform primary",
    chat_channel: "#team-storefront",
  });
  await upsert(
    "service",
    "checkout-api",
    "API de commande et de paiement côté serveur",
    "svc_chk_01",
    {
      owner: ctx.entryId.Platform,
      repository: "skylark/checkout-api",
      tier: "tier 1",
      environments: "production, staging",
    },
  );
  await upsert(
    "service",
    "payments-worker",
    "Traitement asynchrone des paiements et webhooks",
    "svc_pay_01",
    {
      owner: ctx.entryId.Payments,
      repository: "skylark/payments",
      tier: "tier 1",
      environments: "production, staging",
    },
  );
  await upsert("service", "web-storefront", "Front boutique — SSR et edge", "svc_sf_01", {
    owner: ctx.entryId.Storefront,
    repository: "skylark/storefront",
    tier: "tier 2",
    environments: "production",
  });
  await upsert("service", "auth-service", "Authentification, SSO et sessions", "svc_auth_01", {
    owner: ctx.entryId.Platform,
    repository: "skylark/auth",
    tier: "tier 1",
    environments: "production, staging",
  });
  await upsert("environment", "production", "Trafic client réel — bipe", "env_prod", {
    paging: "pages",
  });
  await upsert("environment", "staging", "Pré-production — silencieux", "env_staging", {
    paging: "silent",
  });
}

async function ensureFields(tx: Tx, ctx: Ctx) {
  const fields = [
    {
      key: "region",
      label: "region",
      type: "select",
      options: ["eu-west-1", "us-east-1"],
      description: "Région cloud concernée",
      incidentTypeId: ctx.typeId.default!,
      position: 0,
    },
    {
      key: "customer_impact",
      label: "customer_impact",
      type: "number",
      options: [],
      description: "Clients affectés estimés",
      incidentTypeId: ctx.typeId.default!,
      position: 1,
    },
    {
      key: "runbook_url",
      label: "runbook_url",
      type: "link",
      options: [],
      description: "Affiché aux porteurs de rôle",
      incidentTypeId: ctx.typeId.security!,
      position: 2,
    },
    {
      key: "suspected_vector",
      label: "Vecteur suspecté",
      type: "select",
      options: ["phishing", "secret exposé", "dépendance compromise", "accès interne"],
      description: null,
      incidentTypeId: ctx.typeId.security!,
      position: 3,
    },
    {
      key: "data_scope",
      label: "Périmètre de données",
      type: "long_text",
      options: [],
      description: "Tables, période, volumétrie",
      incidentTypeId: ctx.typeId.data!,
      position: 4,
    },
  ] as const;
  for (const f of fields) {
    await tx
      .insert(incidentFields)
      .values({
        tenantId,
        key: f.key,
        label: f.label,
        type: f.type,
        options: [...f.options],
        description: f.description,
        incidentTypeId: f.incidentTypeId,
        position: f.position,
      })
      .onConflictDoNothing();
  }
}

type Ev = {
  at: Date;
  kind: Parameters<
    typeof incidentEvents.$inferInsert.kind extends infer K ? (k: K) => void : never
  >[0];
  actor?: string;
  actorKind?: "member" | "system" | "api" | "ai";
  payload?: Record<string, unknown>;
  pinned?: boolean;
};

type Inc = {
  number: number;
  name: string;
  summary?: string;
  type?: string;
  sev: string | null;
  phase: "triage" | "active" | "post_incident" | "closed";
  status?: "investigating" | "fixing" | "monitoring";
  service: string;
  lead?: string;
  comms?: string;
  source: "web" | "alert" | "api";
  mode?: "live" | "retrospective" | "test";
  visibility?: "public" | "private";
  declaredAt: Date;
  acceptedAt?: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  lastActivityAt?: Date;
  customFields?: Record<string, unknown>;
  participants?: string[];
  observers?: string[];
  events: Ev[];
};

async function ensureIncidents(tx: Tx, ctx: Ctx) {
  const AL = "Amélie Laurent",
    KH = "Karim Haddad",
    NB = "Nadia Benali",
    LG = "Lucas Girard",
    TM = "Thomas Moreau",
    CD = "Claire Dubois",
    ML = "Marc Lefèvre";
  const list: Inc[] = [
    {
      number: 212,
      name: "Échecs de connexion pour les utilisateurs SSO",
      sev: "SEV1",
      phase: "closed",
      type: "security",
      visibility: "private",
      service: "auth-service",
      lead: AL,
      source: "alert",
      declaredAt: paris("08-17", "08:03"),
      acknowledgedAt: paris("08-17", "08:05"),
      resolvedAt: paris("08-17", "09:12"),
      closedAt: paris("08-19", "17:00"),
      customFields: { suspected_vector: "secret exposé" },
      participants: [AL, KH],
      events: [
        {
          at: paris("08-17", "08:03"),
          kind: "alert_attached",
          actorKind: "system",
          payload: { source: "Datadog", title: "Taux de connexion SSO sous 40 %" },
        },
        {
          at: paris("08-17", "08:05"),
          kind: "escalation_acknowledged",
          actor: AL,
          payload: { channel: "voice", afterMinutes: 2 },
        },
        {
          at: paris("08-17", "09:12"),
          kind: "resolved",
          actor: AL,
          payload: {
            note: "Métadonnées IdP rafraîchies. Incident maintenu privé (revue sécurité).",
          },
        },
      ],
    },
    {
      number: 213,
      name: "Certificat TLS du domaine de statut proche expiration",
      sev: "SEV4",
      phase: "closed",
      service: "web-storefront",
      lead: ML,
      source: "alert",
      declaredAt: paris("08-19", "11:02"),
      acknowledgedAt: paris("08-19", "11:10"),
      resolvedAt: paris("08-19", "11:31"),
      closedAt: paris("08-19", "11:31"),
      customFields: { region: "eu-west-1" },
      events: [
        {
          at: paris("08-19", "11:02"),
          kind: "alert_attached",
          actorKind: "system",
          payload: { source: "Uptime Kuma", title: "Certificat expirant sous 72 h." },
        },
        {
          at: paris("08-19", "11:31"),
          kind: "resolved",
          actor: ML,
          payload: { note: "Renouvellement débloqué ; auto-renew vérifié." },
        },
      ],
    },
    {
      number: 214,
      name: "Saturation CPU base de données pendant le batch nocturne",
      sev: "SEV2",
      phase: "closed",
      service: "checkout-api",
      lead: KH,
      source: "alert",
      declaredAt: paris("08-21", "02:14"),
      acknowledgedAt: paris("08-21", "02:19"),
      resolvedAt: paris("08-21", "03:40"),
      closedAt: paris("08-23", "10:00"),
      customFields: { region: "eu-west-1" },
      participants: [KH, AL],
      events: [
        {
          at: paris("08-21", "02:14"),
          kind: "alert_attached",
          actorKind: "system",
          payload: { source: "Prometheus", title: "db-primary CPU > 95 % pendant 10 min." },
        },
        {
          at: paris("08-21", "03:40"),
          kind: "resolved",
          actor: KH,
          payload: { note: "Fenêtre de batch déplacée ; plan de requête corrigé." },
        },
      ],
    },
    {
      number: 215,
      name: "Retard d'indexation de la recherche storefront",
      sev: "SEV4",
      phase: "closed",
      mode: "retrospective",
      service: "web-storefront",
      lead: CD,
      source: "web",
      declaredAt: paris("08-23", "15:40"),
      acknowledgedAt: paris("08-23", "15:52"),
      resolvedAt: paris("08-23", "18:05"),
      closedAt: paris("08-23", "18:05"),
      customFields: { region: "eu-west-1" },
      events: [
        {
          at: paris("08-23", "15:40"),
          kind: "declared",
          actor: CD,
          payload: { source: "web", mode: "retrospective", note: "Retard observé depuis 14:00." },
        },
        {
          at: paris("08-23", "18:05"),
          kind: "resolved",
          actor: CD,
          payload: { note: "Reconstruction de l'index terminée." },
        },
      ],
    },
    {
      number: 216,
      name: "Échecs de signature des webhooks Stripe",
      sev: "SEV3",
      phase: "closed",
      service: "payments-worker",
      lead: LG,
      source: "alert",
      declaredAt: paris("08-24", "09:12"),
      acknowledgedAt: paris("08-24", "09:15"),
      resolvedAt: paris("08-24", "10:02"),
      closedAt: paris("08-24", "12:00"),
      customFields: { region: "eu-west-1" },
      participants: [LG, NB],
      events: [
        {
          at: paris("08-24", "09:12"),
          kind: "alert_attached",
          actorKind: "system",
          payload: {
            source: "HTTP",
            title: "Vérification de signature en échec sur 8 % des webhooks Stripe.",
          },
        },
        {
          at: paris("08-24", "10:02"),
          kind: "resolved",
          actor: LG,
          payload: { note: "Secret de signature régénéré." },
        },
      ],
    },
    {
      number: 217,
      name: "Pic de latence checkout en eu-west-1",
      sev: "SEV2",
      phase: "post_incident",
      summary:
        "Entre 13:55 et 15:20 CEST, les requêtes checkout en eu-west-1 se sont dégradées, avec une latence p99 culminant à 2,4 s.",
      service: "checkout-api",
      lead: AL,
      comms: CD,
      source: "alert",
      declaredAt: paris("08-26", "14:02"),
      acceptedAt: paris("08-26", "14:07"),
      acknowledgedAt: paris("08-26", "14:06"),
      resolvedAt: paris("08-26", "15:20"),
      lastActivityAt: paris("08-27", "10:30"),
      customFields: { region: "eu-west-1", customer_impact: 1200 },
      participants: [AL, TM, CD, KH, NB],
      observers: [LG, ML],
      events: [
        {
          at: paris("08-26", "14:02"),
          kind: "created_from_alert",
          actorKind: "system",
          payload: { source: "Datadog", title: "checkout-api p99 latency > 2 s (eu-west-1)" },
        },
        {
          at: paris("08-26", "14:03"),
          kind: "escalation_triggered",
          actorKind: "system",
          payload: {
            path: "Platform primary",
            level: 1,
            urgency: "high",
            channels: ["voice", "sms", "webpush"],
          },
        },
        {
          at: paris("08-26", "14:06"),
          kind: "escalation_acknowledged",
          actor: AL,
          payload: { channel: "voice", afterMinutes: 4 },
        },
        {
          at: paris("08-26", "14:07"),
          kind: "accepted",
          actor: AL,
          payload: { severity: "SEV2", status: "Investigation" },
        },
        {
          at: paris("08-26", "14:07"),
          kind: "role_assigned",
          actorKind: "system",
          payload: {
            role: "lead",
            member: AL,
            reason: "on_call_for_service",
            service: "checkout-api",
          },
        },
        {
          at: paris("08-26", "14:15"),
          kind: "update_posted",
          actor: AL,
          payload: {
            status: "Investigation",
            message:
              "p99 checkout au-dessus de 2 s en eu-west-1. Corrélé au déploiement payments-worker de 13:55. Rollback en préparation.",
            nextUpdateMinutes: 30,
          },
        },
        {
          at: paris("08-26", "14:24"),
          kind: "link_added",
          actor: TM,
          payload: {
            provider: "github",
            kind: "pull_request",
            ref: "skylark/checkout-api #412",
            title: "augmenter le pool et rollback de la config worker",
            url: "https://github.com/skylark/checkout-api/pull/412",
          },
        },
        {
          at: paris("08-26", "14:31"),
          kind: "update_posted",
          actor: AL,
          payload: {
            status: "Correction",
            message:
              "Rollback en cours sur eu-west-1. Aucune perte de données ; budget d'erreur intact.",
          },
        },
        {
          at: paris("08-26", "14:38"),
          kind: "note",
          actor: TM,
          pinned: true,
          payload: {
            message:
              "Cause racine : pool de connexions épuisé après le déploiement payments-worker de 13:55 qui a doublé les connexions DB.",
          },
        },
        {
          at: paris("08-26", "14:47"),
          kind: "deployment",
          actorKind: "system",
          payload: {
            provider: "github",
            service: "checkout-api",
            version: "v2026.8.26-2",
            note: "rollback effectué en eu-west-1",
          },
        },
        {
          at: paris("08-26", "14:52"),
          kind: "update_posted",
          actor: AL,
          payload: {
            status: "Surveillance",
            message: "p99 repassé sous 300 ms. Surveillance 30 minutes avant résolution.",
          },
        },
        {
          at: paris("08-26", "15:20"),
          kind: "resolved",
          actor: AL,
          payload: { durationMinutes: 78, ttaMinutes: 4, postIncident: "SEV2" },
        },
        {
          at: paris("08-27", "10:30"),
          kind: "post_mortem_published",
          actor: AL,
          payload: {
            status: "in_review",
            followUps: 3,
            debriefAt: paris("09-01", "10:00").toISOString(),
          },
        },
      ],
    },
    {
      number: 218,
      name: "Pic de TypeError à la confirmation checkout",
      sev: null,
      phase: "triage",
      service: "checkout-api",
      source: "alert",
      declaredAt: todayAt("17:28"),
      lastActivityAt: todayAt("17:28"),
      events: [
        {
          at: todayAt("17:28"),
          kind: "created_from_alert",
          actorKind: "system",
          payload: {
            source: "Sentry",
            title: "Pic de TypeError à la confirmation checkout",
            grouped: 1,
            attributes: { service: "checkout-api", team: "Payments" },
          },
        },
      ],
    },
    {
      number: 219,
      name: "Taux d'erreur auth-service à 4,2 % sur 5 min",
      sev: null,
      phase: "triage",
      service: "auth-service",
      source: "alert",
      declaredAt: todayAt("17:44"),
      lastActivityAt: todayAt("17:44"),
      events: [
        {
          at: todayAt("17:44"),
          kind: "created_from_alert",
          actorKind: "system",
          payload: {
            source: "Datadog",
            title: "auth-service error rate 4.2 % over 5 min",
            grouped: 3,
            attributes: { service: "auth-service", team: "Platform" },
          },
        },
      ],
    },
    {
      number: 220,
      name: "Webhooks de paiement livrés avec plus de 5 min de retard",
      sev: "SEV2",
      phase: "active",
      status: "monitoring",
      service: "payments-worker",
      lead: NB,
      source: "alert",
      declaredAt: todayAt("13:41"),
      acceptedAt: todayAt("13:44"),
      acknowledgedAt: todayAt("13:44"),
      lastActivityAt: todayAt("15:58"),
      customFields: { region: "eu-west-1" },
      participants: [NB, LG],
      events: [
        {
          at: todayAt("13:41"),
          kind: "created_from_alert",
          actorKind: "system",
          payload: { source: "Grafana", title: "payments-worker queue depth > 10k" },
        },
        {
          at: todayAt("13:44"),
          kind: "escalation_acknowledged",
          actor: NB,
          payload: { channel: "webpush", afterMinutes: 3 },
        },
        {
          at: todayAt("13:44"),
          kind: "accepted",
          actor: NB,
          payload: { severity: "SEV2", status: "Investigation" },
        },
        {
          at: todayAt("15:58"),
          kind: "update_posted",
          actor: NB,
          payload: {
            status: "Surveillance",
            message: "File résorbée. Surveillance de la latence de livraison pendant une heure.",
            nextUpdateMinutes: 60,
          },
        },
      ],
    },
    {
      number: 221,
      name: "5xx élevés sur web-storefront",
      sev: "SEV3",
      phase: "active",
      status: "investigating",
      service: "web-storefront",
      lead: TM,
      source: "web",
      declaredAt: todayAt("16:22"),
      acknowledgedAt: todayAt("16:24"),
      lastActivityAt: todayAt("16:30"),
      customFields: { region: "eu-west-1" },
      participants: [TM],
      events: [
        {
          at: todayAt("16:22"),
          kind: "declared",
          actor: TM,
          payload: { source: "web", severity: "SEV3", service: "web-storefront" },
        },
        {
          at: todayAt("16:23"),
          kind: "escalation_triggered",
          actorKind: "system",
          payload: { path: "Storefront", level: 1, urgency: "high" },
        },
        {
          at: todayAt("16:30"),
          kind: "update_posted",
          actor: TM,
          payload: {
            status: "Investigation",
            message:
              "Taux de 5xx à 2,1 % sur le edge storefront. Piste : le push de config CDN de 16:05.",
          },
        },
      ],
    },
  ];

  for (const inc of list) await ensureIncident(tx, ctx, inc);
  await ensureFollowUps(tx, ctx);
  await ensurePostIncident(tx, ctx);
}

async function ensureIncident(tx: Tx, ctx: Ctx, inc: Inc) {
  const [present] = await tx
    .select({ id: incidents.id })
    .from(incidents)
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, inc.number)));
  if (present) return present.id;

  const statusId = inc.phase === "active" && inc.status ? ctx.statusId[inc.status]! : null;
  const [row] = await tx
    .insert(incidents)
    .values({
      tenantId,
      number: inc.number,
      name: inc.name,
      summary: inc.summary ?? null,
      mode: inc.mode ?? "live",
      visibility: inc.visibility ?? "public",
      typeId: ctx.typeId[inc.type ?? "default"]!,
      severityId: inc.sev ? ctx.sevId[inc.sev]! : null,
      phase: inc.phase,
      statusId,
      serviceEntryId: ctx.entryId[inc.service] ?? null,
      creatorMemberId: inc.source === "web" && inc.lead ? ctx.memberId(inc.lead) : null,
      source: inc.source,
      customFields: inc.customFields ?? {},
      declaredAt: inc.declaredAt,
      acceptedAt: inc.acceptedAt ?? null,
      acknowledgedAt: inc.acknowledgedAt ?? null,
      resolvedAt: inc.resolvedAt ?? null,
      closedAt: inc.closedAt ?? null,
      lastActivityAt: inc.lastActivityAt ?? inc.closedAt ?? inc.resolvedAt ?? inc.declaredAt,
    })
    .returning({ id: incidents.id });
  const id = row!.id;

  await tx.insert(incidentEvents).values(
    inc.events.map((ev) => ({
      tenantId,
      incidentId: id,
      kind: ev.kind,
      actorKind: ev.actorKind ?? (ev.actor ? "member" : "system"),
      actorMemberId: ev.actor ? ctx.memberId(ev.actor) : null,
      actorName: ev.actor ?? null,
      payload: ev.payload ?? {},
      occurredAt: ev.at,
      pinned: ev.pinned ?? false,
    })),
  );

  for (const ev of inc.events.filter((e) => e.kind === "update_posted")) {
    const statusName = String(ev.payload?.status ?? "");
    const statusRow = await tx
      .select({ id: incidentStatuses.id })
      .from(incidentStatuses)
      .where(
        and(
          eq(incidentStatuses.typeId, ctx.typeId[inc.type ?? "default"]!),
          eq(incidentStatuses.name, statusName),
        ),
      );
    const next = ev.payload?.nextUpdateMinutes as number | undefined;
    await tx.insert(incidentUpdates).values({
      tenantId,
      incidentId: id,
      memberId: ev.actor ? ctx.memberId(ev.actor) : null,
      statusId: statusRow[0]?.id ?? null,
      message: String(ev.payload?.message ?? ""),
      nextUpdateDueAt: next ? new Date(ev.at.getTime() + next * MIN) : null,
      createdAt: ev.at,
    });
  }

  if (inc.lead) {
    await tx
      .insert(roleAssignments)
      .values({
        tenantId,
        incidentId: id,
        roleId: ctx.roleLead,
        memberId: ctx.memberId(inc.lead),
        assignedAt: inc.acceptedAt ?? inc.declaredAt,
      })
      .onConflictDoNothing();
  }
  if (inc.comms) {
    await tx
      .insert(roleAssignments)
      .values({
        tenantId,
        incidentId: id,
        roleId: ctx.roleComms,
        memberId: ctx.memberId(inc.comms),
        assignedAt: inc.acceptedAt ?? inc.declaredAt,
      })
      .onConflictDoNothing();
  }
  const people = new Map<string, "participant" | "observer">();
  for (const p of inc.participants ?? []) people.set(p, "participant");
  for (const o of inc.observers ?? []) if (!people.has(o)) people.set(o, "observer");
  for (const [name, kind] of people) {
    await tx
      .insert(incidentParticipants)
      .values({
        tenantId,
        incidentId: id,
        memberId: ctx.memberId(name),
        kind,
        firstActivityAt: inc.declaredAt,
        lastActivityAt: inc.lastActivityAt ?? inc.declaredAt,
      })
      .onConflictDoNothing();
  }
  return id;
}

async function incidentIdByNumber(tx: Tx, number: number): Promise<string> {
  const [row] = await tx
    .select({ id: incidents.id })
    .from(incidents)
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
  if (!row) throw new Error(`INC-${number} missing`);
  return row.id;
}

async function ensureFollowUps(tx: Tx, ctx: Ctx) {
  const rows = [
    {
      inc: 217,
      t: "Alerter sur la saturation du pool de connexions DB",
      pr: "P1",
      who: "Thomas Moreau",
      due: paris("09-02", "18:00"),
      ext: { tracker: "jira", key: "PLAT-482" },
      done: null,
    },
    {
      inc: 216,
      t: "Régénérer le secret de signature des webhooks Stripe",
      pr: "P1",
      who: "Lucas Girard",
      due: paris("08-25", "18:00"),
      ext: { tracker: "jira", key: "PAY-311" },
      done: null,
    },
    {
      inc: 217,
      t: "Décaler les déploiements payments-worker hors des pics",
      pr: "P2",
      who: "Amélie Laurent",
      due: paris("09-09", "18:00"),
      ext: { tracker: "github", key: "#418" },
      done: paris("08-28", "11:00"),
    },
    {
      inc: 217,
      t: "Documenter le runbook de rollback eu-west-1",
      pr: "P2",
      who: "Claire Dubois",
      due: paris("09-09", "18:00"),
      ext: null,
      done: paris("08-27", "16:00"),
    },
    {
      inc: 214,
      t: "Autoscaler le storefront pendant les ventes",
      pr: "P2",
      who: "Karim Haddad",
      due: paris("09-05", "18:00"),
      ext: { tracker: "jira", key: "PLAT-467" },
      done: null,
    },
    {
      inc: 215,
      t: "Créer un SLO sur le retard d'indexation",
      pr: "P3",
      who: "Claire Dubois",
      due: paris("09-12", "18:00"),
      ext: null,
      done: null,
    },
    {
      inc: 212,
      t: "Activer le chemin de secours de connexion SSO",
      pr: "P1",
      who: "Amélie Laurent",
      due: paris("08-31", "18:00"),
      ext: { tracker: "github", key: "#402" },
      done: paris("08-20", "15:00"),
    },
    {
      inc: 213,
      t: "Alertes de pré-expiration des certificats TLS",
      pr: "P3",
      who: "Marc Lefèvre",
      due: null,
      ext: null,
      done: paris("08-21", "09:00"),
    },
  ] as const;
  for (const f of rows) {
    const incidentId = await incidentIdByNumber(tx, f.inc);
    const [exists] = await tx
      .select({ id: followUps.id })
      .from(followUps)
      .where(and(eq(followUps.incidentId, incidentId), eq(followUps.title, f.t)));
    if (exists) continue;
    await tx.insert(followUps).values({
      tenantId,
      incidentId,
      title: f.t,
      priorityId: ctx.prioId[f.pr]!,
      assigneeMemberId: ctx.memberId(f.who),
      status: f.done ? "done" : "open",
      dueAt: f.due,
      completedAt: f.done,
      externalRef: f.ext
        ? {
            ...f.ext,
            url:
              f.ext.tracker === "jira"
                ? `https://skylark.atlassian.net/browse/${f.ext.key}`
                : `https://github.com/skylark/checkout-api/pull/${f.ext.key.replace("#", "")}`,
          }
        : null,
      createdAt: f.inc === 217 ? paris("08-26", "15:40") : undefined,
    });
  }
}

async function ensurePostIncident(tx: Tx, ctx: Ctx) {
  const incidentId = await incidentIdByNumber(tx, 217);
  const [task] = await tx
    .select({ id: postIncidentTasks.id })
    .from(postIncidentTasks)
    .where(eq(postIncidentTasks.incidentId, incidentId))
    .limit(1);
  if (!task) {
    const AL = ctx.memberId("Amélie Laurent"),
      CD = ctx.memberId("Claire Dubois");
    await tx.insert(postIncidentTasks).values([
      {
        tenantId,
        incidentId,
        phase: "documenting",
        title: "Relire et organiser la timeline",
        assigneeMemberId: AL,
        dueAt: paris("08-28", "18:00"),
        completedAt: paris("08-26", "17:10"),
        position: 0,
      },
      {
        tenantId,
        incidentId,
        phase: "documenting",
        title: "Créer le post-mortem",
        assigneeMemberId: AL,
        dueAt: paris("08-29", "18:00"),
        completedAt: paris("08-27", "10:30"),
        position: 1,
      },
      {
        tenantId,
        incidentId,
        phase: "documenting",
        title: "Programmer le débrief",
        assigneeMemberId: AL,
        dueAt: paris("08-29", "18:00"),
        completedAt: paris("08-27", "10:40"),
        position: 2,
      },
      {
        tenantId,
        incidentId,
        phase: "reviewing",
        title: "Relire les suivis",
        assigneeMemberId: AL,
        dueAt: paris("09-02", "18:00"),
        position: 0,
      },
      {
        tenantId,
        incidentId,
        phase: "reviewing",
        title: "Diffuser le post-mortem",
        assigneeMemberId: CD,
        dueAt: null,
        position: 1,
      },
      {
        tenantId,
        incidentId,
        phase: "reviewing",
        title: "Tenir le débrief",
        assigneeMemberId: AL,
        dueAt: paris("09-01", "10:00"),
        completedAt: paris("09-01", "10:45"),
        position: 2,
      },
    ]);
  }
  await tx
    .insert(postMortems)
    .values({
      tenantId,
      incidentId,
      status: "in_review",
      aiDrafted: true,
      ownerMemberId: ctx.memberId("Amélie Laurent"),
      publishedAt: paris("08-27", "10:30"),
      sections: [
        {
          key: "summary",
          title: "Résumé",
          body: "Entre 13:55 et 15:20 CEST, les requêtes checkout en eu-west-1 se sont dégradées, avec une latence p99 culminant à 2,4 s. Environ 4 % des tentatives ont expiré. L'incident a été détecté par un moniteur Datadog à 14:02 et acquitté en 4 minutes.",
        },
        {
          key: "root_cause",
          title: "Cause racine",
          body: "Le déploiement payments-worker de 13:55 a doublé son nombre de connexions à la base, épuisant le pool partagé utilisé par checkout-api. Les requêtes checkout ont fait la queue à l'acquisition de connexion, gonflant la latence de queue.",
        },
        {
          key: "went_well",
          title: "Ce qui a bien fonctionné",
          body: "- Acquittement en 4 minutes — l'escalade vocale a fonctionné comme prévu.\n- La note de cause racine épinglée a aligné les répondeurs ; aucune investigation en double.\n- Page de statut publique mise à jour 15 minutes après la détection.",
        },
      ],
    })
    .onConflictDoNothing();
  await tx
    .insert(debriefs)
    .values({
      tenantId,
      incidentId,
      scheduledAt: paris("09-01", "10:00"),
      durationMinutes: 45,
      attendeeMemberIds: [
        "Amélie Laurent",
        "Thomas Moreau",
        "Claire Dubois",
        "Karim Haddad",
        "Nadia Benali",
        "Lucas Girard",
      ].map(ctx.memberId),
      invitationSentAt: paris("08-27", "10:40"),
    })
    .onConflictDoNothing();
}

async function ensureAudit(tx: Tx, ctx: Ctx) {
  const [present] = await tx
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .limit(1);
  if (present) return;
  const AL = "Amélie Laurent";
  await tx.insert(auditEvents).values([
    {
      tenantId,
      actorMemberId: ctx.memberId(AL),
      actorName: AL,
      category: "data",
      action: "status_page.subscribers_imported",
      target: { count: 128 },
      createdAt: paris("08-28", "16:20"),
    },
    {
      tenantId,
      actorMemberId: ctx.memberId(AL),
      actorName: AL,
      category: "members",
      action: "member.role_changed",
      target: { member: "Claire Dubois", from: "responder", to: "viewer" },
      createdAt: paris("08-29", "09:41"),
    },
    {
      tenantId,
      actorMemberId: ctx.memberId(AL),
      actorName: AL,
      category: "security",
      action: "api_key.created",
      target: { hint: "oi_live_7d10…e44a", scopes: ["incident:create"] },
      createdAt: new Date(Date.now() - DAY - 5 * HOUR),
    },
    {
      tenantId,
      actorMemberId: ctx.memberId("Claire Dubois"),
      actorName: "Claire Dubois",
      category: "config",
      action: "announcement_template.updated",
      target: { name: "Incident majeur" },
      createdAt: new Date(Date.now() - DAY + 4 * HOUR),
    },
    {
      tenantId,
      actorMemberId: ctx.memberId("Karim Haddad"),
      actorName: "Karim Haddad",
      category: "security",
      action: "session.sso_signed_in",
      target: { provider: "google", email: "karim@skylark.dev" },
      createdAt: new Date(Date.now() - 3 * HOUR),
    },
    {
      tenantId,
      actorMemberId: ctx.memberId(AL),
      actorName: AL,
      category: "config",
      action: "escalation_path.published",
      target: { name: "Platform primary", version: 7 },
      createdAt: new Date(Date.now() - 1 * HOUR),
    },
  ]);
}

/** The design's templates and its one rule, already fired by INC-217 and, live, by INC-220. */
async function ensureAnnouncements(tx: Tx, ctx: Ctx) {
  const [present] = await tx
    .select({ id: announcementTemplates.id })
    .from(announcementTemplates)
    .where(eq(announcementTemplates.tenantId, tenantId))
    .limit(1);
  if (present) return;
  const [major] = await tx
    .insert(announcementTemplates)
    .values({
      tenantId,
      name: "Incident majeur — annonce large",
      audience: "workspace",
      body: "{severity} · {title} — {status}, prochain point {next_update}",
      position: 0,
    })
    .returning({ id: announcementTemplates.id });
  await tx.insert(announcementTemplates).values({
    tenantId,
    name: "Maintenance planifiée",
    audience: "workspace",
    body: "Maintenance {title} — {status}",
    position: 1,
  });
  const inc217 = await incidentIdByNumber(tx, 217);
  const inc220 = await incidentIdByNumber(tx, 220);
  const [rule] = await tx
    .insert(announcementRules)
    .values({
      tenantId,
      name: "Annonce SEV1 / SEV2",
      active: true,
      minSeverityRank: 1,
      typeId: ctx.typeId.default!,
      templateId: major!.id,
      audience: "workspace",
      triggeredCount: 4,
      lastIncidentId: inc220,
    })
    .returning({ id: announcementRules.id });
  await tx.insert(announcements).values([
    {
      tenantId,
      incidentId: inc217,
      ruleId: rule!.id,
      templateId: major!.id,
      audience: "workspace",
      body: "SEV2 · Pic de latence checkout en eu-west-1 — Surveillance, prochain point 15:20",
      status: "closed",
      createdAt: paris("08-26", "14:15"),
      updatedAt: paris("08-26", "15:20"),
    },
    {
      tenantId,
      incidentId: inc220,
      ruleId: rule!.id,
      templateId: major!.id,
      audience: "workspace",
      body: "SEV2 · Webhooks de paiement livrés avec plus de 5 min de retard — Surveillance, prochain point dans 1 h",
      status: "live",
      createdAt: todayAt("13:44"),
      updatedAt: todayAt("15:58"),
    },
  ]);
}

/** Two keys and two endpoints, as the design draws them. The demo keys cannot be used: their plaintext is never known. */
async function ensureApiAndWebhooks(tx: Tx, ctx: Ctx) {
  const [present] = await tx
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId))
    .limit(1);
  if (present) return;
  const AL = ctx.memberId("Amélie Laurent");
  const keys = [
    {
      name: "Terraform CI",
      prefix: "oi_live_a4f2",
      lastFour: "c91b",
      scopes: ["read", "write"] as const,
      lastUsedAt: new Date(Date.now() - 4 * MIN),
    },
    {
      name: "Ingestion Datadog",
      prefix: "oi_live_7d10",
      lastFour: "e44a",
      scopes: ["incident:create"] as const,
      lastUsedAt: new Date(Date.now() - 2 * MIN),
    },
  ];
  for (const k of keys) {
    const keyHash = createHash("sha256").update(randomBytes(32).toString("hex")).digest("hex");
    await tx.insert(apiKeys).values({
      tenantId,
      name: k.name,
      keyHash,
      prefix: k.prefix,
      lastFour: k.lastFour,
      scopes: [...k.scopes],
      createdByMemberId: AL,
      lastUsedAt: k.lastUsedAt,
    });
    await tx.insert(apiKeyLookup).values({ keyHash, tenantId }).onConflictDoNothing();
  }
  const [healthy] = await tx
    .insert(webhookEndpoints)
    .values({
      tenantId,
      url: "https://hooks.skylark.dev/oi",
      encryptedSecret: encryptSecret(`whsec_${randomBytes(24).toString("hex")}`),
      events: [
        "incident.created",
        "incident.updated",
        "incident.update_published",
        "incident.resolved",
        "follow_up.created",
      ],
      active: true,
      createdByMemberId: AL,
    })
    .returning({ id: webhookEndpoints.id });
  const [failing] = await tx
    .insert(webhookEndpoints)
    .values({
      tenantId,
      url: "https://siem.skylark.dev/ingest",
      encryptedSecret: encryptSecret(`whsec_${randomBytes(24).toString("hex")}`),
      events: ["incident.created", "incident.resolved"],
      active: true,
      failingSince: new Date(Date.now() - 2 * DAY),
      createdByMemberId: AL,
    })
    .returning({ id: webhookEndpoints.id });
  await tx.insert(webhookDeliveries).values([
    {
      tenantId,
      endpointId: healthy!.id,
      event: "incident.update_published",
      payload: { event: "incident.update_published", incident: { reference: "INC-220" } },
      httpStatus: 200,
      latencyMs: 184,
      createdAt: todayAt("15:58"),
    },
    {
      tenantId,
      endpointId: healthy!.id,
      event: "incident.created",
      payload: { event: "incident.created", incident: { reference: "INC-221" } },
      httpStatus: 200,
      latencyMs: 211,
      createdAt: todayAt("16:22"),
    },
    {
      tenantId,
      endpointId: failing!.id,
      event: "incident.created",
      payload: { event: "incident.created", incident: { reference: "INC-221" } },
      httpStatus: 503,
      latencyMs: 5002,
      error: "HTTP 503",
      createdAt: todayAt("16:22"),
    },
    {
      tenantId,
      endpointId: failing!.id,
      event: "incident.created",
      payload: { event: "incident.created", incident: { reference: "INC-220" } },
      httpStatus: null,
      latencyMs: 5001,
      error: "The operation was aborted due to timeout",
      createdAt: todayAt("13:41"),
    },
  ]);
}

/**
 * On-call & alerting, as the design draws them: four priorities, two working
 * hours sets, seven sources, four routes, three escalation paths (Platform
 * primary published as v7 with a draft level 4), two schedules, the alerts of
 * the Alerts page — one with its escalation still pending on level 1.
 */
async function ensureOnCall(tx: Tx, ctx: Ctx) {
  const [present] = await tx
    .select({ id: alertPriorities.id })
    .from(alertPriorities)
    .where(eq(alertPriorities.tenantId, tenantId))
    .limit(1);
  if (present) return;
  const m = ctx.memberId;
  const now = new Date();

  // Priorities
  const prio: Record<string, string> = {};
  for (const [i, p] of (
    [
      ["P1", "Critique — page immédiatement, de nuit comme de jour", "high", "var(--dang)"],
      ["P2", "Élevée — page en heures ouvrées, sinon selon le chemin", "high", "var(--wait)"],
      ["P3", "Normale — notification silencieuse, traitée dans la journée", "low", "var(--open)"],
      ["P4", "Basse — digest email, jamais de page", "low", "var(--ink-3)"],
    ] as const
  ).entries()) {
    const [row] = await tx
      .insert(alertPriorities)
      .values({
        tenantId,
        name: p[0],
        description: p[1],
        urgency: p[2],
        color: p[3],
        rank: i,
        position: i,
      })
      .returning({ id: alertPriorities.id });
    prio[p[0]] = row!.id;
  }

  // Working hours
  const [eu] = await tx
    .insert(workingHoursSets)
    .values({
      tenantId,
      name: "EU business",
      timezone: "Europe/Paris",
      days: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "18:00",
    })
    .returning({ id: workingHoursSets.id });
  await tx.insert(workingHoursSets).values({
    tenantId,
    name: "US coverage",
    timezone: "America/New_York",
    days: [1, 2, 3, 4, 5],
    startTime: "15:00",
    endTime: "00:00",
  });

  // Schedules
  const AL = m("Amélie Laurent");
  const KH = m("Karim Haddad");
  const NB = m("Nadia Benali");
  const LG = m("Lucas Girard");
  const TM = m("Thomas Moreau");
  const CD = m("Claire Dubois");
  const effective = paris("08-03", "09:00");
  const [platform] = await tx
    .insert(schedules)
    .values({
      tenantId,
      name: "Platform primary",
      timezone: "Europe/Paris",
      handoverTime: "09:00",
      status: "published",
      icalToken: randomBytes(16).toString("hex"),
      createdByMemberId: AL,
    })
    .returning({ id: schedules.id });
  await tx.insert(rotations).values([
    {
      tenantId,
      scheduleId: platform!.id,
      name: "Jour EU",
      interval: "weekly",
      handoverDay: 3,
      activeStart: "09:00",
      activeEnd: "21:00",
      memberIds: [AL, KH, CD],
      effectiveFrom: effective,
      position: 0,
    },
    {
      tenantId,
      scheduleId: platform!.id,
      name: "Nuit US",
      interval: "weekly",
      handoverDay: 3,
      activeStart: "21:00",
      activeEnd: "09:00",
      memberIds: [NB, LG],
      effectiveFrom: effective,
      position: 1,
    },
  ]);
  const [dayEu] = await tx
    .select({ id: rotations.id })
    .from(rotations)
    .where(and(eq(rotations.scheduleId, platform!.id), eq(rotations.name, "Jour EU")));
  // Claire covers next Saturday's day shift.
  const sat = new Date(now.getTime());
  sat.setUTCDate(sat.getUTCDate() + ((6 - ((sat.getUTCDay() + 6) % 7) - 1 + 7) % 7 || 7));
  const satKey = `${sat.getUTCFullYear()}-${String(sat.getUTCMonth() + 1).padStart(2, "0")}-${String(sat.getUTCDate()).padStart(2, "0")}`;
  await tx.insert(scheduleOverrides).values({
    tenantId,
    scheduleId: platform!.id,
    rotationId: dayEu!.id,
    memberId: CD,
    startAt: new Date(`${satKey}T09:00:00+02:00`),
    endAt: new Date(`${satKey}T21:00:00+02:00`),
    reason: "cover",
    createdByMemberId: AL,
  });
  const [payments] = await tx
    .insert(schedules)
    .values({
      tenantId,
      name: "Payments primary",
      timezone: "Europe/Paris",
      handoverTime: "09:00",
      status: "published",
      icalToken: randomBytes(16).toString("hex"),
      createdByMemberId: AL,
    })
    .returning({ id: schedules.id });
  await tx.insert(rotations).values({
    tenantId,
    scheduleId: payments!.id,
    name: "Primary",
    interval: "weekly",
    handoverDay: 1,
    activeStart: null,
    activeEnd: null,
    memberIds: [NB, LG, KH],
    effectiveFrom: effective,
    position: 0,
  });

  // Escalation paths
  const publish = async (
    name: string,
    description: string,
    versions: Array<{ version: number; graph: EscalationGraphSeed; at: Date }>,
    draft: EscalationGraphSeed | null,
  ) => {
    const [path] = await tx
      .insert(escalationPaths)
      .values({ tenantId, name, description, draftGraph: draft })
      .returning({ id: escalationPaths.id });
    let currentId: string | null = null;
    for (const v of versions) {
      const [row] = await tx
        .insert(escalationPathVersions)
        .values({
          tenantId,
          pathId: path!.id,
          version: v.version,
          graph: v.graph,
          publishedAt: v.at,
          publishedByMemberId: AL,
        })
        .returning({ id: escalationPathVersions.id });
      currentId = row!.id;
    }
    await tx
      .update(escalationPaths)
      .set({ currentVersionId: currentId })
      .where(eq(escalationPaths.id, path!.id));
    return { id: path!.id, versionId: currentId! };
  };
  const platformGraph: EscalationGraphSeed = {
    start: "c_hours",
    nodes: [
      {
        id: "c_hours",
        kind: "condition",
        test: { type: "working_hours", setId: eu!.id },
        whenTrue: "l1",
        whenFalse: "c_prio",
      },
      {
        id: "c_prio",
        kind: "condition",
        test: { type: "priority", maxRank: 1 },
        whenTrue: "l1",
        whenFalse: "d_morning",
      },
      { id: "d_morning", kind: "delay", untilWorkingHoursSetId: eu!.id, next: "l1_low" },
      {
        id: "l1",
        kind: "level",
        targets: [{ kind: "schedule", scheduleId: platform!.id, mode: "current" }],
        urgency: "high",
        ackTimeoutMinutes: 5,
        retries: 2,
        retryIntervalMinutes: 2,
        next: "l2",
      },
      {
        id: "l1_low",
        kind: "level",
        targets: [{ kind: "schedule", scheduleId: platform!.id, mode: "current" }],
        urgency: "low",
        ackTimeoutMinutes: 60,
        retries: 0,
        retryIntervalMinutes: 10,
        next: "l2",
      },
      {
        id: "l2",
        kind: "level",
        targets: [{ kind: "member", memberId: KH }],
        urgency: "high",
        ackTimeoutMinutes: 10,
        retries: 0,
        retryIntervalMinutes: 5,
        next: "l3",
      },
      {
        id: "l3",
        kind: "level",
        targets: [{ kind: "member", memberId: TM }],
        urgency: "high",
        ackTimeoutMinutes: 15,
        retries: 0,
        retryIntervalMinutes: 5,
        everyoneMustAck: true,
        next: null,
      },
    ],
  };
  const platformDraft: EscalationGraphSeed = {
    ...platformGraph,
    nodes: platformGraph.nodes
      .map((n) => (n.id === "l3" && n.kind === "level" ? { ...n, next: "l4" } : n))
      .concat([
        {
          id: "l4",
          kind: "level",
          targets: [{ kind: "team", teamEntryId: ctx.entryId.Platform! }],
          urgency: "high",
          ackTimeoutMinutes: 20,
          retries: 0,
          retryIntervalMinutes: 5,
          next: null,
        },
      ]),
  };
  const older = (v: number, ackMin: number): EscalationGraphSeed => ({
    start: "l1",
    nodes: [
      {
        id: "l1",
        kind: "level",
        targets: [{ kind: "schedule", scheduleId: platform!.id, mode: "current" }],
        urgency: "high",
        ackTimeoutMinutes: ackMin,
        retries: 1,
        retryIntervalMinutes: 3,
        next: "l2",
      },
      {
        id: "l2",
        kind: "level",
        targets: [{ kind: "member", memberId: KH }],
        urgency: "high",
        ackTimeoutMinutes: 10 + v,
        retries: 0,
        retryIntervalMinutes: 5,
        next: null,
      },
    ],
  });
  const platformPath = await publish(
    "Platform primary",
    "Astreinte plateforme — heures ouvrées puis priorité",
    [
      { version: 5, graph: older(5, 10), at: paris("06-02", "10:00") },
      { version: 6, graph: older(6, 7), at: paris("07-15", "16:30") },
      { version: 7, graph: platformGraph, at: todayAt("14:12") },
    ],
    platformDraft,
  );
  const paymentsPath = await publish(
    "Payments escalation",
    "Chaîne de paiement — astreinte Payments puis lead",
    [
      {
        version: 2,
        graph: {
          start: "l1",
          nodes: [
            {
              id: "l1",
              kind: "level",
              targets: [{ kind: "schedule", scheduleId: payments!.id, mode: "current" }],
              urgency: "high",
              ackTimeoutMinutes: 5,
              retries: 1,
              retryIntervalMinutes: 2,
              next: "l2",
            },
            {
              id: "l2",
              kind: "level",
              targets: [{ kind: "member", memberId: LG }],
              urgency: "high",
              ackTimeoutMinutes: 10,
              retries: 0,
              retryIntervalMinutes: 5,
              next: null,
            },
          ],
        },
        at: paris("05-20", "11:00"),
      },
    ],
    null,
  );
  const securityPath = await publish(
    "Security escalation",
    "Sécurité — responsable puis toute l'équipe Platform",
    [
      {
        version: 1,
        graph: {
          start: "l1",
          nodes: [
            {
              id: "l1",
              kind: "level",
              targets: [{ kind: "member", memberId: AL }],
              urgency: "high",
              ackTimeoutMinutes: 5,
              retries: 2,
              retryIntervalMinutes: 2,
              next: "l2",
            },
            {
              id: "l2",
              kind: "level",
              targets: [{ kind: "team", teamEntryId: ctx.entryId.Platform! }],
              urgency: "high",
              ackTimeoutMinutes: 15,
              retries: 0,
              retryIntervalMinutes: 5,
              next: null,
            },
          ],
        },
        at: paris("04-08", "09:30"),
      },
    ],
    null,
  );
  void paymentsPath;

  // Sources — demo secrets are random and never shown: create your own to post.
  const src: Record<string, string> = {};
  const sources = [
    ["datadog", "Datadog", true, 2 * MIN],
    ["prometheus", "Prometheus / Alertmanager", true, 31 * MIN],
    ["grafana", "Grafana", true, 3 * HOUR],
    ["sentry", "Sentry", true, 9 * MIN],
    ["uptime_kuma", "Uptime Kuma", true, 5 * DAY],
    ["http", "HTTP générique", true, 2 * DAY],
    ["cloudwatch", "Amazon CloudWatch", false, null],
  ] as const;
  for (const [kind, name, active, ago] of sources) {
    const [row] = await tx
      .insert(alertSources)
      .values({
        tenantId,
        kind,
        name,
        secretHash: createHash("sha256").update(randomBytes(24).toString("hex")).digest("hex"),
        mappings: defaultMappingsFor(kind),
        active,
        lastAlertAt: ago === null ? null : new Date(now.getTime() - ago),
        createdByMemberId: AL,
      })
      .returning({ id: alertSources.id });
    src[kind] = row!.id;
    await registerApiKeyLookup(`src:${row!.id}`, tenantId);
  }

  // Routes
  const [prodRoute] = await tx
    .insert(alertRoutes)
    .values({
      tenantId,
      name: "Production alerts",
      active: true,
      filters: [{ attribute: "environment", op: "eq", value: "production" }],
      escalationMode: "dynamic",
      escalationPathId: platformPath.id,
      incidentMode: "conditional",
      position: 0,
      alertCount: 312,
    })
    .returning({ id: alertRoutes.id });
  await tx.insert(alertRoutes).values([
    {
      tenantId,
      name: "Sécurité — P1 auth",
      active: true,
      filters: [
        { attribute: "priority", op: "eq", value: "P1" },
        { attribute: "service", op: "eq", value: "auth-service" },
      ],
      escalationMode: "static",
      escalationPathId: securityPath.id,
      incidentMode: "always",
      incidentTypeId: ctx.typeId.security ?? null,
      position: -1,
      alertCount: 8,
    },
    {
      tenantId,
      name: "Staging — silencieux",
      active: true,
      filters: [{ attribute: "environment", op: "eq", value: "staging" }],
      escalationMode: "none",
      urgencyOverride: "low",
      incidentMode: "never",
      position: 1,
      alertCount: 96,
    },
    {
      tenantId,
      name: "Nouvelle source Uptime Kuma",
      active: true,
      testMode: true,
      filters: [{ attribute: "source", op: "eq", value: "uptime_kuma" }],
      escalationMode: "dynamic",
      incidentMode: "conditional",
      position: 2,
      alertCount: 19,
    },
  ]);

  // Alerts
  const inc = async (n: number) => incidentIdByNumber(tx, n);
  const mkAlert = async (a: {
    kind: keyof typeof src;
    title: string;
    key: string;
    status: "firing" | "resolved";
    prio: string;
    attrs: Record<string, string>;
    grp: number;
    first: Date;
    last: Date;
    incident?: number;
    url?: string;
    payload: unknown;
    resolvedAt?: Date;
    acked?: { by: string; at: Date };
  }) => {
    const [row] = await tx
      .insert(alerts)
      .values({
        tenantId,
        sourceId: src[a.kind]!,
        routeId: prodRoute!.id,
        dedupKey: a.key,
        status: a.status,
        title: a.title,
        payload: a.payload,
        attributes: {
          ...a.attrs,
          priority: a.prio,
          source: a.kind,
          environment: a.attrs.environment ?? "production",
        },
        priorityId: prio[a.prio]!,
        urgency: a.prio === "P1" || a.prio === "P2" ? "high" : "low",
        groupCount: a.grp,
        incidentId: a.incident ? await inc(a.incident) : null,
        externalUrl: a.url ?? null,
        firstAt: a.first,
        lastAt: a.last,
        resolvedAt: a.resolvedAt ?? null,
        ackedAt: a.acked?.at ?? null,
        ackedByMemberId: a.acked ? m(a.acked.by) : null,
      })
      .returning({ id: alerts.id });
    const id = row!.id;
    const ev: Array<typeof alertEvents.$inferInsert> = [
      {
        tenantId,
        alertId: id,
        kind: "triggered",
        actorKind: "system",
        payload: { source: a.kind, priority: a.prio },
        occurredAt: a.first,
      },
      {
        tenantId,
        alertId: id,
        kind: "routed",
        actorKind: "system",
        payload: {
          route: "Production alerts",
          escalation: "dynamic",
          via: `${a.attrs.service} → ${a.attrs.team ?? "Platform"} → Platform primary`,
        },
        occurredAt: a.first,
      },
    ];
    if (a.incident)
      ev.push({
        tenantId,
        alertId: id,
        kind: "incident_created",
        actorKind: "system",
        payload: { number: a.incident, phase: "triage" },
        occurredAt: new Date(a.first.getTime() + 20_000),
      });
    if (a.acked)
      ev.push({
        tenantId,
        alertId: id,
        kind: "acknowledged",
        actorKind: "member",
        actorMemberId: m(a.acked.by),
        actorName: a.acked.by,
        payload: { channel: "voice" },
        occurredAt: a.acked.at,
      });
    if (a.resolvedAt)
      ev.push({
        tenantId,
        alertId: id,
        kind: "resolved",
        actorKind: "system",
        payload: { by: "source" },
        occurredAt: a.resolvedAt,
      });
    await tx.insert(alertEvents).values(ev);
    return id;
  };
  const authAlert = await mkAlert({
    kind: "datadog",
    title: "Taux d'erreur auth-service à 4,2 % sur 5 min",
    key: "dd:auth.error_rate",
    status: "firing",
    prio: "P2",
    attrs: {
      service: "auth-service",
      team: "Platform",
      environment: "production",
      region: "eu-west-1",
    },
    grp: 3,
    first: todayAt("17:44"),
    last: new Date(now.getTime() - 2 * MIN),
    incident: 219,
    url: "https://app.datadoghq.eu/monitors/4207231",
    payload: {
      monitor_id: 4207231,
      title: "auth-service error rate 4.2 % over 5 min",
      status: "Triggered",
      priority: "P2",
      scope: "service:auth-service,env:production,region:eu-west-1",
      link: "https://app.datadoghq.eu/monitors/4207231",
    },
  });
  for (const [title, at] of [
    ["auth-service error rate 4,6 % sur 5 min", todayAt("17:47")],
    ["auth-service p95 latency > 800 ms", todayAt("17:49")],
  ] as const) {
    const [child] = await tx
      .insert(alerts)
      .values({
        tenantId,
        sourceId: src.datadog!,
        routeId: prodRoute!.id,
        dedupKey: `dd:${title}`,
        status: "firing",
        title,
        payload: {
          title,
          status: "Triggered",
          priority: "P2",
          scope: "service:auth-service,env:production",
        },
        attributes: {
          service: "auth-service",
          team: "Platform",
          environment: "production",
          priority: "P2",
          source: "datadog",
        },
        priorityId: prio.P2!,
        urgency: "high",
        groupId: authAlert,
        incidentId: await inc(219),
        firstAt: at,
        lastAt: at,
      })
      .returning({ id: alerts.id });
    await tx.insert(alertEvents).values({
      tenantId,
      alertId: child!.id,
      kind: "grouped",
      actorKind: "system",
      payload: { reason: "window", leaderId: authAlert },
      occurredAt: at,
    });
  }
  await mkAlert({
    kind: "sentry",
    title: "Pic de TypeError à la confirmation checkout",
    key: "sentry:88213",
    status: "firing",
    prio: "P3",
    attrs: { service: "checkout-api", team: "Platform", environment: "production" },
    grp: 1,
    first: todayAt("17:28"),
    last: new Date(now.getTime() - 9 * MIN),
    incident: 218,
    url: "https://sentry.io/organizations/skylark/issues/88213/",
    payload: {
      action: "created",
      data: {
        issue: {
          id: "88213",
          title: "TypeError: Cannot read properties of undefined (reading 'total')",
          level: "error",
          web_url: "https://sentry.io/organizations/skylark/issues/88213/",
        },
      },
    },
  });
  await mkAlert({
    kind: "prometheus",
    title: "Disque à plus de 85 % sur db-replica-2",
    key: "prom:DiskAlmostFull:db-replica-2",
    status: "firing",
    prio: "P3",
    attrs: {
      service: "checkout-api",
      team: "Platform",
      environment: "production",
      instance: "db-replica-2",
    },
    grp: 1,
    first: new Date(now.getTime() - 31 * MIN),
    last: new Date(now.getTime() - 31 * MIN),
    payload: {
      status: "firing",
      labels: {
        alertname: "DiskAlmostFull",
        severity: "warning",
        service: "checkout-api",
        instance: "db-replica-2",
      },
      annotations: { summary: "Disk usage above 85 % on db-replica-2" },
    },
  });
  await mkAlert({
    kind: "grafana",
    title: "payments-worker queue depth > 10k",
    key: "grafana:queue-depth",
    status: "resolved",
    prio: "P2",
    attrs: { service: "payments-worker", team: "Payments", environment: "production" },
    grp: 2,
    first: todayAt("13:41"),
    last: todayAt("15:58"),
    resolvedAt: todayAt("15:58"),
    incident: 220,
    acked: { by: "Nadia Benali", at: todayAt("13:44") },
    payload: {
      title: "payments-worker queue depth > 10k",
      state: "alerting",
      ruleId: "queue-depth",
    },
  });
  await mkAlert({
    kind: "datadog",
    title: "checkout-api p99 latency > 2 s (eu-west-1)",
    key: "dd:checkout.p99",
    status: "resolved",
    prio: "P1",
    attrs: {
      service: "checkout-api",
      team: "Platform",
      environment: "production",
      region: "eu-west-1",
    },
    grp: 4,
    first: paris("08-26", "14:02"),
    last: paris("08-26", "15:20"),
    resolvedAt: paris("08-26", "15:20"),
    incident: 217,
    acked: { by: "Amélie Laurent", at: paris("08-26", "14:06") },
    payload: {
      monitor_id: 3991002,
      title: "checkout-api p99 latency > 2 s",
      status: "Triggered",
      priority: "P1",
      scope: "service:checkout-api,env:production,region:eu-west-1",
    },
  });
  await mkAlert({
    kind: "uptime_kuma",
    title: "Certificat expirant sous 72 h — status.skylark.dev",
    key: "kuma:12",
    status: "resolved",
    prio: "P3",
    attrs: { service: "status page", environment: "production" },
    grp: 1,
    first: paris("08-19", "11:30"),
    last: paris("08-19", "16:05"),
    resolvedAt: paris("08-19", "16:05"),
    incident: 213,
    payload: {
      heartbeat: { status: 0, msg: "certificate expires in 71h" },
      monitor: { id: 12, name: "status.skylark.dev", url: "https://status.skylark.dev" },
    },
  });
  await mkAlert({
    kind: "datadog",
    title: "Taux de connexion SSO sous 40 %",
    key: "dd:sso.login_rate",
    status: "resolved",
    prio: "P1",
    attrs: { service: "auth-service", team: "Platform", environment: "production" },
    grp: 2,
    first: paris("08-17", "09:12"),
    last: paris("08-17", "10:40"),
    resolvedAt: paris("08-17", "10:40"),
    incident: 212,
    acked: { by: "Karim Haddad", at: paris("08-17", "09:15") },
    payload: {
      monitor_id: 3877120,
      title: "SSO login success rate below 40 %",
      status: "Triggered",
      priority: "P1",
      scope: "service:auth-service,env:production",
    },
  });

  // The live escalation of the auth alert: level 1 paged Amélie two minutes ago, level 2 in three minutes.
  const entered = new Date(now.getTime() - 2 * MIN);
  const [esc] = await tx
    .insert(escalations)
    .values({
      tenantId,
      pathId: platformPath.id,
      pathVersionId: platformPath.versionId,
      alertId: authAlert,
      incidentId: await inc(219),
      status: "pending",
      urgency: "high",
      priorityRank: 1,
      currentNodeId: "l1",
      nodeEnteredAt: entered,
      attempt: 2,
      nextTickAt: new Date(entered.getTime() + 5 * MIN),
      startedAt: entered,
      triggeredByKind: "system",
      triggeredByName: "Datadog",
      rowVersion: 2,
    })
    .returning({ id: escalations.id });
  await tx.update(alerts).set({ escalationId: esc!.id }).where(eq(alerts.id, authAlert));
  await tx.insert(escalationEvents).values([
    {
      tenantId,
      escalationId: esc!.id,
      kind: "started",
      payload: { path: "Platform primary", version: 7, by: "Datadog" },
      occurredAt: entered,
    },
    {
      tenantId,
      escalationId: esc!.id,
      kind: "condition",
      payload: { nodeId: "c_hours", test: { type: "working_hours" }, result: true },
      occurredAt: entered,
    },
    {
      tenantId,
      escalationId: esc!.id,
      kind: "notified",
      payload: {
        nodeId: "l1",
        attempt: 1,
        urgency: "high",
        members: ["Amélie Laurent"],
        ackTimeoutMinutes: 5,
      },
      occurredAt: entered,
    },
  ]);
  await tx.insert(notificationDeliveries).values([
    {
      tenantId,
      memberId: AL,
      methodKind: "email",
      target: "am…@skylark.dev",
      kind: "escalation",
      urgency: "high",
      escalationId: esc!.id,
      alertId: authAlert,
      status: "sent",
      message: {
        subject: "P2 · Taux d'erreur auth-service à 4,2 % sur 5 min",
        text: "Service auth-service · production",
      },
      sendAfter: entered,
      createdAt: entered,
      sentAt: new Date(entered.getTime() + 2000),
    },
  ]);
  await tx.insert(alertEvents).values({
    tenantId,
    alertId: authAlert,
    kind: "escalated",
    actorKind: "system",
    payload: {
      escalationId: esc!.id,
      nodeId: "l1",
      urgency: "high",
      members: ["Amélie Laurent"],
    },
    occurredAt: entered,
  });

  // Notification methods and rules
  for (const member of DEMO_MEMBERS) {
    await tx.insert(notificationMethods).values({
      tenantId,
      memberId: m(member.name),
      kind: "email",
      value: member.email,
      verifiedAt: paris("07-01", "10:00"),
    });
  }
  await tx.insert(notificationRules).values([
    {
      tenantId,
      memberId: AL,
      urgency: "high",
      steps: [
        { kind: "webpush", delayMinutes: 0 },
        { kind: "email", delayMinutes: 0 },
        { kind: "voice", delayMinutes: 1 },
        { kind: "sms", delayMinutes: 3 },
        { kind: "voice", delayMinutes: 5 },
      ],
    },
    {
      tenantId,
      memberId: AL,
      urgency: "low",
      steps: [
        { kind: "webpush", delayMinutes: 0 },
        { kind: "email", delayMinutes: 0 },
      ],
    },
  ]);
}

type EscalationGraphSeed = NonNullable<(typeof escalationPaths.$inferInsert)["draftGraph"]>;

function defaultMappingsFor(
  kind: (typeof alertSources.$inferInsert)["kind"],
): (typeof alertSources.$inferInsert)["mappings"] {
  switch (kind) {
    case "datadog":
      return [
        { attribute: "service", path: "scope.service", catalogTypeKey: "service" },
        { attribute: "priority", path: "priority" },
        { attribute: "environment", path: "scope.env" },
        { attribute: "region", path: "scope.region" },
      ];
    case "prometheus":
    case "grafana":
      return [
        { attribute: "service", path: "labels.service", catalogTypeKey: "service" },
        { attribute: "environment", path: "labels.env" },
      ];
    case "sentry":
      return [{ attribute: "service", path: "data.event.tags.service", catalogTypeKey: "service" }];
    case "uptime_kuma":
    case "cloudwatch":
      return [{ attribute: "environment", path: "", value: "production" }];
    default:
      return [
        { attribute: "service", path: "service", catalogTypeKey: "service" },
        { attribute: "environment", path: "environment" },
        { attribute: "priority", path: "priority" },
      ];
  }
}

/**
 * The public status page of the design: five components bound to the catalog,
 * their 90 days of history, the public incident of INC-217 with its four
 * updates, the August maintenance, 128 confirmed subscribers, three approved
 * templates. The projection is written so apps/status serves it at once.
 */
async function ensureStatusPage(tx: Tx, ctx: Ctx) {
  const [present] = await tx
    .select({ id: statusPages.id })
    .from(statusPages)
    .where(eq(statusPages.tenantId, tenantId))
    .limit(1);
  if (present) return;
  const AL = ctx.memberId("Amélie Laurent");
  const now = new Date();
  const [page] = await tx
    .insert(statusPages)
    .values({
      tenantId,
      name: "Skylark Status",
      slug: SLUG,
      // The custom domain is unique across the instance: only the demo carries
      // it — and it stays *pending*: a verified domain would make every public
      // link point at status.skylark.dev, which no instance actually serves.
      customDomain: IS_DEMO ? "status.skylark.dev" : null,
      customDomainVerifiedAt: null,
      locale: "en",
      accentColor: "#B4552D",
      noindex: true,
      privacyUrl: "https://skylark.dev/privacy",
      legalUrl: "https://skylark.dev/legal",
      replyTo: "status@skylark.dev",
      minSeverityRank: 1,
      feedHits: 12,
      createdByMemberId: AL,
      createdAt: paris("06-12", "10:00"),
    })
    .returning({ id: statusPages.id });
  const pageId = page!.id;
  // Public status mapping on the default type's statuses.
  const statuses = await tx
    .select()
    .from(incidentStatuses)
    .where(eq(incidentStatuses.typeId, ctx.typeId.default!));
  const map: Record<string, string> = {
    Investigation: "investigating",
    Correction: "identified",
    Surveillance: "monitoring",
  };
  for (const st of statuses)
    if (map[st.name])
      await tx
        .update(incidentStatuses)
        .set({ publicStatus: map[st.name] })
        .where(eq(incidentStatuses.id, st.id));

  const comp: Record<string, string> = {};
  const defs: Array<[string, string]> = [
    ["Checkout", "checkout-api"],
    ["Paiements", "payments-worker"],
    ["Storefront", "web-storefront"],
    ["API", "checkout-api"],
    ["Connexion", "auth-service"],
  ];
  for (const [i, [name, svc]] of defs.entries()) {
    const [row] = await tx
      .insert(statusPageComponents)
      .values({
        tenantId,
        pageId,
        name,
        serviceEntryId: ctx.entryId[svc] ?? null,
        position: i,
        state: "operational",
      })
      .returning({ id: statusPageComponents.id });
    comp[name] = row!.id;
  }
  const [pub] = await tx
    .insert(statusPageIncidents)
    .values({
      tenantId,
      pageId,
      incidentId: await incidentIdByNumber(tx, 217),
      title: "Performance dégradée du checkout",
      status: "resolved",
      impact: "degraded",
      componentIds: [comp.Checkout!, comp.Paiements!],
      startedAt: paris("08-26", "14:17"),
      resolvedAt: paris("08-26", "15:32"),
      createdAt: paris("08-26", "14:17"),
    })
    .returning({ id: statusPageIncidents.id });
  await tx.insert(statusPageIncidentUpdates).values([
    {
      tenantId,
      statusPageIncidentId: pub!.id,
      status: "investigating",
      body: "Certains clients constatent un passage en caisse lent en Europe. Nous investiguons.",
      publishedAt: paris("08-26", "14:17"),
      createdByMemberId: AL,
      notifiedCount: 128,
    },
    {
      tenantId,
      statusPageIncidentId: pub!.id,
      status: "identified",
      body: "Nous avons identifié la cause — un changement de configuration — et procédons au retour arrière.",
      publishedAt: paris("08-26", "14:35"),
      createdByMemberId: AL,
      notifiedCount: 128,
    },
    {
      tenantId,
      statusPageIncidentId: pub!.id,
      status: "monitoring",
      body: "Un correctif est déployé. Les temps de réponse sont repassés sous les seuils normaux ; nous surveillons.",
      publishedAt: paris("08-26", "14:55"),
      createdByMemberId: AL,
      notifiedCount: 128,
    },
    {
      tenantId,
      statusPageIncidentId: pub!.id,
      status: "resolved",
      body: "La latence du checkout est revenue à la normale et reste stable depuis 30 minutes. Cet incident est résolu.",
      publishedAt: paris("08-26", "15:32"),
      createdByMemberId: AL,
      notifiedCount: 128,
    },
  ]);
  const daysAgo = (d: number, h: string) => {
    const base = new Date(now.getTime() - d * DAY);
    const key = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
    return new Date(`${key}T${h}:00+02:00`);
  };
  await tx.insert(componentImpactHistory).values([
    {
      tenantId,
      componentId: comp.Checkout!,
      state: "degraded",
      fromAt: paris("08-26", "14:17"),
      toAt: paris("08-26", "15:32"),
      statusPageIncidentId: pub!.id,
    },
    {
      tenantId,
      componentId: comp.Paiements!,
      state: "degraded",
      fromAt: paris("08-26", "14:17"),
      toAt: paris("08-26", "15:32"),
      statusPageIncidentId: pub!.id,
    },
    {
      tenantId,
      componentId: comp.Storefront!,
      state: "degraded",
      fromAt: daysAgo(18, "09:10"),
      toAt: daysAgo(18, "10:40"),
    },
    {
      tenantId,
      componentId: comp.Storefront!,
      state: "major_outage",
      fromAt: daysAgo(8, "16:05"),
      toAt: daysAgo(8, "17:02"),
    },
    {
      tenantId,
      componentId: comp.Connexion!,
      state: "major_outage",
      fromAt: paris("08-17", "09:12"),
      toAt: paris("08-17", "10:40"),
    },
    {
      tenantId,
      componentId: comp.API!,
      state: "degraded",
      fromAt: daysAgo(40, "03:00"),
      toAt: daysAgo(40, "03:12"),
    },
  ]);
  const [maint] = await tx
    .insert(statusPageMaintenances)
    .values({
      tenantId,
      pageId,
      title: "Maintenance base de données — cluster paiements",
      body: "Migration du cluster de base de données des paiements. Les paiements peuvent être différés de quelques minutes pendant la fenêtre.",
      componentIds: [comp.Paiements!],
      startAt: paris("08-10", "22:00"),
      endAt: paris("08-10", "23:30"),
      status: "completed",
      autoTransitions: true,
      createdByMemberId: AL,
      createdAt: paris("08-03", "11:00"),
    })
    .returning({ id: statusPageMaintenances.id });
  await tx.insert(statusPageMaintenanceUpdates).values([
    {
      tenantId,
      maintenanceId: maint!.id,
      status: "in_progress",
      body: "Maintenance in progress.",
      publishedAt: paris("08-10", "22:00"),
    },
    {
      tenantId,
      maintenanceId: maint!.id,
      status: "completed",
      body: "Maintenance completed as planned.",
      publishedAt: paris("08-10", "23:30"),
    },
  ]);
  await tx.insert(componentImpactHistory).values({
    tenantId,
    componentId: comp.Paiements!,
    state: "maintenance",
    fromAt: paris("08-10", "22:00"),
    toAt: paris("08-10", "23:30"),
    maintenanceId: maint!.id,
  });
  const subs = Array.from({ length: 128 }, (_, i) => ({
    tenantId,
    pageId,
    email: `subscriber${i + 1}@example.com`,
    confirmedAt: new Date(paris("06-12", "10:00").getTime() + i * 5 * HOUR),
    confirmToken: randomBytes(20).toString("hex"),
    unsubscribeToken: randomBytes(20).toString("hex"),
    source: (i < 100 ? "import" : "form") as "import" | "form",
  }));
  await tx.insert(statusPageSubscribers).values(subs);
  await tx.insert(statusPageTemplates).values([
    {
      tenantId,
      pageId,
      name: "Investigation — SEV1/SEV2",
      status: "investigating",
      body: "Certains clients constatent une dégradation. Nous investiguons et publierons un point dans 30 minutes.",
      approved: true,
      position: 0,
    },
    {
      tenantId,
      pageId,
      name: "Surveillance",
      status: "monitoring",
      body: "Un correctif est déployé. Les indicateurs sont repassés sous les seuils normaux ; nous surveillons.",
      approved: true,
      position: 1,
    },
    {
      tenantId,
      pageId,
      name: "Résolu",
      status: "resolved",
      body: "L'incident est résolu et le service est stable. Merci de votre patience.",
      approved: true,
      position: 2,
    },
  ]);
  // The projection, computed here from the rows above (same maths as the product).
  const snapshot = await buildSeedSnapshot(tx, pageId, now);
  await upsertStatusSnapshot({
    pageId,
    tenantId,
    slug: SLUG,
    customDomain: IS_DEMO ? "status.skylark.dev" : null,
    snapshot,
  });
}

/** A minimal snapshot for the seed — the product recomputes it on the first change. */
async function buildSeedSnapshot(
  tx: Tx,
  pageId: string,
  now: Date,
): Promise<Record<string, unknown>> {
  const [page] = await tx.select().from(statusPages).where(eq(statusPages.id, pageId));
  const comps = await tx
    .select()
    .from(statusPageComponents)
    .where(eq(statusPageComponents.pageId, pageId));
  const hist = await tx
    .select()
    .from(componentImpactHistory)
    .where(eq(componentImpactHistory.tenantId, tenantId));
  const incs = await tx
    .select()
    .from(statusPageIncidents)
    .where(eq(statusPageIncidents.pageId, pageId));
  const ups = await tx
    .select()
    .from(statusPageIncidentUpdates)
    .where(eq(statusPageIncidentUpdates.tenantId, tenantId));
  const maints = await tx
    .select()
    .from(statusPageMaintenances)
    .where(eq(statusPageMaintenances.pageId, pageId));
  const mups = await tx
    .select()
    .from(statusPageMaintenanceUpdates)
    .where(eq(statusPageMaintenanceUpdates.tenantId, tenantId));
  const weight: Record<string, number> = {
    operational: 0,
    maintenance: 0,
    degraded: 1,
    partial_outage: 2,
    major_outage: 3,
  };
  const since = now.getTime() - 90 * DAY;
  const nameOf = new Map(comps.map((c) => [c.id, c.name]));
  return {
    page: {
      id: page!.id,
      name: page!.name,
      slug: page!.slug,
      customDomain: page!.customDomain,
      customDomainVerified: true,
      locale: page!.locale,
      accentColor: page!.accentColor,
      noindex: page!.noindex,
      privacyUrl: page!.privacyUrl,
      legalUrl: page!.legalUrl,
    },
    overall: "operational",
    components: comps
      .sort((a, b) => a.position - b.position)
      .map((c) => {
        const mine = hist.filter((h) => h.componentId === c.id);
        let down = 0;
        for (const h of mine)
          if ((weight[h.state] ?? 0) > 0)
            down += Math.max(
              0,
              Math.min((h.toAt ?? now).getTime(), now.getTime()) -
                Math.max(h.fromAt.getTime(), since),
            );
        const ticks: string[] = [];
        for (let d = 29; d >= 0; d--) {
          const end = new Date(now.getTime() - d * DAY);
          end.setUTCHours(23, 59, 59, 999);
          const start = end.getTime() - DAY + 1;
          let worst = "operational";
          for (const h of mine)
            if (
              !((h.toAt ?? now).getTime() < start || h.fromAt.getTime() > end.getTime()) &&
              (weight[h.state] ?? 0) > (weight[worst] ?? 0)
            )
              worst = h.state;
          ticks.push(worst);
        }
        return {
          id: c.id,
          name: c.name,
          groupName: c.groupName,
          state: c.state,
          uptime90: Math.round((1 - down / (90 * DAY)) * 10_000) / 100,
          ticks,
        };
      }),
    incidents: incs.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      impact: i.impact,
      components: i.componentIds.map((id) => nameOf.get(id) ?? "").filter(Boolean),
      startedAt: i.startedAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      updates: ups
        .filter((u) => u.statusPageIncidentId === i.id)
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .map((u) => ({ status: u.status, body: u.body, at: u.publishedAt.toISOString() })),
    })),
    maintenances: maints.map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      status: m.status,
      components: m.componentIds.map((id) => nameOf.get(id) ?? "").filter(Boolean),
      startAt: m.startAt.toISOString(),
      endAt: m.endAt.toISOString(),
      updates: mups
        .filter((u) => u.maintenanceId === m.id)
        .map((u) => ({ status: u.status, body: u.body, at: u.publishedAt.toISOString() })),
    })),
    subscribers: 128,
    generatedAt: now.toISOString(),
  };
}

/** AI governance defaults, a readable call log, and the change events that explain INC-217. */
async function ensureAiAndChanges(tx: Tx, ctx: Ctx) {
  const [present] = await tx
    .select({ id: aiSettings.id })
    .from(aiSettings)
    .where(eq(aiSettings.tenantId, tenantId))
    .limit(1);
  if (present) return;
  const AL = ctx.memberId("Amélie Laurent");
  await tx.insert(aiSettings).values({
    tenantId,
    enabled: true,
    capabilities: {},
    sources: { catalog: true, incidents: true, changeEvents: true, docs: false },
    privateOptIn: false,
    provider: null,
  });
  const inc217 = await incidentIdByNumber(tx, 217);
  await tx.insert(aiCalls).values([
    {
      tenantId,
      capability: "post_mortem",
      provider: "EU inference",
      model: "mistral-large-eu",
      actorKind: "member",
      actorMemberId: AL,
      actorName: "Amélie Laurent",
      incidentId: inc217,
      inputTokens: 6210,
      outputTokens: 1380,
      durationMs: 14200,
      status: "ok",
      createdAt: paris("08-27", "09:40"),
    },
    {
      tenantId,
      capability: "summary",
      provider: "EU inference",
      model: "mistral-large-eu",
      actorKind: "member",
      actorMemberId: AL,
      actorName: "Amélie Laurent",
      incidentId: inc217,
      inputTokens: 2410,
      outputTokens: 210,
      durationMs: 3900,
      status: "ok",
      createdAt: paris("08-26", "15:40"),
    },
    {
      tenantId,
      capability: "follow_ups",
      provider: "EU inference",
      model: "mistral-large-eu",
      actorKind: "member",
      actorMemberId: AL,
      actorName: "Amélie Laurent",
      incidentId: inc217,
      inputTokens: 2380,
      outputTokens: 190,
      durationMs: 4100,
      status: "ok",
      createdAt: paris("08-26", "15:41"),
    },
  ]);
  await tx.insert(changeEvents).values([
    {
      tenantId,
      kind: "deploy",
      title: "payments-worker v2026.08.26-1 — pool size ×2",
      description: "Doubles the database connection pool of payments-worker (PR #482).",
      serviceEntryId: ctx.entryId["payments-worker"] ?? null,
      environment: "production",
      actorName: "CI · github-actions",
      externalRef: "https://github.com/skylark/payments-worker/pull/482",
      payload: { sha: "a3f9c21" },
      occurredAt: paris("08-26", "13:55"),
    },
    {
      tenantId,
      kind: "deploy",
      title: "payments-worker rollback → v2026.08.25-3",
      description: "Rollback of the pool change.",
      serviceEntryId: ctx.entryId["payments-worker"] ?? null,
      environment: "production",
      actorName: "Amélie Laurent",
      externalRef: "https://github.com/skylark/payments-worker/actions/runs/9931",
      payload: { sha: "7c01de4" },
      occurredAt: paris("08-26", "14:52"),
    },
    {
      tenantId,
      kind: "flag",
      title: "checkout.new-address-form → 25 %",
      description: "Progressive rollout of the new address form.",
      serviceEntryId: ctx.entryId["checkout-api"] ?? null,
      environment: "production",
      actorName: "Thomas Moreau",
      externalRef: null,
      payload: {},
      occurredAt: todayAt("11:20"),
    },
    {
      tenantId,
      kind: "config",
      title: "CDN edge config push — cache TTL storefront",
      description: "TTL of storefront HTML lowered to 30 s.",
      serviceEntryId: ctx.entryId["web-storefront"] ?? null,
      environment: "production",
      actorName: "Lucas Girard",
      externalRef: null,
      payload: {},
      occurredAt: todayAt("16:05"),
    },
  ]);
}

/** Two heartbeats and the managed source that carries their alerts: one healthy, one waiting for its first ping. */
async function ensureHeartbeats(tx: Tx, ctx: Ctx) {
  const [present] = await tx
    .select({ id: heartbeats.id })
    .from(heartbeats)
    .where(eq(heartbeats.tenantId, tenantId))
    .limit(1);
  if (present) return;
  const secret = randomBytes(24).toString("hex");
  const [source] = await tx
    .select({ id: alertSources.id })
    .from(alertSources)
    .where(and(eq(alertSources.tenantId, tenantId), eq(alertSources.managed, true)));
  const sourceId =
    source?.id ??
    (
      await tx
        .insert(alertSources)
        .values({
          tenantId,
          kind: "http",
          name: "Heartbeats",
          secretHash: createHash("sha256").update(secret).digest("hex"),
          encryptedSecret: encryptSecret(secret),
          managed: true,
          active: true,
        })
        .returning({ id: alertSources.id })
    )[0]!.id;
  // The ingest endpoint maps a source to its workspace through the directory lookup.
  await tx
    .insert(apiKeyLookup)
    .values({ keyHash: `src:${sourceId}`, tenantId })
    .onConflictDoNothing();
  await tx.insert(heartbeats).values([
    {
      tenantId,
      name: "Sauvegarde nocturne PostgreSQL",
      description: "pg_dump vers le bucket froid, 03:15 Europe/Paris",
      serviceEntryId: ctx.entryId["payments-worker"] ?? null,
      intervalSeconds: 86_400,
      graceSeconds: 3_600,
      encryptedToken: encryptSecret(randomBytes(16).toString("hex")),
      status: "up",
      lastPingAt: new Date(Date.now() - 6 * 3_600_000),
    },
    {
      tenantId,
      name: "Purge des sessions expirées",
      description: "cron toutes les 5 min sur auth-service",
      serviceEntryId: ctx.entryId["auth-service"] ?? null,
      intervalSeconds: 300,
      graceSeconds: 60,
      encryptedToken: encryptSecret(randomBytes(16).toString("hex")),
      status: "waiting",
    },
  ]);
}

/** The workspace's on-call pay rules — French public holidays of 2026, modest hourly rates. */
async function ensurePayRules(tx: Tx) {
  await tx
    .insert(payRules)
    .values({
      tenantId,
      currency: "EUR",
      standbyCents: 250,
      nightCents: 400,
      weekendCents: 500,
      holidayCents: 700,
      nightStart: "22:00",
      nightEnd: "07:00",
      holidays: [
        "2026-01-01",
        "2026-04-06",
        "2026-05-01",
        "2026-05-08",
        "2026-05-14",
        "2026-05-25",
        "2026-07-14",
        "2026-08-15",
        "2026-11-01",
        "2026-11-11",
        "2026-12-25",
      ],
    })
    .onConflictDoNothing();
}
