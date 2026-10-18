import { cookies } from "next/headers";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { monitors, notificationDeliveries, withTenant } from "@openincident/db";
import { canRespond, requireMember } from "@/lib/session";
import { getWorkspace } from "@/lib/tenant";
import { alertingSetupStatus } from "@/lib/alerting-setup";
import { SetupSteps } from "./setup-steps";
import { LiveHome } from "./home-live";
import { SKIP_COOKIE } from "./home-skip";

/**
 * Home — three steps while the workspace is empty, the state of things once it
 * is not.
 *
 * The switch is not a setting: the steps disappear the day the chain has been
 * proven — someone is paged, alerts have a way in, a page really went out —
 * because from then on the answer to "is this thing working?" is the screen
 * itself rather than a checklist. A member who set things up elsewhere can put
 * them aside for themselves ("Skip for now"); the Guide brings them back.
 */
export default async function HomePage() {
  const { tenant, member } = await requireMember();
  const workspace = await getWorkspace();
  const skipped = (await cookies()).get(SKIP_COOKIE)?.value === "1";

  const { setup, watched, firstTestAt } = await withTenant(tenant.id, async (tx) => {
    const setup = await alertingSetupStatus(tx, tenant.id);
    const [mon] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(monitors)
      .where(eq(monitors.tenantId, tenant.id));
    const [first] = await tx
      .select({ at: notificationDeliveries.createdAt })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.tenantId, tenant.id),
          eq(notificationDeliveries.kind, "test"),
          ne(notificationDeliveries.status, "failed"),
        ),
      )
      .orderBy(asc(notificationDeliveries.createdAt))
      .limit(1);
    return { setup, watched: (mon?.n ?? 0) > 0, firstTestAt: first?.at ?? null };
  });

  // The second step is finished by a source or by a monitor — a URL we watch
  // posts through the product's own source, which the setup status does not
  // count as one of the workspace's.
  const complete = setup.steps.pager && (setup.steps.source || watched) && setup.steps.verified;
  const empty = !complete && canRespond(member) && !skipped;
  // "You're set." once: the workspace's very first test page went out within
  // the last half hour, which is the moment the third step was finished.
  const justDone =
    complete && firstTestAt !== null && Date.now() - firstTestAt.getTime() < 30 * 60_000;

  return (
    <div
      data-screen-label="Home"
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "26px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      {empty ? (
        <SetupSteps
          memberName={member.name.split(" ")[0] || member.name}
          workspaceName={workspace?.name ?? tenant.slug}
          steps={setup.steps}
        />
      ) : (
        <LiveHome
          tenantId={tenant.id}
          memberId={member.id}
          memberName={member.name}
          workspaceName={workspace?.name ?? tenant.slug}
          justDone={justDone}
        />
      )}
    </div>
  );
}
