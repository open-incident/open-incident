import { requireMember, isManager } from "@/lib/session";
import { getT } from "@/i18n/server";
import { loadChatPage } from "./data";
import { ChatScreen } from "./chat-screen";
import type { WizardData } from "./wizard";

export const dynamic = "force-dynamic";

/**
 * Settings › Slack & Teams (design V2Chat). The page reads everything on the
 * server — installs, the chat log, the paging rules, the identities — and the
 * client draws the cards, the sections, the preview and the wizard named by
 * the address (?connect=slack|teams&step=1|2|3).
 */
export default async function ChatSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const manage = isManager(member);
  const data = await loadChatPage(tenant.id, { id: member.id, name: member.name }, manage, t);

  const connect = q.connect === "slack" || q.connect === "teams" ? q.connect : null;
  let wizard: WizardData | null = null;
  if (connect && manage) {
    const p = data.providers[connect];
    const asked = q.step === "3" ? 3 : q.step === "2" ? 2 : 1;
    // A step that needs the connection waits for it.
    const step = asked > 1 && !p.connected ? 1 : asked;
    if (p.env || p.connected)
      wizard = {
        provider: connect,
        step,
        env: p.env,
        connected: p.connected,
        team: p.team,
        tenant: p.tenantDomain,
        error: connect === "slack" && q.error && q.error !== "invalid" ? q.error : null,
        localEndpoint: q.error === "local-endpoint",
        pairing: p.pairing,
        appId: data.teamsAppId,
        config: p.config,
        channels: p.channelOptions,
        nextNumber: data.preview.nextNumber,
        tested: q.tested ?? null,
        testError: q.testError ?? null,
        invalid: q.error === "invalid",
      };
  }
  const fresh = q.fresh === "slack" || q.fresh === "teams" ? q.fresh : null;
  const reinstalled = q.reinstalled === "slack";
  const flash = fresh
    ? t("chat2.toast.connected", { name: fresh === "slack" ? "Slack" : "Microsoft Teams" })
    : reinstalled
      ? t("chat2.toast.reinstalled")
      : null;
  return (
    <ChatScreen data={data} wizard={wizard} flash={flash} openSection={fresh ? "channels" : null} />
  );
}
