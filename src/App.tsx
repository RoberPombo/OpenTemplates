import { lazy, Suspense, useMemo, useState } from "react";
import { folderName } from "./domain/shared";
import { useWorkspaces } from "./presentation/hooks/useWorkspaces";
import { CreateWorkspace } from "./presentation/components/CreateWorkspace";
import { ManagePanel } from "./presentation/components/ManagePanel";
import { UpdateDialog } from "./presentation/components/UpdateDialog";
import { WorkspaceView } from "./presentation/components/WorkspaceView";
import { Button } from "./presentation/components/ui";
import { useUpdater } from "./presentation/hooks/useUpdater";
import type { Workspace } from "./types";
import "./styles.css";

const PerformanceCapture = import.meta.env.DEV
  ? lazy(() => import("./presentation/components/PerformanceCapture"))
  : null;

function App() {
  const {
    boot,
    workspaces,
    repos,
    templates,
    library,
    worktreesRoot,
    running,
    selectedId,
    selected,
    groups,
    startingId,
    notice,
    unseen,
    fatal,
    select,
    start,
    stop,
    remove,
    updated,
    created,
    markUnseen,
    setNotice,
    setRepos,
    setTemplates,
    setWorktreesRoot,
  } = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const updater = useUpdater();

  const templateName = useMemo(() => {
    if (!selected?.templateId) return null;
    const template = templates.find((item) => item.id === selected.templateId);
    return template
      ? `${template.name} · v${selected.templateVersion ?? template.version}`
      : selected.templateId;
  }, [selected?.templateId, selected?.templateVersion, templates]);

  if (fatal) {
    return (
      <main className="fatal">
        <h1>OpenTemplates no pudo arrancar</h1>
        <p>{fatal}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </main>
    );
  }

  if (!boot) {
    return <main className="fatal muted">Cargando…</main>;
  }

  function renderWorkspace(workspace: Workspace) {
    const isRunning = Boolean(running[workspace.id]);
    const secondary =
      workspace.mode === "worktree"
        ? (workspace.branch ?? folderName(workspace.projectPath))
        : workspace.mode === "principal"
          ? "checkout principal"
          : folderName(workspace.projectPath);
    return (
      <button
        key={workspace.id}
        className={`workspace-item ${selectedId === workspace.id ? "active" : ""} ${
          workspace.missing ? "missing" : ""
        }`}
        onClick={() => select(workspace.id)}
      >
        <span className={`dot ${isRunning ? "live" : ""}`} />
        <span className="workspace-meta">
          <span className="workspace-name">{workspace.name}</span>
          <span className="workspace-project" title={workspace.projectPath}>
            {secondary}
            {workspace.missing ? " · no encontrada" : ""}
          </span>
        </span>
        {isRunning && <span className="live-label">live</span>}
        {unseen[workspace.id] > 0 && (
          <span
            className="unseen-badge"
            title={`${unseen[workspace.id]} aviso${unseen[workspace.id] === 1 ? "" : "s"} sin ver`}
          >
            {unseen[workspace.id]}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◒</span>
          <div>
            <strong>OpenTemplates</strong>
            <span className="muted">workspaces</span>
          </div>
        </div>

        <button className="new-workspace" onClick={() => setCreating(true)}>
          <span>+</span> Nuevo workspace
        </button>

        <nav className="workspace-list">
          {groups.map((group) => (
            <div key={group.key || "loose"} className="workspace-group">
              <div className="group-head" title={group.subtitle}>
                <span>{group.title}</span>
                <span className="group-count">{group.items.length}</span>
              </div>
              {group.items.map(renderWorkspace)}
            </div>
          ))}
          {workspaces.length === 0 && (
            <p className="muted sidebar-empty">Sin workspaces. Crea uno para empezar.</p>
          )}
        </nav>

        <div className="sidebar-foot">
          <Button variant="ghost" className="sidebar-link" onClick={() => setManaging(true)}>
            Repos y templates
          </Button>
          {boot.error ? (
            <span className="danger-text">{boot.error}</span>
          ) : (
            <span className="muted">opencode · {boot.opencodeBin?.split("/").pop()}</span>
          )}
        </div>
      </aside>

      <main className="main">
        {notice && (
          <div className="notice">
            <span>{notice}</span>
            <button className="notice-close" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        )}

        {selected ? (
          <WorkspaceView
            key={selected.id}
            workspace={selected}
            templateName={templateName}
            server={running[selected.id]}
            starting={startingId === selected.id}
            onStart={() => void start(selected.id)}
            onStop={() => void stop(selected.id)}
            onDelete={() => void remove(selected.id)}
            onUpdated={updated}
            onWorkspaceActivity={markUnseen}
          />
        ) : (
          <div className="start-pane">
            <div className="start-card">
              <h2>Workspaces aislados sobre opencode</h2>
              <p className="muted">
                Cada workspace arranca su propio servidor con la configuración, el template, los
                MCPs, las skills y las sesiones que le asignes. Los demás no se enteran.
              </p>
              <Button variant="primary" onClick={() => setCreating(true)}>
                Crear el primero
              </Button>
            </div>
          </div>
        )}
      </main>

      {creating && (
        <CreateWorkspace
          repos={repos}
          templates={templates}
          library={library}
          workspaces={workspaces}
          worktreesRoot={worktreesRoot}
          onClose={() => setCreating(false)}
          onRepoAdded={(repo) => setRepos((prev) => [...prev, repo])}
          onTemplateSaved={(template) => setTemplates((prev) => [...prev, template])}
          onCreated={(workspace, warnings, startNow) => {
            created(workspace, warnings, startNow);
            setCreating(false);
          }}
        />
      )}

      {managing && (
        <ManagePanel
          repos={repos}
          templates={templates}
          library={library}
          workspaces={workspaces}
          worktreesRoot={worktreesRoot}
          defaultTemplateId={boot.settings.defaultTemplateId}
          onReposChanged={setRepos}
          onTemplatesChanged={setTemplates}
          onWorktreesRootChanged={setWorktreesRoot}
          onClose={() => setManaging(false)}
        />
      )}
      {updater.update && (
        <UpdateDialog
          update={updater.update}
          installing={updater.installing}
          installed={updater.installed}
          error={updater.error}
          onInstall={() => void updater.install()}
          onRestart={updater.restart}
          onDismiss={updater.dismiss}
        />
      )}
      {PerformanceCapture && (
        <Suspense fallback={null}>
          <PerformanceCapture />
        </Suspense>
      )}
    </div>
  );
}

export default App;
