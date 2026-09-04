import { redirect } from "next/navigation";
import { hasPermission, requireMember } from "@/lib/session";

/** Settings → the first screen the member holds; general for an administrator. */
export default async function SettingsIndex() {
  const { member } = await requireMember();
  const first = (
    [
      ["settings.workspace", "/app/settings/general"],
      ["settings.members", "/app/settings/members"],
      ["settings.response", "/app/settings/types"],
      ["settings.alerting", "/app/settings/alert-sources"],
      ["settings.platform", "/app/settings/integrations"],
      ["audit.view", "/app/settings/audit"],
    ] as const
  ).find(([permission]) => hasPermission(member, permission));
  redirect(first ? first[1] : "/app/settings/general");
}
