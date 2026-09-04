/**
 * Sending a member's invitation email — in the workspace's language, through
 * the instance transport and the outbox.
 */
import { brandedHtml, brandedText, sendTenantEmail, type BrandedEmail } from "@openincident/mail";
import { inviteToken } from "@openincident/crypto";
import { getT } from "@/i18n/server";
import { currentOrigin } from "@/lib/tenant";

export async function sendMemberInvite(
  tenant: { id: string },
  workspaceName: string,
  invited: { id: string; email: string },
  inviterName: string,
): Promise<void> {
  const t = await getT();
  const url = `${await currentOrigin()}/invite/${inviteToken(tenant.id, invited.id)}`;
  const mail: BrandedEmail = {
    title: t("mail.invite.title", { workspace: workspaceName }),
    intro: [
      t("mail.invite.intro", { inviter: inviterName, workspace: workspaceName }),
      t("mail.invite.expiry"),
    ],
    button: { label: t("mail.invite.cta"), url },
    footnote: t("mail.invite.footnote"),
    signature: workspaceName,
  };
  await sendTenantEmail({
    tenantId: tenant.id,
    to: invited.email,
    subject: t("mail.invite.subject", { workspace: workspaceName }),
    text: brandedText(mail),
    html: brandedHtml(mail),
    kind: "invitation",
    immediate: true,
  });
}
