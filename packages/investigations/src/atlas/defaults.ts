/**
 * The allowed actions a workspace starts with: the seven of the design, off,
 * with no endpoint. An action becomes usable once someone connects it to
 * their own automation (do / undo / verify URLs) and switches it on; the last
 * one has no way back and can never be switched on.
 */
import { actionCatalog, withTenant } from "@openincident/db";

export const DEFAULT_ACTIONS: Array<{
  key: string;
  label: string;
  description: string;
  executor: "open-change" | "kubernetes" | "flags" | "runbook";
  minLevel: 3 | 4;
  reversible: boolean;
}> = [
  {
    key: "rollback_deploy",
    label: "Roll back a deploy",
    description: "through your deploy pipeline · progressive, health-checked",
    executor: "open-change",
    minLevel: 3,
    reversible: true,
  },
  {
    key: "flag_off",
    label: "Turn a feature flag off",
    description: "feature flags · one flag, one environment",
    executor: "flags",
    minLevel: 3,
    reversible: true,
  },
  {
    key: "restart_pods",
    label: "Restart pods, one at a time",
    description: "Kubernetes · stops if a pod fails its check",
    executor: "kubernetes",
    minLevel: 3,
    reversible: true,
  },
  {
    key: "scale_deployment",
    label: "Scale a deployment",
    description: "Kubernetes · ±50 % at most, within quotas",
    executor: "kubernetes",
    minLevel: 3,
    reversible: true,
  },
  {
    key: "reload_keys",
    label: "Reload a cache or signing keys",
    description: "service endpoint declared in the runbook",
    executor: "runbook",
    minLevel: 4,
    reversible: true,
  },
  {
    key: "drain_node",
    label: "Move pods off a node",
    description: "Kubernetes · cordon + reschedule",
    executor: "kubernetes",
    minLevel: 4,
    reversible: true,
  },
  {
    key: "db_failover",
    label: "Fail over the database",
    description: "not reversible in under 10 minutes",
    executor: "runbook",
    minLevel: 4,
    reversible: false,
  },
];

/** The built-in keys, whose label and description the screens translate. */
export const DEFAULT_ACTION_KEYS = new Set(DEFAULT_ACTIONS.map((a) => a.key));

/** Puts the defaults in place for a workspace that has none; touches nothing otherwise. */
export async function ensureDefaultActions(tenantId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    for (const a of DEFAULT_ACTIONS)
      await tx
        .insert(actionCatalog)
        .values({
          tenantId,
          key: a.key,
          label: a.label,
          description: a.description,
          executor: a.executor,
          minLevel: a.minLevel,
          // Reversible is earned by an undo endpoint; until one is configured, it is not.
          reversible: false,
          enabled: false,
          limits: { http: { doUrl: null, undoUrl: null, verifyUrl: null }, declared: a.reversible },
        })
        .onConflictDoNothing();
  });
}
