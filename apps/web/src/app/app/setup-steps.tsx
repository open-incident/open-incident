import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  alertSources,
  escalationPathVersions,
  escalationPaths,
  members,
  monitors,
  notificationMethods,
  withTenant,
  type EscalationNode,
} from "@openincident/db";
import { availableChannels } from "@openincident/oncall";
import { isManager, requireMember } from "@/lib/session";
import { catchAllRoute } from "@/lib/alerting-setup";
import { SOURCE_KINDS } from "@/lib/alert-sources";
import { Onboarding } from "./onboarding";
import { maskEmail, maskPhone } from "./page-me-mask";

/**
 * The three steps, while the workspace has never been paged.
 *
 * This is the reading half: what the workspace already answers, so the cards
 * open on the first thing left to do and every finished one says what finished
 * it. The doing half is in `onboarding.tsx`, which is where the reader is.
 *
 * Who is paged is read off the rule that catches every alert and the path it
 * names — not off who happens to exist in the workspace: "then Karim after
 * 5 min" is only said when Karim really is the path's second level.
 */
export async function SetupSteps({
  memberName,
  workspaceName,
  steps,
}: {
  memberName: string;
  workspaceName: string;
  steps: { pager: boolean; source: boolean; firstAlert: boolean; verified: boolean };
}) {
  const { tenant, member } = await requireMember();

  const read = await withTenant(tenant.id, async (tx) => {
    const [phone] = await tx
      .select({ value: notificationMethods.value })
      .from(notificationMethods)
      .where(
        and(
          eq(notificationMethods.tenantId, tenant.id),
          eq(notificationMethods.memberId, member.id),
          inArray(notificationMethods.kind, ["sms", "voice"]),
          isNotNull(notificationMethods.verifiedAt),
        ),
      )
      .limit(1);

    // The path the catch-all rule pages, as published.
    const route = await catchAllRoute(tx, tenant.id);
    const pathId =
      route?.escalationPathId ?? route?.escalations.find((e) => e.kind === "path")?.pathId ?? null;
    let first: string[] = [];
    let second: string[] = [];
    if (pathId) {
      const [version] = await tx
        .select({ graph: escalationPathVersions.graph })
        .from(escalationPaths)
        .innerJoin(
          escalationPathVersions,
          eq(escalationPathVersions.id, escalationPaths.currentVersionId),
        )
        .where(and(eq(escalationPaths.tenantId, tenant.id), eq(escalationPaths.id, pathId)));
      const nodes = version?.graph.nodes ?? [];
      const level = (id: string | null | undefined) =>
        nodes.find((n): n is Extract<EscalationNode, { kind: "level" }> =>
          Boolean(id && n.id === id && n.kind === "level"),
        );
      const l1 = level(version?.graph.start);
      const l2 = level(l1?.next);
      const ids = (l?: Extract<EscalationNode, { kind: "level" }>) =>
        (l?.targets ?? []).flatMap((x) => (x.kind === "member" ? [x.memberId] : []));
      first = ids(l1);
      second = ids(l2);
    }
    const names = new Map(
      (first.length + second.length > 0
        ? await tx
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(and(eq(members.tenantId, tenant.id), inArray(members.id, [...first, ...second])))
        : []
      ).map((m) => [m.id, m.name]),
    );

    const [source] = await tx
      .select({ name: alertSources.name })
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenant.id), eq(alertSources.managed, false)))
      .orderBy(asc(alertSources.createdAt))
      .limit(1);
    const [monitor] = source
      ? []
      : await tx
          .select({ target: monitors.target, name: monitors.name })
          .from(monitors)
          .where(eq(monitors.tenantId, tenant.id))
          .orderBy(asc(monitors.createdAt))
          .limit(1);

    return {
      phone: phone?.value ?? null,
      pagesMe: first.includes(member.id),
      firstName: first[0] ? (names.get(first[0]) ?? null) : null,
      backup: second[0] ? (names.get(second[0]) ?? null) : null,
      source: source?.name ?? null,
      monitor: monitor ? monitor.target || monitor.name : null,
    };
  });

  const channels = availableChannels();
  return (
    <Onboarding
      memberName={memberName}
      workspaceName={workspaceName}
      done={[steps.pager, steps.source || read.monitor !== null, steps.verified]}
      phone={read.phone ? maskPhone(read.phone) : null}
      email={maskEmail(member.email)}
      pagesMe={read.pagesMe}
      pagedName={read.firstName}
      backupName={read.backup}
      canPhone={channels.includes("sms") || channels.includes("voice")}
      kinds={SOURCE_KINDS.map((k) => ({ kind: k.kind, label: k.short }))}
      sourceLabel={read.source}
      monitorLabel={read.monitor}
      manages={isManager(member)}
    />
  );
}
