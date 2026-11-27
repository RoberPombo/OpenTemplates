/** Etiquetas de modo del workspace compartidas por la barra lateral y la cabecera. */
import type { WorkspaceMode } from "../../types";

const MODE_LABELS: Record<WorkspaceMode, string> = {
  adhoc: "ad-hoc",
  principal: "checkout principal",
  worktree: "worktree",
};

export function workspaceModeLabel(mode: WorkspaceMode): string {
  return MODE_LABELS[mode];
}
