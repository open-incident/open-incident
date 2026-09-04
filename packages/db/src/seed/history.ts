/**
 * Demonstration history — 90 days of closed incidents for Skylark Systems.
 *
 * Without it, Insights is empty: the design shows an active workspace, not a
 * brand-new one. The incidents are numbered BELOW the designed ones (INC-212 →
 * INC-221 stay the most recent) and are fully deterministic: a congruential
 * generator with a fixed seed produces the same data set on every run, the
 * condition for the demo to stay frozen.
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { incidentEvents, incidents, roleAssignments } from "../schema/app";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** Numbers of the history — INC-212 stays the first designed incident. */
const FIRST_NUMBER = 161;
const LAST_NUMBER = 211;

function makeRandom(seed: number) {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    },
    int(maxExclusive: number): number {
      return Math.floor(this.next() * maxExclusive);
    },
    weighted<T>(entries: [T, number][]): T {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let roll = this.next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1]![0];
    },
    pick<T>(items: readonly T[]): T {
      return items[this.int(items.length)]!;
    },
  };
}

const TITLES = [
  "Latence p99 élevée sur {svc}",
  "Taux d'erreur 5xx au-dessus du seuil — {svc}",
  "File de traitement en retard sur {svc}",
  "Déploiement {svc} annulé après régression",
  "Saturation mémoire des pods {svc}",
  "Timeouts base de données depuis {svc}",
  "Certificat proche expiration — {svc}",
  "Pic de connexions refusées sur {svc}",
  "Cache invalidé en masse — {svc}",
  "Dégradation partielle de {svc} en eu-west-1",
];

type Ctx = {
  memberId: (name: string) => string;
  sevId: Record<string, string>;
  typeId: Record<string, string>;
  statusId: Record<string, string>;
  roleLead: string;
  entryId: Record<string, string>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function installDemoHistory(tx: any, tenantId: string, ctx: Ctx): Promise<number> {
  const existing = await tx
    .select({ number: incidents.number })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        gte(incidents.number, FIRST_NUMBER),
        lt(incidents.number, LAST_NUMBER + 1),
      ),
    );
  const present = new Set<number>(existing.map((r: { number: number }) => r.number));

  const rnd = makeRandom(20260826);
  const services = ["checkout-api", "payments-worker", "web-storefront", "auth-service"] as const;
  const leads = [
    "Amélie Laurent",
    "Karim Haddad",
    "Nadia Benali",
    "Lucas Girard",
    "Thomas Moreau",
  ] as const;
  const anchor = new Date("2026-08-16T12:00:00+02:00").getTime();
  let created = 0;

  for (let n = FIRST_NUMBER; n <= LAST_NUMBER; n++) {
    // The generator advances for every number, present or not: the data set
    // stays identical whichever numbers were already there.
    const daysAgo = 2 + rnd.int(88);
    const hour = rnd.weighted<number>([
      [9, 3],
      [11, 4],
      [14, 4],
      [16, 3],
      [2, 1],
      [4, 1],
      [22, 1],
    ]);
    const svc = rnd.pick(services);
    const sev = rnd.weighted<string>([
      ["SEV1", 1],
      ["SEV2", 3],
      ["SEV3", 6],
      ["SEV4", 4],
    ]);
    const lead = rnd.pick(leads);
    const ttaMin = 1 + rnd.int(sev === "SEV1" ? 4 : 12);
    const ttrMin = 15 + rnd.int(sev === "SEV4" ? 90 : sev === "SEV1" ? 60 : 180);
    const fromAlert = rnd.next() < 0.7;
    const title = rnd.pick(TITLES).replace("{svc}", svc);
    if (present.has(n)) continue;

    const declaredAt = new Date(anchor - daysAgo * DAY + hour * HOUR + rnd.int(60) * 60_000);
    const acknowledgedAt = new Date(declaredAt.getTime() + ttaMin * 60_000);
    const resolvedAt = new Date(declaredAt.getTime() + ttrMin * 60_000);
    const closedAt = new Date(
      resolvedAt.getTime() + (sev === "SEV1" || sev === "SEV2" ? 2 * DAY : 4 * HOUR),
    );

    const [row] = await tx
      .insert(incidents)
      .values({
        tenantId,
        number: n,
        name: title,
        typeId: ctx.typeId.default,
        severityId: ctx.sevId[sev],
        phase: "closed",
        serviceEntryId: ctx.entryId[svc] ?? null,
        source: fromAlert ? "alert" : "web",
        creatorMemberId: fromAlert ? null : ctx.memberId(lead),
        customFields: { region: rnd.next() < 0.8 ? "eu-west-1" : "us-east-1" },
        declaredAt,
        acceptedAt: fromAlert ? acknowledgedAt : null,
        acknowledgedAt,
        resolvedAt,
        closedAt,
        lastActivityAt: closedAt,
      })
      .returning({ id: incidents.id });
    const id = row!.id as string;

    await tx.insert(incidentEvents).values([
      fromAlert
        ? {
            tenantId,
            incidentId: id,
            kind: "created_from_alert",
            actorKind: "system",
            payload: { source: rnd.pick(["Datadog", "Prometheus", "Grafana", "Sentry"]), title },
            occurredAt: declaredAt,
          }
        : {
            tenantId,
            incidentId: id,
            kind: "declared",
            actorKind: "member",
            actorMemberId: ctx.memberId(lead),
            actorName: lead,
            payload: { source: "web", severity: sev, service: svc },
            occurredAt: declaredAt,
          },
      {
        tenantId,
        incidentId: id,
        kind: "escalation_acknowledged",
        actorKind: "member",
        actorMemberId: ctx.memberId(lead),
        actorName: lead,
        payload: { channel: rnd.pick(["voice", "sms", "webpush"]), afterMinutes: ttaMin },
        occurredAt: acknowledgedAt,
      },
      {
        tenantId,
        incidentId: id,
        kind: "resolved",
        actorKind: "member",
        actorMemberId: ctx.memberId(lead),
        actorName: lead,
        payload: { durationMinutes: ttrMin, ttaMinutes: ttaMin },
        occurredAt: resolvedAt,
      },
      {
        tenantId,
        incidentId: id,
        kind: "closed",
        actorKind: "member",
        actorMemberId: ctx.memberId(lead),
        actorName: lead,
        payload: {},
        occurredAt: closedAt,
      },
    ]);
    await tx
      .insert(roleAssignments)
      .values({
        tenantId,
        incidentId: id,
        roleId: ctx.roleLead,
        memberId: ctx.memberId(lead),
        assignedAt: acknowledgedAt,
      })
      .onConflictDoNothing();
    created++;
  }
  return created;
}
