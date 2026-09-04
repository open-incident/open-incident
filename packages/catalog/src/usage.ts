/**
 * What points at an entry or a type — the list shown before a deletion is
 * refused. The catalog triggers real pages, so a delete never cascades into
 * an incident, a status component or a heartbeat silently.
 */
import { and, eq, like, sql } from "drizzle-orm";
import {
  catalogEntries,
  catalogTypes,
  changeEvents,
  followUps,
  heartbeats,
  incidentFields,
  incidents,
  runbooks,
  statusPageComponents,
  type Tx,
} from "@openincident/db";

export type UsageKind =
  | "incidents"
  | "incident_fields"
  | "follow_ups"
  | "status_components"
  | "change_events"
  | "heartbeats"
  | "runbooks"
  | "entries";

export type Usage = { kind: UsageKind; count: number; sample: string[] };

async function countAndSample<T extends { label: string }>(
  kind: UsageKind,
  rows: T[],
): Promise<Usage | null> {
  if (rows.length === 0) return null;
  return { kind, count: rows.length, sample: rows.slice(0, 3).map((r) => r.label) };
}

export async function entryUsages(tx: Tx, tenantId: string, entryId: string): Promise<Usage[]> {
  const out: (Usage | null)[] = [];
  out.push(
    await countAndSample(
      "incidents",
      (
        await tx
          .select({ label: sql<string>`'INC-' || ${incidents.number}` })
          .from(incidents)
          .where(and(eq(incidents.tenantId, tenantId), eq(incidents.serviceEntryId, entryId)))
      ).map((r) => ({ label: r.label })),
    ),
  );
  out.push(
    await countAndSample(
      "incident_fields",
      await tx
        .select({ label: sql<string>`'INC-' || ${incidents.number}` })
        .from(incidents)
        .where(
          and(
            eq(incidents.tenantId, tenantId),
            like(sql`${incidents.customFields}::text`, `%${entryId}%`),
          ),
        ),
    ),
  );
  out.push(
    await countAndSample(
      "follow_ups",
      await tx
        .select({ label: followUps.title })
        .from(followUps)
        .where(and(eq(followUps.tenantId, tenantId), eq(followUps.assigneeTeamEntryId, entryId))),
    ),
  );
  out.push(
    await countAndSample(
      "status_components",
      await tx
        .select({ label: statusPageComponents.name })
        .from(statusPageComponents)
        .where(
          and(
            eq(statusPageComponents.tenantId, tenantId),
            eq(statusPageComponents.serviceEntryId, entryId),
          ),
        ),
    ),
  );
  out.push(
    await countAndSample(
      "change_events",
      await tx
        .select({ label: changeEvents.title })
        .from(changeEvents)
        .where(and(eq(changeEvents.tenantId, tenantId), eq(changeEvents.serviceEntryId, entryId))),
    ),
  );
  out.push(
    await countAndSample(
      "heartbeats",
      await tx
        .select({ label: heartbeats.name })
        .from(heartbeats)
        .where(and(eq(heartbeats.tenantId, tenantId), eq(heartbeats.serviceEntryId, entryId))),
    ),
  );
  out.push(
    await countAndSample(
      "runbooks",
      await tx
        .select({ label: runbooks.title })
        .from(runbooks)
        .where(and(eq(runbooks.tenantId, tenantId), eq(runbooks.serviceEntryId, entryId))),
    ),
  );
  // Other entries whose `entry` attributes point here (a service's owner team…).
  const types = await tx
    .select({ id: catalogTypes.id, attributes: catalogTypes.attributes })
    .from(catalogTypes)
    .where(eq(catalogTypes.tenantId, tenantId));
  const referrers: { label: string }[] = [];
  for (const ty of types) {
    const keys = ty.attributes.filter((a) => a.type === "entry").map((a) => a.key);
    if (keys.length === 0) continue;
    const rows = await tx
      .select({ name: catalogEntries.name, attributes: catalogEntries.attributes })
      .from(catalogEntries)
      .where(and(eq(catalogEntries.tenantId, tenantId), eq(catalogEntries.typeId, ty.id)));
    for (const r of rows)
      if (keys.some((k) => r.attributes[k] === entryId)) referrers.push({ label: r.name });
  }
  out.push(await countAndSample("entries", referrers));
  return out.filter((u): u is Usage => u !== null);
}

export type TypeUsage = {
  kind: "entries" | "incident_fields" | "types";
  count: number;
  sample: string[];
};

export async function typeUsages(tx: Tx, tenantId: string, typeId: string): Promise<TypeUsage[]> {
  const out: TypeUsage[] = [];
  const [type] = await tx
    .select({ key: catalogTypes.key })
    .from(catalogTypes)
    .where(and(eq(catalogTypes.tenantId, tenantId), eq(catalogTypes.id, typeId)));
  if (!type) return out;
  const entries = await tx
    .select({ name: catalogEntries.name })
    .from(catalogEntries)
    .where(and(eq(catalogEntries.tenantId, tenantId), eq(catalogEntries.typeId, typeId)));
  if (entries.length)
    out.push({
      kind: "entries",
      count: entries.length,
      sample: entries.slice(0, 3).map((e) => e.name),
    });
  const fields = await tx
    .select({ label: incidentFields.label })
    .from(incidentFields)
    .where(and(eq(incidentFields.tenantId, tenantId), eq(incidentFields.catalogTypeId, typeId)));
  if (fields.length)
    out.push({
      kind: "incident_fields",
      count: fields.length,
      sample: fields.slice(0, 3).map((f) => f.label),
    });
  const others = await tx
    .select({ name: catalogTypes.name, attributes: catalogTypes.attributes })
    .from(catalogTypes)
    .where(eq(catalogTypes.tenantId, tenantId));
  const referring = others.filter((o) =>
    o.attributes.some((a) => a.type === "entry" && a.refTypeKey === type.key),
  );
  if (referring.length)
    out.push({
      kind: "types",
      count: referring.length,
      sample: referring.slice(0, 3).map((o) => o.name),
    });
  return out;
}
