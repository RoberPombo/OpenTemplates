/**
 * Borrado de workspace con su política de confirmación:
 * - worktree: consultar estado, confirmar (la rama se conserva), y si está
 *   sucio pedir una segunda confirmación que activa `force`.
 * - resto: una confirmación; la carpeta del proyecto no se toca.
 * Las confirmaciones se piden por el puerto ConfirmDialog (la UI decide cómo).
 */
import type { ConfirmDialog } from "../repositories/Dialogs";
import type { WorkspaceGateway } from "../repositories/WorkspaceGateway";
import type { Workspace } from "../../types";

export class DeleteWorkspace {
  private readonly workspaces: WorkspaceGateway;
  private readonly confirm: ConfirmDialog;

  constructor(workspaces: WorkspaceGateway, confirm: ConfirmDialog) {
    this.workspaces = workspaces;
    this.confirm = confirm;
  }

  async execute(workspace: Workspace): Promise<{ deleted: boolean }> {
    let force = false;
    if (workspace.mode === "worktree") {
      const status = await this.workspaces.worktreeStatus(workspace.id);
      if (
        !this.confirm.confirm(
          `¿Eliminar el workspace «${workspace.name}»? Se parará el servidor y se quitará el worktree. La rama «${workspace.branch ?? status.branch ?? "de trabajo"}» se conserva.`,
        )
      ) {
        return { deleted: false };
      }
      if (status.dirty) {
        if (
          !this.confirm.confirm(
            "El worktree tiene cambios sin commitear. ¿Eliminarlo igualmente? La rama se conservará.",
          )
        ) {
          return { deleted: false };
        }
        force = true;
      }
    } else if (
      !this.confirm.confirm(
        `¿Eliminar el workspace «${workspace.name}»? Se parará el servidor y se quitará de la lista. La carpeta del proyecto no se toca.`,
      )
    ) {
      return { deleted: false };
    }

    await this.workspaces.delete(workspace.id, {
      removeWorktree: workspace.mode === "worktree",
      force,
    });
    return { deleted: true };
  }
}
