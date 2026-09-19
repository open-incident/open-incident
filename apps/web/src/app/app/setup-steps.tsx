import { and, eq, ne } from "drizzle-orm";
import { members, notificationMethods, withTenant } from "@openincident/db";
import { availableChannels } from "@openincident/oncall";
import { isManager, requireMember } from "@/lib/session";
import { SOURCE_KINDS } from "@/lib/alert-sources";
import { Onboarding } from "./onboarding";

/**
 * The three steps, while the workspace has never been paged.
 *
 * This is the reading half: what the workspace already answers, so the cards
 * open on the first thing left to do and every finished one says what finished
 * it. The doing half is in `onboarding.tsx`, which is where the reader is.
 */
export async function SetupSteps({
  memberName,
  workspaceName,
  steps,
  sourceCount,
  monitorCount,
}: {
  memberName: string;
  workspaceName: string;
  steps: { pager: boolean; source: boolean; firstAlert: boolean; verified: boolean };
  sourceCount: number;
  monitorCount: number;
}) {
  const { tenant, member } = await requireMember();

  const read = await withTenant(tenant.id, async (tx) => {
    const phones = await tx
      .select({ kind: notificationMethods.kind, value: notificationMethods.value })
      .from(notificationMethods)
      .where(
        and(
          eq(notificationMethods.tenantId, tenant.id),
          eq(notificationMethods.memberId, member.id),
        ),
      );
    const verified = phones.find(
      (p) => (p.kind === "sms" || p.kind === "voice") && p.value.startsWith("+"),
    );
    // The number is shown back masked: the card is proof it is set, not a place
    // to read somebody's phone off a shared screen.
    const masked = verified ? `${verified.value.slice(0, 4)}…${verified.value.slice(-2)}` : null;
    const [mate] = await tx
      .select({ name: members.name })
      .from(members)
      .where(and(eq(members.tenantId, tenant.id), ne(members.id, member.id)))
      .limit(1);
    return { masked, mate: mate?.name ?? null };
  });

  const channels = availableChannels();
  return (
    <Onboarding
      memberName={memberName}
      workspaceName={workspaceName}
      done={[steps.pager, steps.source || monitorCount > 0, steps.verified]}
      phone={read.masked}
      hasBackup={Boolean(read.mate)}
      backupName={read.mate}
      canPhone={channels.includes("sms") || channels.includes("voice")}
      kinds={SOURCE_KINDS.map((k) => ({ kind: k.kind, label: k.label, icon: k.icon }))}
      sourceCount={sourceCount}
      monitorCount={monitorCount}
      manages={isManager(member)}
    />
  );
}
