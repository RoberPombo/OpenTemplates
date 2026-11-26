import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { errorText, folderName } from "./domain/shared";
import { useWorkspaces } from "./presentation/hooks/useWorkspaces";
import { useFeatures } from "./presentation/hooks/useFeatures";
import { CreateWorkspace } from "./presentation/components/CreateWorkspace";
import { FeatureDialog } from "./presentation/components/FeatureDialog";
import { FeatureView } from "./presentation/components/FeatureView";
import type { SettingsSectionId } from "./presentation/components/SettingsDialog";
import { UpdateDialog } from "./presentation/components/UpdateDialog";
import { WorkspaceView } from "./presentation/components/WorkspaceView";
import { CommandPalette } from "./presentation/components/CommandPalette";
import { useCommandActions } from "./presentation/context/CommandActions";
import { buildPaletteCommands } from "./domain/palette/catalog";
import { resolvePaletteAction } from "./domain/palette/actions";
import { formatShortcut, resolveShortcut, shortcutFor } from "./domain/palette/keybindings";
import { Button } from "./presentation/components/ui";
import { useUpdater } from "./presentation/hooks/useUpdater";
import { useAppContext } from "./presentation/context/AppContext";
import type { Workspace } from "./types";
import type { ChatGateway } from "./domain/repositories/ChatGateway";
import "./styles.css";

const PALETTE_SHORTCUT = shortcutFor("palette.open");

