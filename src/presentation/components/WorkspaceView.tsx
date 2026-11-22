import { Profiler, useMemo, useState } from "react";
import type { ServerInfo, Workspace } from "../../types";
import { useAppContext } from "../context/AppContext";
import { prefKeys } from "../../domain/repositories/Preferences";
import { Chat } from "./Chat";
import { Inspector } from "./Inspector";
import { SettingsPanel } from "./SettingsPanel";
import { Button } from "./ui";

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

function ProfiledChat(props: React.ComponentProps<typeof Chat>) {
  if (!import.meta.env.DEV) return <Chat {...props} />;

  return (
    <Profiler
      id="Chat"
      onRender={(id, phase, actualDuration, baseDuration, startTime, commitTime) =>
        import.meta.env.DEV &&
        document.documentElement.dataset.perfCapture === "on" &&
        window.dispatchEvent(
          new CustomEvent("opentemplates:perf-react-commit", {
            detail: { id, phase, actualDuration, baseDuration, startTime, commitTime },
          }),
        )
      }
    >
      <Chat {...props} />
    </Profiler>
  );
}

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
  const root = useAppContext();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(
    () => root.preferences.get(prefKeys.panelOpen) !== "0",
  );
  const [sessionId, setSessionId] = useState<string | null>(() =>
    root.preferences.get(prefKeys.session(workspace.id)),
  );
  const client = useMemo(
    () => (server ? root.provideChatGateway(server) : null),
    [root, server?.baseUrl, server?.password],
  );

  function togglePanel() {
    setPanelOpen((prev) => {
      const next = !prev;
      root.preferences.set(prefKeys.panelOpen, next ? "1" : "0");
      return next;
    });
  }

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
              <Button
                className={panelOpen ? "active" : ""}
                title={panelOpen ? "Ocultar panel" : "Mostrar panel"}
                onClick={togglePanel}
              >
                Panel
              </Button>
              <Button onClick={() => setSettingsOpen(true)}>Ajustes</Button>
              <Button className="danger-text" onClick={onStop}>
                Parar
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={onStart} disabled={starting || workspace.missing}>
              {starting ? "Arrancando…" : "Arrancar workspace"}
            </Button>
          )}
          <Button
            variant="icon"
            title="Eliminar workspace"
            aria-label="Eliminar workspace"
            onClick={onDelete}
          >
            ×
          </Button>
        </div>
      </header>

      {workspace.missing && !server && (
        <div className="callout warning workspace-callout">
          La carpeta de este workspace ya no existe ({workspace.projectPath}). Si era un worktree,
          se puede reparar con <code>git worktree add</code> o eliminar el workspace.
        </div>
      )}

      {server && client ? (
        <div className="workspace-body">
          <ProfiledChat client={client} workspace={workspace} onSessionChange={setSessionId} />
          {panelOpen && (
            <Inspector
              workspace={workspace}
              client={client}
              server={server}
              sessionId={sessionId}
              onUpdated={onUpdated}
              onClose={togglePanel}
            />
          )}
        </div>
      ) : (
        <div className="start-pane">
          <div className="start-card">
            <h2>Workspace parado</h2>
            <p className="muted">
              Al arrancarlo se lanza un proceso de opencode con su propia configuración. Nada de lo
              que hagas aquí afecta a los demás workspaces.
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
              <Button variant="primary" onClick={onStart} disabled={starting || workspace.missing}>
                {starting ? "Arrancando…" : "Arrancar workspace"}
              </Button>
              <Button onClick={() => setSettingsOpen(true)}>Configurar</Button>
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
