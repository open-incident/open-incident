/**
 * Timeline pieces for events of kind atlas_action / atlas_undo / atlas_redo.
 * The incidents module renders the row; these render the "✦ Atlas" tag and
 * the inline Undo / Redo. Owner: atlas-ui.
 */
export function AtlasTimelineMark() {
  return null;
}

export function AtlasUndoLink(_props: {
  incidentNumber: number;
  actionId: string;
  /** From the event payload. */
  reversible: boolean;
}) {
  return null;
}
