import { useMemo, useState } from "react";
import type { ServerInfo, Workspace } from "../types";
import { makeClient } from "../opencode";
import { Chat } from "./Chat";
import { SettingsPanel } from "./SettingsPanel";

type Props = {
  workspace: Workspace;
  templateName?: string | null;
  server?: ServerInfo;
  starting: boolean;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onUpdated: (workspace: Workspace, warnings: string[]) => void;
};

function modeLabel(workspace: Workspace) {
  if (workspace.mode === "worktree") return "worktree";
  if (workspace.mode === "principal") return "checkout principal";
  return "ad-hoc";
}

export function WorkspaceView({
  workspace,
  templateName,
  server,
  starting,
  onStart,
  onStop,
  onDelete,
  onUpdated,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const client = useMemo(
    () => (server ? makeClient(server) : null),
    [server?.baseUrl, server?.password],
  );

  const folder = workspace.projectPath.split("/").filter(Boolean).pop();

  return (
    <section className="workspace">
      <header className="workspace-head">
        <div className="workspace-title">
          <div className="workspace-avatar">{workspace.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <h1>
              {workspace.name}
              {workspace.mode === "worktree" && workspace.branch && (
                <span className="tool-chip branch-chip">⎇ {workspace.branch}</span>
              )}
            </h1>
            <p className="muted small-text" title={workspace.projectPath}>
              {folder} · {workspace.projectPath}
            </p>
            <p className="muted small-text">
              {modeLabel(workspace)}
              {templateName ? ` · template ${templateName}` : " · sin template"}
              {workspace.missing ? " · carpeta no encontrada" : ""}
            </p>
          </div>
          <span className={`status ${server ? "live" : "off"}`}>
            {server ? "activo" : "parado"}
          </span>
        </div>
        <div className="row">
          {server ? (
            <>
              <button className="ghost" onClick={() => setSettingsOpen(true)}>
                Ajustes
              </button>
              <button className="ghost danger-text" onClick={onStop}>
                Parar
              </button>
            </>
          ) : (
            <button
              className="primary"
              onClick={onStart}
              disabled={starting || workspace.missing}
            >
              {starting ? "Arrancando…" : "Arrancar workspace"}
            </button>
          )}
          <button className="icon-button" title="Eliminar workspace" onClick={onDelete}>
            ×
          </button>
        </div>
      </header>

      {workspace.missing && !server && (
        <div className="callout warning workspace-callout">
          La carpeta de este workspace ya no existe ({workspace.projectPath}). Si era
          un worktree, se puede reparar con{" "}
          <code>git worktree add</code> o eliminar el workspace.
        </div>
      )}

      {server && client ? (
        <Chat client={client} workspace={workspace} />
      ) : (
        <div className="start-pane">
          <div className="start-card">
            <h2>Workspace parado</h2>
            <p className="muted">
              Al arrancarlo se lanza un proceso de opencode con su propia
              configuración. Nada de lo que hagas aquí afecta a los demás
              workspaces.
            </p>
            <div className="start-stats">
              <div>
                <strong>{workspace.mcpNames.length}</strong>
                <span>MCPs</span>
              </div>
              <div>
                <strong>{workspace.skills.length}</strong>
                <span>skills</span>
              </div>
              <div>
                <strong>{workspace.agents.length}</strong>
                <span>agentes</span>
              </div>
              <div>
                <strong>{workspace.plugins.length}</strong>
                <span>plugins</span>
              </div>
              <div>
                <strong>{workspace.model ?? "global"}</strong>
                <span>modelo</span>
              </div>
            </div>
            <div className="row">
              <button
                className="primary"
                onClick={onStart}
                disabled={starting || workspace.missing}
              >
                {starting ? "Arrancando…" : "Arrancar workspace"}
              </button>
              <button className="ghost" onClick={() => setSettingsOpen(true)}>
                Configurar
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsPanel
          workspace={workspace}
          client={client}
          onUpdated={onUpdated}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </section>
  );
}
