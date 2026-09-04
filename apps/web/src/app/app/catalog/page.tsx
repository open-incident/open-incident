import Link from "next/link";
import {
  withTenant,
  catalogEntries,
  catalogTypes,
  incidents,
  followUps,
  members,
} from "@openincident/db";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { CORE_TYPE_KEYS } from "@openincident/catalog";
import { getT } from "@/i18n/server";
import { hasPermission, isManager, requireMember } from "@/lib/session";
import { EntryDialog } from "./entry-dialog";
import { TypeDialog } from "./type-dialog";
import { ImportDialog } from "./import-dialog";
import { runbooksForService } from "@openincident/ai";
import { createRunbook, deleteRunbook, refreshRunbookAction } from "./actions";

type Entry = typeof catalogEntries.$inferSelect;

/**
 * CA-01 — the catalog: types on the left, one card per entry in the middle,
 * the selected entry on the right with its routing chain, its attributes and
 * what references it. The chain draws the link the routing will follow —
 * alert attribute → service → owner team → escalation path — from the entries'
 * own attributes; the path itself is a name until the on-call milestone.
 */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; entry?: string; q?: string; error?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const params = await searchParams;

  const data = await withTenant(tenant.id, async (tx) => {
    const types = await tx
      .select()
      .from(catalogTypes)
      .where(eq(catalogTypes.tenantId, tenant.id))
      .orderBy(asc(catalogTypes.position));
    const entries = await tx
      .select()
      .from(catalogEntries)
      .where(eq(catalogEntries.tenantId, tenant.id))
      .orderBy(asc(catalogEntries.name));
    const since = new Date(Date.now() - 90 * 86_400_000);
    const incCounts = await tx
      .select({
        serviceEntryId: incidents.serviceEntryId,
        n: sql<number>`count(*)`.mapWith(Number),
      })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenant.id), gte(incidents.declaredAt, since)))
      .groupBy(incidents.serviceEntryId);
    const fuCounts = await tx
      .select({ teamId: followUps.assigneeTeamEntryId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(followUps)
      .where(eq(followUps.tenantId, tenant.id))
      .groupBy(followUps.assigneeTeamEntryId);
    const memberRows = await tx
      .select({ id: members.id, email: members.email, name: members.name })
      .from(members)
      .where(eq(members.tenantId, tenant.id))
      .orderBy(asc(members.name));
    return {
      types,
      entries,
      members: memberRows,
      incCounts: new Map(incCounts.map((c) => [c.serviceEntryId, c.n])),
      fuCounts: new Map(fuCounts.map((c) => [c.teamId, c.n])),
    };
  });

  const typeByKey = new Map(data.types.map((ty) => [ty.key, ty]));
  type TypeRow = (typeof data.types)[number];
  const isCore = (ty: TypeRow) => (CORE_TYPE_KEYS as readonly string[]).includes(ty.key);
  /** Built-in types keep their translated singular; a custom type is called what its author called it. */
  const typeLabel = (ty: TypeRow) =>
    isCore(ty) ? t(`catalog.type.${ty.key as "service" | "team" | "environment"}`) : ty.name;
  const manager = isManager(member);
  const canAct = manager || hasPermission(member, "catalog.entries");
  const selectedType =
    data.types.find((ty) => ty.key === params.type) ??
    (params.entry
      ? data.types.find((ty) => ty.id === data.entries.find((e) => e.name === params.entry)?.typeId)
      : undefined) ??
    typeByKey.get("service") ??
    data.types[0];
  if (!selectedType) return null;
  const ofType = data.entries.filter((e) => e.typeId === selectedType.id);
  const q = (params.q ?? "").trim().toLowerCase();
  const filtered = q
    ? ofType.filter((e) => `${e.name} ${e.description ?? ""}`.toLowerCase().includes(q))
    : ofType;
  const selected = ofType.find((e) => e.name === params.entry) ?? filtered[0] ?? ofType[0] ?? null;
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  const entryName = (id: unknown) => (typeof id === "string" ? (byId.get(id)?.name ?? null) : null);

  const ownerOf = (e: Entry) => entryName(e.attributes.owner);
  const servicesOwnedBy = (teamId: string) =>
    data.entries.filter((e) => e.attributes.owner === teamId);
  const membersOf = (e: Entry) =>
    Array.isArray(e.attributes.members) ? (e.attributes.members as string[]).length : 0;
  /** Entries whose `entry` attributes point at this one — the generic reference count. */
  const referrersOf = (e: Entry) => {
    const ty = data.types.find((x) => x.id === e.typeId);
    if (!ty) return 0;
    const keysByType = data.types.map((other) => ({
      typeId: other.id,
      keys: other.attributes
        .filter((a) => a.type === "entry" && a.refTypeKey === ty.key)
        .map((a) => a.key),
    }));
    return data.entries.filter((o) =>
      keysByType.some(
        (k) => k.typeId === o.typeId && k.keys.some((key) => o.attributes[key] === e.id),
      ),
    ).length;
  };
  const typeOpts = data.types.map((ty) => ({
    id: ty.id,
    key: ty.key,
    name: ty.name,
    label: typeLabel(ty),
    description: ty.description,
    attributes: ty.attributes,
    locked: ty.locked,
  }));
  const entryOpts = data.entries.map((e) => ({ id: e.id, typeId: e.typeId, name: e.name }));
  const selectedTypeOpt = typeOpts.find((ty) => ty.id === selectedType.id)!;

  const meta = (e: Entry): string => {
    if (selectedType.key === "service")
      return t("catalog.meta.incidents", { count: data.incCounts.get(e.id) ?? 0 });
    if (selectedType.key === "team")
      return `${t("catalog.meta.members", { count: membersOf(e) })} · ${t("catalog.meta.services", { count: servicesOwnedBy(e.id).length })}`;
    if (selectedType.key !== "environment")
      return t("catalog.meta.references", { count: referrersOf(e) });
    return t("catalog.meta.incidents", {
      count: data.entries
        .filter(
          (s) =>
            typeof s.attributes.environments === "string" &&
            (s.attributes.environments as string).includes(e.name),
        )
        .reduce((n, s) => n + (data.incCounts.get(s.id) ?? 0), 0),
    });
  };
  const tierTone = (tier: string | null) =>
    tier === "tier 1" || tier === "pages"
      ? { bg: "var(--dang-t)", ink: "var(--dang)" }
      : tier === "tier 2"
        ? { bg: "var(--wait-t)", ink: "var(--wait)" }
        : { bg: "var(--sunk)", ink: "var(--ink-2)" };
  const tierOf = (e: Entry): string | null =>
    typeof e.attributes.tier === "string"
      ? (e.attributes.tier as string)
      : typeof e.attributes.paging === "string"
        ? e.attributes.paging === "pages"
          ? t("catalog.paging.pages")
          : t("catalog.paging.silent")
        : null;
  const icon =
    {
      service: "M6 3h12l3 6-9 12L3 9l3-6zM3 9h18",
      team: "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M21 21v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75",
      environment:
        "M12 2C7.03 2 3 3.34 3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5c0-1.66-4.03-3-9-3M3 5c0 1.66 4.03 3 9 3s9-1.34 9-3",
    }[selectedType.key] ?? "M12 2v20";

  const chain = selected
    ? selectedType.key === "service"
      ? [
          {
            label: t("catalog.chain.alert"),
            labelInk: "var(--ink-3)",
            value: `${t("catalog.chain.attributeService")} = ${selected.name}`,
            mono: true,
            bg: "var(--sunk)",
            line: "var(--line)",
            dot: "var(--wait)",
            sub: t("catalog.chain.extractedByRoute"),
          },
          {
            label: t("catalog.chain.service"),
            labelInk: "var(--brand)",
            value: selected.name,
            mono: true,
            bg: "var(--brand-t)",
            line: "var(--brand-b)",
            dot: "var(--brand)",
          },
          {
            label: t("catalog.chain.ownerTeam"),
            labelInk: "var(--ink-3)",
            value: ownerOf(selected) ?? "—",
            mono: false,
            bg: "var(--panel)",
            line: "var(--line)",
            dot: "var(--viol)",
            sub: t("catalog.chain.viaOwner"),
          },
          {
            label: t("catalog.chain.escalationPath"),
            labelInk: "var(--ink-3)",
            value:
              (byId.get(String(selected.attributes.owner))?.attributes.escalation_path as
                string | undefined) ?? "—",
            mono: false,
            bg: "var(--panel)",
            line: "var(--line)",
            dot: "var(--dang)",
            sub: t("catalog.chain.pathHint"),
            href: "/app/on-call/paths",
          },
        ]
      : selectedType.key === "team"
        ? [
            {
              label: t("catalog.chain.team"),
              labelInk: "var(--brand)",
              value: selected.name,
              mono: false,
              bg: "var(--brand-t)",
              line: "var(--brand-b)",
              dot: "var(--brand)",
            },
            {
              label: t("catalog.chain.escalationPath"),
              labelInk: "var(--ink-3)",
              value: (selected.attributes.escalation_path as string | undefined) ?? "—",
              mono: false,
              bg: "var(--panel)",
              line: "var(--line)",
              dot: "var(--dang)",
              sub: t("catalog.chain.pathHint"),
              href: "/app/on-call/paths",
            },
          ]
        : []
    : [];

  const serviceRunbooks =
    selected && selectedType.key === "service"
      ? await withTenant(tenant.id, (tx) => runbooksForService(tx, tenant.id, selected.id))
      : [];
  const attrs = selected
    ? selectedType.attributes.map((def) => {
        const raw = selected.attributes[def.key];
        let value = "—";
        if (def.type === "entry") value = entryName(raw) ?? "—";
        else if (def.type === "member_list")
          value = Array.isArray(raw) ? t("catalog.meta.members", { count: raw.length }) : "—";
        else if (def.type === "select" && def.key === "paging")
          value =
            raw === "pages"
              ? t("catalog.paging.pages")
              : raw === "silent"
                ? t("catalog.paging.silent")
                : "—";
        else value = typeof raw === "string" && raw ? raw : "—";
        return {
          key: def.key,
          label: def.label,
          value,
          mono: def.type === "text" && (def.key === "repository" || def.key === "chat_channel"),
        };
      })
    : [];

  const linkTo = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { type: selectedType.key, entry: selected?.name, q: params.q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/app/catalog?${p.toString()}`;
  };

  return (
    <>
      <aside
        aria-label={t("catalog.typesLabel")}
        style={{
          width: 232,
          flex: "none",
          background: "var(--panel)",
          borderRight: "1px solid var(--line)",
          padding: "16px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflow: "auto",
        }}
      >
        <div className="oi-eyebrow" style={{ padding: "0 10px 8px" }}>
          {t("catalog.typesLabel")}
        </div>
        {data.types.map((ty) => {
          const active = ty.id === selectedType.id;
          return (
            <Link
              key={ty.id}
              href={`/app/catalog?type=${ty.key}`}
              aria-current={active ? "page" : undefined}
              className={active ? undefined : "oi-hover"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 10px",
                borderRadius: 9,
                background: active ? "var(--brand-t)" : "transparent",
                color: active ? "var(--brand)" : "var(--ink-2)",
                fontWeight: active ? 600 : 450,
                fontSize: 13.5,
                textDecoration: "none",
              }}
            >
              <span style={{ flex: 1 }}>{ty.name}</span>
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {data.entries.filter((e) => e.typeId === ty.id).length}
              </span>
            </Link>
          );
        })}
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "var(--sunk)",
            borderRadius: 12,
            fontSize: 12,
            color: "var(--ink-3)",
            lineHeight: 1.5,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {t("catalog.typesIntro")}
          {manager && (
            <TypeDialog
              mode="create"
              types={typeOpts}
              trigger={{
                height: 30,
                padding: "0 12px",
                borderRadius: 8,
                background: "var(--panel)",
                color: "var(--brand)",
                border: "1px solid var(--brand-b)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                alignSelf: "flex-start",
              }}
            />
          )}
        </div>
        <span style={{ flex: 1 }} />
        <div
          style={{
            margin: "8px 4px 4px",
            padding: "11px 13px",
            background: "var(--brand-t)",
            borderRadius: 12,
            fontSize: 12,
            color: "var(--ink-2)",
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: "var(--brand)" }}>{t("catalog.spineTitle")}</strong>{" "}
          {t("catalog.spineBody")}
        </div>
      </aside>

      <section
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 20px",
            flex: "none",
            flexWrap: "wrap",
          }}
        >
          <h1 className="oi-title" style={{ margin: 0 }}>
            {selectedType.name}
          </h1>
          <span
            style={{
              padding: "2px 9px",
              borderRadius: 999,
              background: "var(--brand-t)",
              color: "var(--brand)",
              fontSize: 12,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {filtered.length}
          </span>
          <span style={{ flex: 1 }} />
          <form
            method="get"
            action="/app/catalog"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              height: 34,
              padding: "0 12px",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 9,
              width: 220,
            }}
          >
            <input type="hidden" name="type" value={selectedType.key} />
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="var(--ink-3)"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder={t("catalog.filterPlaceholder")}
              aria-label={t("catalog.filterPlaceholder")}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 13,
                minWidth: 0,
              }}
            />
          </form>
          {selectedType.locked && (
            <span
              data-testid="type-locked"
              title={t("catalog.lockedNote")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 34,
                padding: "0 12px",
                borderRadius: 9,
                background: "var(--sunk)",
                color: "var(--ink-2)",
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              {t("catalog.locked")}
            </span>
          )}
          {manager && (
            <TypeDialog
              mode="edit"
              types={typeOpts}
              type={selectedTypeOpt}
              isCore={isCore(selectedType)}
            />
          )}
          {manager && !selectedType.locked && <ImportDialog type={selectedTypeOpt} />}
          {canAct && !selectedType.locked && (
            <EntryDialog
              mode="create"
              types={typeOpts}
              entries={entryOpts}
              members={data.members}
              initialTypeKey={selectedType.key}
            />
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "auto",
              padding: "0 20px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {filtered.map((e) => {
              const active = selected?.id === e.id;
              const tier = tierOf(e);
              const tone = tierTone(
                typeof e.attributes.tier === "string"
                  ? (e.attributes.tier as string)
                  : typeof e.attributes.paging === "string"
                    ? (e.attributes.paging as string)
                    : null,
              );
              const owner = ownerOf(e);
              return (
                <Link
                  key={e.id}
                  href={linkTo({ entry: e.name })}
                  className="oi-card"
                  aria-current={active ? "true" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "13px 16px",
                    background: "var(--panel)",
                    border: `1px solid ${active ? "var(--brand-b)" : "var(--line)"}`,
                    borderRadius: 13,
                    boxShadow: active ? "var(--focus-ring)" : "var(--shadow-card)",
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      flex: "none",
                      borderRadius: 9,
                      background: "var(--brand-t)",
                      color: "var(--brand)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d={icon} />
                    </svg>
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 13,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          minWidth: 0,
                        }}
                      >
                        {e.name}
                      </span>
                      {tier && (
                        <span
                          style={{
                            flex: "none",
                            padding: "1px 8px",
                            borderRadius: 999,
                            background: tone.bg,
                            color: tone.ink,
                            fontSize: 10.5,
                            fontWeight: 700,
                          }}
                        >
                          {tier}
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: "var(--ink-3)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {e.description ?? ""}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      {owner && (
                        <span
                          style={{
                            flex: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "2px 9px",
                            borderRadius: 999,
                            background: "var(--sunk)",
                            color: "var(--ink-2)",
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {owner}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 11.5,
                          color: "var(--ink-3)",
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {meta(e)}
                      </span>
                    </span>
                  </span>
                </Link>
              );
            })}
            {filtered.length === 0 && (
              <div
                style={{
                  padding: 28,
                  border: "1.5px dashed var(--line)",
                  borderRadius: 14,
                  textAlign: "center",
                  color: "var(--ink-3)",
                  fontSize: 13.5,
                  background: "var(--panel)",
                }}
              >
                {q ? t("catalog.noMatch", { query: params.q ?? "" }) : t("catalog.empty")}
              </div>
            )}
          </div>

          {selected && (
            <aside
              aria-label={selected.name}
              style={{
                width: 304,
                flex: "none",
                borderLeft: "1px solid var(--line)",
                background: "var(--panel)",
                overflow: "auto",
                padding: "16px 16px 24px",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600 }}>
                    {selected.name}
                  </span>
                  <span
                    style={{
                      padding: "1px 8px",
                      borderRadius: 999,
                      background: "var(--sunk)",
                      color: "var(--ink-2)",
                      fontSize: 10.5,
                      fontWeight: 700,
                    }}
                  >
                    {typeLabel(selectedType)}
                  </span>
                  <span style={{ flex: 1 }} />
                  {canAct && !selectedType.locked && (
                    <EntryDialog
                      mode="edit"
                      types={typeOpts}
                      entries={entryOpts}
                      members={data.members}
                      initialTypeKey={selectedType.key}
                      entry={{
                        id: selected.id,
                        name: selected.name,
                        description: selected.description,
                        externalId: selected.externalId,
                        attributes: selected.attributes,
                      }}
                      trigger={{
                        height: 26,
                        padding: "0 10px",
                        borderRadius: 7,
                        background: "var(--panel)",
                        color: "var(--ink-2)",
                        border: "1px solid var(--line)",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    />
                  )}
                </div>
                {selectedType.locked && (
                  <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                    {t("catalog.lockedNote")}
                  </div>
                )}
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  {selected.description}
                </div>
              </div>
              {chain.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="oi-eyebrow">{t("catalog.routingChain")}</div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {chain.map((c, i) => (
                      <div key={i} style={{ display: "flex", gap: 10 }}>
                        <span
                          aria-hidden
                          style={{
                            flex: "none",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            width: 12,
                          }}
                        >
                          <span
                            style={{
                              width: 9,
                              height: 9,
                              borderRadius: "50%",
                              background: c.dot,
                              marginTop: 14,
                            }}
                          />
                          {i < chain.length - 1 && (
                            <span style={{ flex: 1, width: 1, background: "var(--line)" }} />
                          )}
                        </span>
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            border: `1px solid ${c.line}`,
                            background: c.bg,
                            borderRadius: 10,
                            padding: "8px 11px",
                            marginBottom: 6,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              letterSpacing: ".08em",
                              textTransform: "uppercase",
                              color: c.labelInk,
                            }}
                          >
                            {c.label}
                          </div>
                          <div
                            style={{
                              fontSize: 12.5,
                              fontWeight: 600,
                              fontFamily: c.mono ? "var(--font-mono)" : undefined,
                              marginTop: 1,
                            }}
                          >
                            {"href" in c && c.href ? (
                              <Link href={c.href} className="oi-link">
                                {c.value}
                              </Link>
                            ) : (
                              c.value
                            )}
                          </div>
                          {c.sub && (
                            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>
                              {c.sub}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                    {t("catalog.chainNote")}
                  </div>
                </div>
              )}
              {selectedType.key === "service" && (
                <>
                  <div style={{ height: 1, background: "var(--line-2)" }} />
                  <div
                    data-testid="runbooks"
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <div className="oi-eyebrow">{t("catalog.runbooks.title")}</div>
                    {serviceRunbooks.length === 0 && (
                      <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                        {t("catalog.runbooks.none")}
                      </div>
                    )}
                    {serviceRunbooks.map((r) => (
                      <div
                        key={r.id}
                        data-testid="runbook-row"
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          fontSize: 12.5,
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {r.sourceUrl ? (
                            <a
                              href={r.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="oi-link"
                              style={{ fontWeight: 600, display: "block" }}
                            >
                              {r.title}
                            </a>
                          ) : (
                            <span style={{ fontWeight: 600, display: "block" }}>{r.title}</span>
                          )}
                          <span
                            style={{
                              fontSize: 11.5,
                              color: r.fetchError ? "var(--dang)" : "var(--ink-3)",
                            }}
                          >
                            {r.fetchError
                              ? t("catalog.runbooks.fetchError", { error: r.fetchError })
                              : r.fetchedAt
                                ? t("catalog.runbooks.fetchedAt", {
                                    when: t.fmt.relative(r.fetchedAt),
                                  })
                                : t("catalog.runbooks.pasted", { chars: r.content.length })}
                          </span>
                        </span>
                        {isManager(member) && (
                          <span style={{ display: "flex", gap: 4, flex: "none" }}>
                            {r.sourceUrl && (
                              <form action={refreshRunbookAction}>
                                <input type="hidden" name="id" value={r.id} />
                                <input type="hidden" name="entryName" value={selected.name} />
                                <button
                                  type="submit"
                                  className="oi-hover"
                                  title={t("catalog.runbooks.refresh")}
                                  style={{
                                    height: 24,
                                    padding: "0 8px",
                                    border: "1px solid var(--line)",
                                    borderRadius: 6,
                                    background: "var(--panel)",
                                    fontSize: 11,
                                    cursor: "pointer",
                                  }}
                                >
                                  ↻
                                </button>
                              </form>
                            )}
                            <form action={deleteRunbook}>
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="entryName" value={selected.name} />
                              <button
                                type="submit"
                                className="oi-hover-dang"
                                aria-label={t("common.delete")}
                                style={{
                                  height: 24,
                                  padding: "0 8px",
                                  border: "1px solid var(--line)",
                                  borderRadius: 6,
                                  background: "var(--panel)",
                                  fontSize: 11,
                                  color: "var(--dang)",
                                  cursor: "pointer",
                                }}
                              >
                                ✕
                              </button>
                            </form>
                          </span>
                        )}
                      </div>
                    ))}
                    {isManager(member) && (
                      <form
                        action={createRunbook}
                        data-testid="runbook-form"
                        style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}
                      >
                        <input type="hidden" name="entryId" value={selected.id} />
                        <input type="hidden" name="entryName" value={selected.name} />
                        <input
                          name="title"
                          required
                          placeholder={t("catalog.runbooks.name")}
                          className="oi-field"
                          style={{
                            height: 30,
                            padding: "0 10px",
                            border: "1px solid var(--line)",
                            borderRadius: 8,
                            fontSize: 12.5,
                            background: "var(--panel)",
                            outline: "none",
                          }}
                        />
                        <input
                          name="sourceUrl"
                          type="url"
                          placeholder={t("catalog.runbooks.url")}
                          className="oi-field"
                          style={{
                            height: 30,
                            padding: "0 10px",
                            border: "1px solid var(--line)",
                            borderRadius: 8,
                            fontSize: 12,
                            fontFamily: "var(--font-mono)",
                            background: "var(--panel)",
                            outline: "none",
                          }}
                        />
                        <textarea
                          name="content"
                          rows={3}
                          placeholder={t("catalog.runbooks.content")}
                          className="oi-field"
                          style={{
                            padding: "8px 10px",
                            border: "1px solid var(--line)",
                            borderRadius: 8,
                            fontSize: 12.5,
                            background: "var(--panel)",
                            outline: "none",
                            resize: "vertical",
                            fontFamily: "inherit",
                          }}
                        />
                        {params.error === "runbook" && (
                          <div role="alert" style={{ fontSize: 12, color: "var(--dang)" }}>
                            {t("catalog.runbooks.error")}
                          </div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11.5, color: "var(--ink-3)", flex: 1 }}>
                            {t("catalog.runbooks.hint")}
                          </span>
                          <button
                            type="submit"
                            data-testid="runbook-save"
                            style={{
                              height: 28,
                              padding: "0 11px",
                              borderRadius: 8,
                              background: "var(--brand)",
                              color: "#fff",
                              border: 0,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            {t("catalog.runbooks.add")}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </>
              )}
              <div style={{ height: 1, background: "var(--line-2)" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="oi-eyebrow">{t("catalog.attributes")}</div>
                {attrs.map((a) => (
                  <div
                    key={a.key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--ink-3)", flex: "none" }}>{a.label}</span>
                    <span
                      style={{
                        fontWeight: 500,
                        fontFamily: a.mono ? "var(--font-mono)" : undefined,
                        fontSize: a.mono ? 11.5 : 13,
                        textAlign: "right",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.value}
                    </span>
                  </div>
                ))}
                {selected.externalId && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--ink-3)", flex: "none" }}>external_id</span>
                    <span
                      style={{ fontWeight: 500, fontFamily: "var(--font-mono)", fontSize: 11.5 }}
                    >
                      {selected.externalId}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ height: 1, background: "var(--line-2)" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="oi-eyebrow">{t("catalog.referencedBy")}</div>
                {selectedType.key === "service" && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--ink-2)" }}>{t("catalog.ref.incidents90")}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {data.incCounts.get(selected.id) ?? 0}
                    </span>
                  </div>
                )}
                {selectedType.key === "team" && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: "var(--ink-2)" }}>{t("catalog.ref.services")}</span>
                      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {servicesOwnedBy(selected.id).length}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: "var(--ink-2)" }}>{t("catalog.ref.followUps")}</span>
                      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {data.fuCounts.get(selected.id) ?? 0}
                      </span>
                    </div>
                  </>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "var(--ink-2)" }}>{t("catalog.ref.entries")}</span>
                  <span
                    data-testid="ref-entries"
                    style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                  >
                    {referrersOf(selected)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-3)",
                    lineHeight: 1.5,
                    borderTop: "1px solid var(--line-2)",
                    paddingTop: 8,
                  }}
                >
                  {t("catalog.deleteNote")}
                </div>
              </div>
            </aside>
          )}
        </div>
      </section>
    </>
  );
}