const SettingsDialog = lazy(() =>
  import("./presentation/components/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
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
  const featuresState = useFeatures();
  const root = useAppContext();
  const [creating, setCreating] = useState(false);
  const [creatingFeature, setCreatingFeature] = useState(false);
  const [settings, setSettings] = useState<{
    section: SettingsSectionId;
    client?: ChatGateway | null;
  } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { entries, run: runRegisteredAction } = useCommandActions();
  const updater = useUpdater();

  const settingsServer = selected ? running[selected.id] : undefined;
  // El gateway se recrea solo cuando cambian los datos de conexión del servidor,
  // igual que en WorkspaceView: `settingsServer` cambia de identidad en cada
  // sondeo y recrearlo reiniciaría efectos del diálogo.
  // oxlint-disable react-hooks/exhaustive-deps -- gateway estable por URL/contraseña
  const settingsClient = useMemo(
    () => (settingsServer ? root.provideChatGateway(settingsServer) : null),
    [root, settingsServer?.baseUrl, settingsServer?.password],
  );
  // oxlint-enable react-hooks/exhaustive-deps

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
      const action = resolvePaletteAction(id, { workspaces, selectedId, handlers: entries });
      switch (action.kind) {
        case "create":
          setCreating(true);
          return true;
        case "select":
          select(action.workspaceId);
          return true;
        case "cycle":
          if (!action.workspaceId) return false;
          select(action.workspaceId);
          return true;
        case "openPalette":
          setPaletteOpen(true);
          return true;
        case "delegate":
          return runRegisteredAction(action.id);
        case "unknown":
          return false;
      }
    },
    [workspaces, selectedId, select, runRegisteredAction, entries],
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

  const selectedProfileId = selected?.profileId;
  const selectedProfileVersion = selected?.profileVersion;
  const profileName = useMemo(() => {
    if (!selectedProfileId) return null;
    const profile = profiles.find((item) => item.id === selectedProfileId);
    return profile
      ? `${profile.name} · v${selectedProfileVersion ?? profile.version}`
      : selectedProfileId;
  }, [selectedProfileId, selectedProfileVersion, profiles]);

  const selectedRepoId = selected?.repoId;
  const selectedRepoPath = useMemo(() => {
    if (!selectedRepoId) return null;
    return repos.find((repo) => repo.id === selectedRepoId)?.path ?? null;
  }, [selectedRepoId, repos]);

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
        className={`workspace-item ${
          featuresState.selected ? "" : selectedId === workspace.id ? "active" : ""
        } ${workspace.missing ? "missing" : ""}`}
        onClick={() => {
          featuresState.clearSelection();
          select(workspace.id);
        }}
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

        <section className="feature-side">
          <div className="group-head">
            <span>Features</span>
            <span className="group-count">{featuresState.features.length}</span>
          </div>
          <button className="new-feature" onClick={() => setCreatingFeature(true)}>
            <span>+</span> Nueva feature
          </button>
          {featuresState.features.map((feature) => (
            <button
              key={feature.id}
              className={`workspace-item ${
                featuresState.selectedId === feature.id ? "active" : ""
              }`}
              aria-label={feature.name}
              onClick={() => featuresState.select(feature.id)}
            >
              <span className={`dot status-${feature.status}`} />
              <span className="workspace-meta">
                <span className="workspace-name">{feature.name}</span>
                <span className="workspace-project">
                  {feature.kind} ·{" "}
                  {feature.targets.length === 1 ? "1 repo" : `${feature.targets.length} repos`}
                  {feature.status === "blocked" ? " · bloqueada" : ""}
                </span>
              </span>
            </button>
          ))}
          {featuresState.features.length === 0 && (
            <p className="muted sidebar-empty">Sin features. Crea una para empezar.</p>
          )}
        </section>

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
          <Button
            variant="ghost"
            className="sidebar-link"
            onClick={() => setSettings({ section: "appearance" })}
          >
            Ajustes
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

        {featuresState.error && !featuresState.selected && (
          <div className="notice">
            <span className="danger-text">{featuresState.error}</span>
            <button className="notice-close" onClick={() => featuresState.setError(null)}>
              ×
            </button>
          </div>
        )}

        {featuresState.selected ? (
          <FeatureView
            key={featuresState.selected.id}
            feature={featuresState.selected}
            artifacts={featuresState.artifacts}
            profiles={profiles}
            defaultProfileId={boot.settings.defaultProfileId}
            runner={featuresState.coordinator}
            coordinatorBusy={featuresState.coordinatorBusy}
            busy={featuresState.busyId === featuresState.selected.id}
            notice={featuresState.notice}
            error={featuresState.error}
            onProvision={() =>
              void featuresState.provision(featuresState.selected!.id).catch(() => undefined)
            }
            onSaveArtifact={featuresState.saveArtifact}
            onReloadArtifacts={featuresState.reloadArtifacts}
            onLaunchCoordinator={(profileId) =>
              featuresState.launchCoordinator(featuresState.selected!.id, profileId)
            }
            onStopCoordinator={() => featuresState.stopCoordinator(featuresState.selected!.id)}
            onApproveDecomposition={(content) =>
              featuresState.approveDecomposition(featuresState.selected!.id, content)
            }
            onDelete={() => void featuresState.remove(featuresState.selected!.id)}
            onBack={() => featuresState.clearSelection()}
          />
        ) : selected ? (
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
            onOpenSettings={(client) => setSettings({ section: "model", client })}
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

      {creatingFeature && (
        <FeatureDialog
          repos={repos}
          dataDir={boot.dataDir}
          onClose={() => setCreatingFeature(false)}
          onCreated={(draft) => {
            setCreatingFeature(false);
            void featuresState.start(draft).catch((err) => featuresState.setError(errorText(err)));
          }}
        />
      )}

      {settings && (
        <Suspense fallback={null}>
          <SettingsDialog
            workspace={selected}
            client={settings.client !== undefined ? settings.client : settingsClient}
            onWorkspaceUpdated={updated}
            repos={repos}
            profiles={profiles}
            library={library}
            workspaces={workspaces}
            worktreesRoot={worktreesRoot}
            defaultProfileId={boot.settings.defaultProfileId}
            onReposChanged={setRepos}
            onProfilesChanged={setProfiles}
            onWorktreesRootChanged={setWorktreesRoot}
            initialSection={settings.section}
            onClose={() => setSettings(null)}
          />
        </Suspense>
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
