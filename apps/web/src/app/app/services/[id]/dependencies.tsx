import { withTenant } from "@openincident/db";
import { serviceDependencies, type DependencyNode } from "@/lib/services";
import { neighbours, telemetryInstalled, type Neighbour } from "@/lib/telemetry";
import { DependencyGraph } from "./dependency-graph";

/** The window the observed calls are read over — the design's "observed (traces, 7 d)". */
const DAYS = 7;

/**
 * What this service talks to: observed in the traces, settled by people.
 *
 * The traces are read under every name the service goes by (merged names
 * included) and folded into the services those names belong to; then what
 * people did with them — confirmed, hidden, declared outright — is laid over.
 * Without a column store, only the declared links exist, and the card says so
 * rather than drawing a graph it invented.
 */
export async function Dependencies({
  tenantId,
  service,
  others,
  mayEdit,
}: {
  tenantId: string;
  service: { id: string; key: string; aliases: string[] };
  others: Array<{ id: string; key: string }>;
  mayEdit: boolean;
}) {
  const installed = telemetryInstalled();
  let observed: Neighbour[] = [];
  if (installed) {
    const to = new Date();
    const from = new Date(to.getTime() - DAYS * 86_400_000);
    observed = (
      await Promise.all(
        [service.key, ...service.aliases].map((name) =>
          neighbours(tenantId, name, from, to).catch(() => [] as Neighbour[]),
        ),
      )
    ).flat();
  }
  const nodes: DependencyNode[] = await withTenant(tenantId, (tx) =>
    serviceDependencies(tx, tenantId, service, observed),
  );
  return (
    <DependencyGraph
      service={{ id: service.id, key: service.key }}
      nodes={nodes}
      others={others}
      tracesInstalled={installed}
      days={DAYS}
      mayEdit={mayEdit}
    />
  );
}
