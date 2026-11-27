/**
 * Ficha que aparece al pasar el ratón por un workspace en la barra lateral.
 * La fila queda mínima (nombre y estado) y los datos largos viven aquí.
 */
import type { ProfileManifest, Repo, Workspace } from "../../types";
import { formatRelativeTime } from "../../domain/shared";
import { workspaceModeLabel } from "../../domain/workspace/labels";

type Props = {
  workspace: Workspace;
  repo?: Repo | null;
  profile?: ProfileManifest | null;
  running: boolean;
  sharedWith?: string[];
};

export function WorkspaceMetaCard({ workspace, repo, profile, running, sharedWith = [] }: Props) {
  const updated = formatRelativeTime(workspace.updatedAt);
  const profileLabel = profile
    ? `${profile.name} · v${workspace.profileVersion ?? profile.version}`
    : "sin perfil";
  const mode = workspaceModeLabel(workspace.mode);
  const branch = workspace.branch && workspace.branch !== mode ? ` · ${workspace.branch}` : "";

  return (
    <div className="workspace-meta-card" role="tooltip">
      <div className="workspace-meta-card-head">
        <strong>{workspace.name}</strong>
        <span className={`status ${running ? "live" : "off"}`}>
          {running ? "activo" : "parado"}
        </span>
      </div>
      <span className="workspace-meta-card-path">{workspace.projectPath}</span>
      <dl className="workspace-meta-card-grid">
        <div>
          <dt>Modo</dt>
          <dd>
            {mode}
            {branch}
          </dd>
        </div>
        <div>
          <dt>Repo</dt>
          <dd>{repo?.name ?? "sin repo"}</dd>
        </div>
        <div>
          <dt>Perfil</dt>
          <dd>{profileLabel}</dd>
        </div>
        <div>
          <dt>Modelo</dt>
          <dd>{workspace.model ?? "global"}</dd>
        </div>
        <div>
          <dt>Contexto</dt>
          <dd>
            {workspace.mcpNames.length} MCPs · {workspace.skills.length} skills ·{" "}
            {workspace.agents.length} agentes
          </dd>
        </div>
        <div>
          <dt>Extras</dt>
          <dd>
            {workspace.commands.length} comandos · {workspace.plugins.length} plugins
          </dd>
        </div>
        {workspace.issue && (
          <div>
            <dt>Issue</dt>
            <dd>
              #{workspace.issue.number} {workspace.issue.title}
            </dd>
          </div>
        )}
        {sharedWith.length > 0 && (
          <div>
            <dt>Comparte</dt>
            <dd>{sharedWith.join(", ")}</dd>
          </div>
        )}
        {updated && (
          <div>
            <dt>Actualizado</dt>
            <dd>{updated}</dd>
          </div>
        )}
      </dl>
      {workspace.missing && (
        <p className="workspace-meta-card-warning">La carpeta del workspace ya no existe.</p>
      )}
    </div>
  );
}
