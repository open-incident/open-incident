/**
 * Timeline pieces for events of kind atlas_action / atlas_undo / atlas_redo.
 * The incidents module renders the row; these render the "✦ Atlas" tag and
 * the inline Undo / Redo. Owner: atlas-ui.
 */
import { and, eq } from "drizzle-orm";
import { atlasActions, incidents, investigations, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, currentMember } from "@/lib/session";
import { UNDO_WINDOW_MS } from "@/lib/atlas/levels";
import { canUndo, isUndone } from "./run";
import { UndoButton } from "./undo-button";

/** The "✦ Atlas" tag of a row Atlas wrote. */
export function AtlasTimelineMark() {
  return (
    <span
      data-testid="atlas-mark"
      style={{
        fontSize: 10,
        fontWeight: 700,
        borderRadius: 5,
        padding: "1px 6px",
        background: "var(--viol-t)",
        color: "var(--viol)",
        whiteSpace: "nowrap",
      }}
    >
      ✦ Atlas
    </span>
  );
}

/**
 * Undo / Redo on a reversible Atlas action, inline in its timeline row. It
 * reads the action itself, so it always offers what the action's state calls
 * for — and nothing to a viewer, nothing on what cannot be taken back, and
 * nothing once the 24 h after an autonomous resolution have passed.
 */
export async function AtlasUndoLink({
  incidentNumber,
  actionId,
  reversible,
}: {
  incidentNumber: number;
  actionId: string;
  /** From the event payload. */
  reversible: boolean;
}) {
  if (!reversible) return null;
  const current = await currentMember();
  if (!current || !canRespond(current.member)) return null;
  const tenantId = current.tenant.id;
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        action: atlasActions,
        resolvedAt: incidents.resolvedAt,
        resolvedAlone: investigations.resolvedAlone,
        number: incidents.number,
      })
      .from(atlasActions)
      .leftJoin(incidents, eq(incidents.id, atlasActions.incidentId))
      .leftJoin(investigations, eq(investigations.incidentId, atlasActions.incidentId))
      .where(and(eq(atlasActions.tenantId, tenantId), eq(atlasActions.id, actionId))),
  );
  if (!row || row.number !== incidentNumber || !canUndo(row.action)) return null;
  const expired =
    row.resolvedAlone &&
    row.action.autonomous &&
    row.resolvedAt != null &&
    Date.now() - row.resolvedAt.getTime() > UNDO_WINDOW_MS;
  if (expired) return null;
  const t = await getT();
  const undone = isUndone(row.action);
  return (
    <UndoButton
      actionId={actionId}
      undone={undone}
      label={undone ? t("atlas.ui.redo") : t("atlas.ui.undo")}
      variant="link"
    />
  );
}
