import { Profiler, useMemo, useState } from "react";
import type { ServerInfo, Workspace } from "../../types";
import { useAppContext } from "../context/AppContext";
import { prefKeys } from "../../domain/repositories/Preferences";
import { useCommandAction } from "../context/CommandActions";
import { Chat } from "./Chat";
import { Inspector, type InspectorTab } from "./Inspector";
import { PreviewDock } from "./PreviewDock";
import { RaceControls } from "./RaceControls";
import { SettingsPanel } from "./SettingsPanel";
import { TerminalDock } from "./TerminalDock";
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
  /** El workspace terminó un turno sin foco: se marca en el sidebar. */
  onWorkspaceActivity?: (workspaceId: string) => void;
  worktreesRoot: string;
  repoPath: string | null;
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
  onWorkspaceActivity,
  worktreesRoot,
  repoPath,
}: Props) {
  const root = useAppContext();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(
    () => root.preferences.get(prefKeys.panelOpen) !== "0",
  );
  const [panelTab, setPanelTab] = useState<InspectorTab>(() => {
    const saved = root.preferences.get(prefKeys.panelTab(workspace.id));
    return saved === "cambios" || saved === "ficheros" ? saved : "resumen";
  });
  const [sessionsOpen, setSessionsOpen] = useState(
    () => root.preferences.get(prefKeys.sessionsOpen) === "1",
  );
  const [terminalOpen, setTerminalOpen] = useState(
    () => root.preferences.get(prefKeys.terminalOpen) === "1",
  );
  const [previewOpen, setPreviewOpen] = useState(
    () => root.preferences.get(prefKeys.previewOpen) === "1",
  );
  const [sessionId, setSessionId] = useState<string | null>(() =>
    root.preferences.get(prefKeys.session(workspace.id)),
  );
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [liveRace, setLiveRace] = useState(false);
  // `server` cambia de identidad en cada sondeo de estado; los memo se anclan a
  // los valores que definen el cliente para no recrear gateways ni terminales.
  const client = useMemo(
    () => (server ? root.provideChatGateway(server) : null),
    [root, server?.baseUrl, server?.password],
  );
  const terminalGateway = useMemo(
    () => (server ? root.provideTerminalGateway(server) : null),
    [root, server?.baseUrl, server?.password],
  );
  const previewGateway = useMemo(() => root.providePreviewGateway(), [root]);
  function togglePanel() {
    setPanelOpen((prev) => {
      const next = !prev;
      root.preferences.set(prefKeys.panelOpen, next ? "1" : "0");
      return next;
    });
  }

  function toggleSessions() {
    setSessionsOpen((prev) => {
      const next = !prev;
      root.preferences.set(prefKeys.sessionsOpen, next ? "1" : "0");
      return next;
    });
  }
  function toggleTerminal() {
    setTerminalOpen((prev) => {
      const next = !prev;
      root.preferences.set(prefKeys.terminalOpen, next ? "1" : "0");
      return next;
    });
  }
  function togglePreview() {
    setPreviewOpen((prev) => {
      const next = !prev;
      root.preferences.set(prefKeys.previewOpen, next ? "1" : "0");
      return next;
    });
  }
  /** Al parar el workspace se terminan sus PTYs antes que el proceso. */
  async function closeWorkspaceTerminals() {
    if (!terminalGateway) return;
    const location = { directory: workspace.projectPath };
    try {
      const infos = await terminalGateway.list(location);
      await Promise.all(
        infos.map((info) => terminalGateway.remove(location, info.id).catch(() => undefined)),
      );
    } catch {
      // El servidor puede haberse caído ya; la parada sigue adelante.
    }
  }
  async function stopWorkspace() {
    if (
      liveRace &&
      !root.confirm.confirm(
        "Hay una carrera en curso. Si paras el workspace, sus corridas se interrumpirán y quedarán como fallidas. ¿Parar igualmente?",
      )
    ) {
      return;
    }
    await closeWorkspaceTerminals();
    onStop();
  }
  function requestDelete() {
    if (
      liveRace &&
      !root.confirm.confirm(
        "Hay una carrera en curso. Si eliminas el workspace, sus corridas se interrumpirán. Los worktrees de la carrera quedan en la raíz de worktrees para revisarlos o borrarlos a mano. ¿Continuar?",
      )
    ) {
      return;
    }
    onDelete();
  }
  function changePanelTab(tab: InspectorTab) {
    setPanelTab(tab);
    root.preferences.set(prefKeys.panelTab(workspace.id), tab);
  }
  function openChanges() {
    setPanelOpen(true);
    root.preferences.set(prefKeys.panelOpen, "1");
    changePanelTab("cambios");
  }
  function toggleChanges() {
    if (panelOpen && panelTab === "cambios") togglePanel();
    else openChanges();
  }
  function closeActivePanel() {
    if (terminalOpen) toggleTerminal();
    else if (previewOpen) togglePreview();
    else if (sessionsOpen) toggleSessions();
    else if (panelOpen) togglePanel();
  }

  useCommandAction("workspace.settings", () => setSettingsOpen(true));
  useCommandAction(
    "panel.toggle",
    togglePanel,
    Boolean(server),
    "Arranca el workspace para abrir el panel.",
  );
  useCommandAction(
    "panel.sessions",
    toggleSessions,
    Boolean(server),
    "Arranca el workspace para ver sus sesiones.",
  );
  useCommandAction(
    "panel.terminal",
    toggleTerminal,
    Boolean(server && terminalGateway),
    "Arranca el workspace para abrir el terminal.",
  );
  useCommandAction(
    "panel.diff",
    toggleChanges,
    Boolean(server),
    "Arranca el workspace para revisar cambios.",
  );
  useCommandAction(
    "panel.preview",
    togglePreview,
    Boolean(server),
    "Arranca el workspace para ver la app en marcha.",
  );
  useCommandAction(
    "panel.close",
    closeActivePanel,
    Boolean(server && (terminalOpen || previewOpen || sessionsOpen || panelOpen)),
    "No hay ningún panel abierto.",
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
              <Button
                className={sessionsOpen ? "active" : ""}
                title={sessionsOpen ? "Ocultar sesiones" : "Mostrar sesiones"}
                onClick={toggleSessions}
              >
                Sesiones
              </Button>
              <Button
                className={panelOpen && panelTab === "resumen" ? "active" : ""}
                title={panelOpen ? "Ocultar panel" : "Mostrar panel"}
                onClick={togglePanel}
              >
                Panel
              </Button>
              <Button
                className={panelOpen && panelTab === "cambios" ? "active" : ""}
                title="Ver cambios del agente y del árbol de trabajo"
                onClick={openChanges}
              >
                Cambios
              </Button>
              <Button
                className={terminalOpen ? "active" : ""}
                title={terminalOpen ? "Ocultar terminal" : "Abrir terminal del workspace"}
                onClick={toggleTerminal}
              >
                Terminal
              </Button>
              <Button
                className={previewOpen ? "active" : ""}
                title={previewOpen ? "Ocultar la vista previa" : "Ver la app en marcha"}
                onClick={togglePreview}
              >
                Vista
              </Button>
              {client && (
                <RaceControls
                  client={client}
                  workspace={workspace}
                  worktreesRoot={worktreesRoot}
                  repoPath={repoPath}
                  sessionId={sessionId}
                  onOpenSession={(id) => setOpenSessionId(id)}
                  onOpenDiff={(id) => {
                    setOpenSessionId(id);
                    openChanges();
                  }}
                  onLiveChange={setLiveRace}
                />
              )}
              <Button onClick={() => setSettingsOpen(true)}>Ajustes</Button>
              <Button className="danger-text" onClick={() => void stopWorkspace()}>
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
            onClick={requestDelete}
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
        <>
          <div className="workspace-body">
            <ProfiledChat
              client={client}
              workspace={workspace}
              onSessionChange={setSessionId}
              sessionsOpen={sessionsOpen}
              onCloseSessions={toggleSessions}
              onWorkspaceActivity={onWorkspaceActivity}
              openSessionId={openSessionId}
              onSessionOpened={() => setOpenSessionId(null)}
            />
            {panelOpen && (
              <Inspector
                workspace={workspace}
                client={client}
                server={server}
                sessionId={sessionId}
                tab={panelTab}
                onTabChange={changePanelTab}
                onUpdated={onUpdated}
                onClose={togglePanel}
              />
            )}
          </div>
          {previewOpen && (
            <PreviewDock
              gateway={previewGateway}
              preferences={root.preferences}
              workspace={workspace}
              client={client}
              sessionId={sessionId}
              onClose={togglePreview}
            />
          )}
          {terminalOpen && terminalGateway && (
            <TerminalDock
              gateway={terminalGateway}
              directory={workspace.projectPath}
              onClose={toggleTerminal}
            />
          )}
        </>
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
