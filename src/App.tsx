import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { folderName } from "./domain/shared";
import { useWorkspaces } from "./presentation/hooks/useWorkspaces";
import { CreateWorkspace } from "./presentation/components/CreateWorkspace";
import { ManagePanel } from "./presentation/components/ManagePanel";
import { UpdateDialog } from "./presentation/components/UpdateDialog";
import { WorkspaceView } from "./presentation/components/WorkspaceView";
import { CommandPalette } from "./presentation/components/CommandPalette";
import { useCommandActions } from "./presentation/context/CommandActions";
import { buildPaletteCommands } from "./domain/palette/catalog";
import { formatShortcut, resolveShortcut, shortcutFor } from "./domain/palette/keybindings";
import { Button } from "./presentation/components/ui";
import { useUpdater } from "./presentation/hooks/useUpdater";
import type { Workspace } from "./types";
import "./styles.css";

const PALETTE_SHORTCUT = shortcutFor("palette.open");

const PerformanceCapture = import.meta.env.DEV
  ? lazy(() => import("./presentation/components/PerformanceCapture"))
  : null;

function App() {
  const {
    boot,
    workspaces,
    repos,
    profiles,
    library,
    worktreesRoot,
    running,
    contexts,
    selectedId,
    selected,
    recentWorkspaceIds,
    groups,
    startingId,
    notice,
    unseen,
    fatal,
    select,
    start,
    startProfile,
    stop,
    remove,
    updated,
    created,
    markUnseen,
    setNotice,
    setRepos,
    setProfiles,
    setWorktreesRoot,
  } = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { entries, run: runRegisteredAction } = useCommandActions();
  const updater = useUpdater();

  const paletteCommands = useMemo(
    () =>
      buildPaletteCommands({
        workspace: selected
          ? {
              id: selected.id,
              name: selected.name,
              detail:
                selected.mode === "worktree"
                  ? (selected.branch ?? folderName(selected.projectPath))
                  : selected.projectPath,
            }
          : null,
        workspaces: workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          detail:
            workspace.mode === "worktree"
              ? (workspace.branch ?? folderName(workspace.projectPath))
              : workspace.projectPath,
        })),
        recentWorkspaceIds,
        hasServer: Boolean(selected && running[selected.id]),
        handlers: entries,
      }),
    [selected, workspaces, recentWorkspaceIds, running, entries],
  );

  const runPaletteAction = useCallback(
    (id: string) => {
      if (id === "workspace.create") {
        setCreating(true);
        return true;
      }
      if (id === "workspace.next" || id === "workspace.previous") {
        if (workspaces.length < 2) return false;
        const current = workspaces.findIndex((workspace) => workspace.id === selectedId);
        const delta = id === "workspace.next" ? 1 : -1;
        const from = current < 0 ? (delta === 1 ? -1 : 0) : current;
        const index = (from + delta + workspaces.length) % workspaces.length;
        select(workspaces[index].id);
        return true;
      }
      if (id.startsWith("workspace.select:")) {
        const workspaceId = id.slice("workspace.select:".length);
        if (!workspaces.some((workspace) => workspace.id === workspaceId)) return false;
        select(workspaceId);
        return true;
      }
      if (id === "palette.open") {
        setPaletteOpen(true);
        return true;
      }
      return runRegisteredAction(id);
    },
    [workspaces, selectedId, select, runRegisteredAction],
  );

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (paletteOpen) return;
      // Los modales existentes gestionan su propia interacción; no actuamos detrás.
      if (document.querySelector(".modal-backdrop")) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const tag = target?.tagName.toLowerCase();
      const inComposer = tag === "textarea";
      const inEditable =
        inComposer || tag === "input" || tag === "select" || Boolean(target?.isContentEditable);
      const action = resolveShortcut(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          defaultPrevented: event.defaultPrevented,
        },
        { paletteOpen, inComposer, inEditable },
      );
      if (!action) return;
      if (runPaletteAction(action)) event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, runPaletteAction]);

  const sharedWith = useMemo(() => {
    if (!selected) return [];
    const hash = running[selected.id]?.contextHash;
    if (!hash) return [];
    return Object.values(running)
      .filter((server) => server.contextHash === hash && server.workspaceId !== selected.id)
      .map(
        (server) =>
          workspaces.find((item) => item.id === server.workspaceId)?.name ?? server.workspaceId,
      );
  }, [running, selected, workspaces]);

  const profileName = useMemo(() => {
    if (!selected?.profileId) return null;
    const profile = profiles.find((item) => item.id === selected.profileId);
    return profile
      ? `${profile.name} · v${selected.profileVersion ?? profile.version}`
      : selected.profileId;
  }, [selected?.profileId, selected?.profileVersion, profiles]);

  const selectedRepoPath = useMemo(() => {
    if (!selected?.repoId) return null;
    return repos.find((repo) => repo.id === selected.repoId)?.path ?? null;
  }, [selected?.repoId, repos]);

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
          <Button
            variant="ghost"
            className="sidebar-link command-trigger"
            onClick={() => setPaletteOpen(true)}
          >
            <span>Comandos</span>
            {PALETTE_SHORTCUT && (
              <kbd className="command-trigger-key">
                {formatShortcut(PALETTE_SHORTCUT, navigator.platform || "linux")}
              </kbd>
            )}
          </Button>
          <Button variant="ghost" className="sidebar-link" onClick={() => setManaging(true)}>
            Repos y perfiles
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
            profileName={profileName}
            sharedWith={sharedWith}
            contexts={contexts.filter((context) => context.workspaceId === selected.id)}
            profiles={profiles}
            onStartProfile={startProfile}
            server={running[selected.id]}
            starting={startingId === selected.id}
            onStart={() => void start(selected.id)}
            onStop={() => void stop(selected.id)}
            onDelete={() => void remove(selected.id)}
            onUpdated={updated}
            onWorkspaceActivity={markUnseen}
            worktreesRoot={worktreesRoot}
            repoPath={selectedRepoPath}
          />
        ) : (
          <div className="start-pane">
            <div className="start-card">
              <h2>Workspaces aislados sobre opencode</h2>
              <p className="muted">
                Cada workspace arranca su propio servidor con la configuración, el perfil, los MCPs,
                las skills y las sesiones que le asignes. Los demás no se enteran.
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
          profiles={profiles}
          library={library}
          workspaces={workspaces}
          worktreesRoot={worktreesRoot}
          onClose={() => setCreating(false)}
          onRepoAdded={(repo) => setRepos((prev) => [...prev, repo])}
          onProfileSaved={(profile) => setProfiles((prev) => [...prev, profile])}
          onCreated={(workspace, warnings, startNow) => {
            created(workspace, warnings, startNow);
            setCreating(false);
          }}
        />
      )}

      {managing && (
        <ManagePanel
          repos={repos}
          profiles={profiles}
          library={library}
          workspaces={workspaces}
          worktreesRoot={worktreesRoot}
          defaultProfileId={boot.settings.defaultProfileId}
          onReposChanged={setRepos}
          onProfilesChanged={setProfiles}
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
      {paletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onRun={runPaletteAction}
          onClose={() => setPaletteOpen(false)}
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
