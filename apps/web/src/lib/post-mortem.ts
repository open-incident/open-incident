/**
 * The post-mortem as a document: its template (the workspace's or the
 * product's six sections), its row created on demand, its history written at
 * every change, and the blocks the editor can insert — the timeline, the
 * follow-ups, the impact metrics — rendered from the incident's own rows.
 */
import { desc, eq } from "drizzle-orm";
import {
  postMortemComments,
  postMortemRevisions,
  postMortems,
  type PostMortemRevisionKind,
  type PostMortemTemplateSection,
  type Tx,
} from "@openincident/db";
import type { Translate } from "@/i18n/server";
import type { IncidentDetail } from "@/lib/incidents";
import { renderEvent } from "@/lib/timeline";
import { markdownTable } from "@/lib/markdown";

export type Section = { key: string; title: string; body: string };
export type PostMortemRow = typeof postMortems.$inferSelect;
export type Actor = { memberId: string | null; name: string };

export const BUILT_IN_KEYS = [
  "summary",
  "impact",
  "timeline",
  "root_cause",
  "went_well",
  "improve",
] as const;
export type BuiltInKey = (typeof BUILT_IN_KEYS)[number];
export const isBuiltIn = (key: string): key is BuiltInKey =>
  (BUILT_IN_KEYS as readonly string[]).includes(key);

/** The six built-in sections read the dictionary; a workspace's own keep the words it chose. */
export function sectionTitle(sec: { key: string; title: string }, t: Translate): string {
  return isBuiltIn(sec.key) ? t(`postMortem.section.${sec.key}`) : sec.title;
}

export function sectionHint(
  sec: { key: string },
  template: PostMortemTemplateSection[],
  t: Translate,
): string {
  const own = template.find((x) => x.key === sec.key)?.hint;
  if (own) return own;
  return isBuiltIn(sec.key) ? t(`postMortem.hint.${sec.key}`) : "";
}

export function defaultTemplate(t: Translate): PostMortemTemplateSection[] {
  return BUILT_IN_KEYS.map((key) => ({
    key,
    title: t(`postMortem.section.${key}`),
    hint: t(`postMortem.hint.${key}`),
  }));
}

export function templateFor(
  workspace: { postMortemTemplate: PostMortemTemplateSection[] | null },
  t: Translate,
): PostMortemTemplateSection[] {
  return workspace.postMortemTemplate && workspace.postMortemTemplate.length > 0
    ? workspace.postMortemTemplate
    : defaultTemplate(t);
}

/** A key for a section a person adds: from its title, unique in the document. */
export function keyFor(title: string, taken: string[]): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "section";
  let key = base;
  let i = 2;
  while (taken.includes(key)) key = `${base}_${i++}`;
  return key;
}

/** The document exists as soon as someone opens it: empty sections from the template. */
export async function ensurePostMortem(
  tx: Tx,
  tenantId: string,
  incidentId: string,
  template: PostMortemTemplateSection[],
  actor: Actor,
): Promise<PostMortemRow> {
  const [existing] = await tx
    .select()
    .from(postMortems)
    .where(eq(postMortems.incidentId, incidentId));
  if (existing) return existing;
  const [row] = await tx
    .insert(postMortems)
    .values({
      tenantId,
      incidentId,
      status: "in_progress",
      sections: template.map((s) => ({ key: s.key, title: s.title, body: "" })),
      aiDrafted: false,
      ownerMemberId: actor.memberId,
      updatedByMemberId: actor.memberId,
      updatedByName: actor.name,
    })
    .returning();
  return row!;
}

/** One line of history — the snapshot AFTER the change, so a restore is one write. */
export async function recordRevision(
  tx: Tx,
  tenantId: string,
  pm: { id: string; title: string | null; sections: Section[] },
  kind: PostMortemRevisionKind,
  actor: Actor,
  sectionKey: string | null = null,
): Promise<void> {
  await tx.insert(postMortemRevisions).values({
    tenantId,
    postMortemId: pm.id,
    kind,
    sectionKey,
    title: pm.title,
    sections: pm.sections,
    actorMemberId: actor.memberId,
    actorName: actor.name,
  });
  await tx
    .update(postMortems)
    .set({ updatedByMemberId: actor.memberId, updatedByName: actor.name, updatedAt: new Date() })
    .where(eq(postMortems.id, pm.id));
}

export type Revision = typeof postMortemRevisions.$inferSelect;
export type Comment = typeof postMortemComments.$inferSelect;

export async function loadHistory(
  tx: Tx,
  postMortemId: string,
  limit = 40,
): Promise<{ revisions: Revision[]; comments: Comment[] }> {
  const revisions = await tx
    .select()
    .from(postMortemRevisions)
    .where(eq(postMortemRevisions.postMortemId, postMortemId))
    .orderBy(desc(postMortemRevisions.createdAt))
    .limit(limit);
  const comments = await tx
    .select()
    .from(postMortemComments)
    .where(eq(postMortemComments.postMortemId, postMortemId))
    .orderBy(desc(postMortemComments.createdAt));
  return { revisions, comments };
}

