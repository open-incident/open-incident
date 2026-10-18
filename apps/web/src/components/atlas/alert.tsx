import type { AlertAtlasState } from "@/lib/atlas/queries";

/** "✦ Atlas on it" / "✦ by Atlas alone" / "✦ by Atlas · Thomas told". Feed it alertAtlasStates() once per list. Owner: atlas-ui. */
export function AtlasAlertBadge(_props: { state: AlertAtlasState | undefined }) {
  return null;
}

/** Alert detail: what Atlas is doing and why it asks ("…so Jordan is asked first") + Approve the fix. Owner: atlas-ui. */
export async function AtlasAlertBanner(_props: {
  tenantId: string;
  alertId: string;
  incidentId: string | null;
}) {
  return null;
}