/** The people who touched the document, most recent first, without repeats. */
export function contributors(revisions: Revision[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of revisions) {
    const name = r.actorName ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

const TIMELINE_KINDS = new Set([
  "declared",
  "created_from_alert",
  "alert_attached",
  "accepted",
  "severity_changed",
  "status_changed",
  "update_posted",
  "role_assigned",
  "escalation_triggered",
  "escalation_acknowledged",
  "deployment",
  "resolved",
  "reopened",
  "closed",
  "investigation",
  "note",
]);

/** The incident's key events as a markdown list — what the "Insert timeline" block pastes. */
export function timelineMarkdown(inc: IncidentDetail, t: Translate): string {
  const lines = inc.events
    .filter((e) => TIMELINE_KINDS.has(e.kind) && (e.kind !== "note" || e.pinned))
    .slice(0, 60)
    .map((e) => {
      const item = renderEvent(e, t);
      const when = t.fmt.dateTime(item.at, t.timeZone);
      return `- **${when}** — ${item.title}${item.description ? ` · ${item.description}` : ""}`;
    });
  return lines.join("\n");
}

/** The follow-ups as a table — title, priority, owner, status, tracker. */
export function followUpsMarkdown(inc: IncidentDetail, t: Translate): string {
  if (inc.followUps.length === 0) return "";
  return markdownTable(
    [
      t("postMortem.block.fuTitle"),
      t("postMortem.block.fuPriority"),
      t("postMortem.block.fuOwner"),
      t("postMortem.block.fuStatus"),
    ],
    inc.followUps.map((f) => [
      f.externalRef?.url ? `[${f.title}](${f.externalRef.url})` : f.title,
      f.priorityName ?? "—",
      f.assigneeName ?? "—",
      `${t(`followUp.status.${f.status}`)}${f.externalRef ? ` (${f.externalRef.key})` : ""}`,
    ]),
  );
}

/** Detection, acknowledgement, resolution and the durations between them. */
export function impactMarkdown(inc: IncidentDetail, t: Translate): string {
  const rows: string[][] = [
    [t("incident.metric.detected"), t.fmt.dateTime(inc.row.declaredAt, t.timeZone)],
  ];
  if (inc.acknowledgedAt)
    rows.push([
      t("incident.metric.acknowledged"),
      `${t.fmt.dateTime(inc.acknowledgedAt, t.timeZone)} · ${t("incident.metric.tta", {
        duration: t.fmt.duration(
          (inc.acknowledgedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000,
        ),
      })}`,
    ]);
  if (inc.row.resolvedAt)
    rows.push([
      t("incident.metric.resolved"),
      `${t.fmt.dateTime(inc.row.resolvedAt, t.timeZone)} · ${t("incident.metric.ttr", {
        duration: t.fmt.duration(
          (inc.row.resolvedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000,
        ),
      })}`,
    ]);
  if (inc.row.severityName) rows.push([t("postMortem.meta.severity"), inc.row.severityName]);
  if (inc.row.serviceName) rows.push([t("postMortem.meta.service"), inc.row.serviceName]);
  if (inc.row.leadName) rows.push([t("postMortem.meta.lead"), inc.row.leadName]);
  return markdownTable([t("postMortem.block.metric"), t("postMortem.block.value")], rows);
}

export function documentTitle(inc: IncidentDetail, pm: { title: string | null }): string {
  return pm.title?.trim() || `INC-${inc.row.number} — ${inc.row.name}`;
}

/** The whole document as markdown — what "Copy" and the download hand over. */
export function documentMarkdown(
  inc: IncidentDetail,
  pm: { title: string | null; sections: Section[]; aiDrafted: boolean },
  t: Translate,
  term: string,
): string {
  const meta = [
    inc.row.severityName,
    t.fmt.dateShort(inc.row.declaredAt),
    inc.row.resolvedAt
      ? t("postMortem.detectionToResolution", {
          duration: t.fmt.duration(
            (inc.row.resolvedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000,
          ),
        })
      : null,
    inc.row.serviceName,
  ]
    .filter(Boolean)
    .join(" · ");
  const parts = [
    `# ${documentTitle(inc, pm)}`,
    "",
    `_${term} · ${meta}_`,
    "",
    ...pm.sections.flatMap((s) => [`## ${sectionTitle(s, t)}`, "", s.body.trim() || "_—_", ""]),
  ];
  if (inc.followUps.length > 0)
    parts.push(`## ${t("incident.tab.followUps")}`, "", followUpsMarkdown(inc, t), "");
  if (pm.aiDrafted) parts.push(`_${t("postMortem.aiDraftNote")}_`, "");
  return parts.join("\n");
}
