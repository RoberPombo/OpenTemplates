import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { CreateWorkspace } from "./components/CreateWorkspace";
import { ManagePanel } from "./components/ManagePanel";
import { WorkspaceView } from "./components/WorkspaceView";
import type {
  Bootstrap,
  Library,
  Repo,
  ServerInfo,
  TemplateManifest,
  Workspace,
} from "./types";
import "./styles.css";

const SELECTED_KEY = "openconf:selected";

const EMPTY_LIBRARY: Library = {
  agents: [],
  commands: [],
  plugins: [],
  skills: [],
  mcps: [],
};

function errorText(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function folderName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY);
  const [worktreesRoot, setWorktreesRoot] = useState("");
  const [running, setRunning] = useState<Record<string, ServerInfo>>({});
  const [selectedId, setSelectedId] = useState<string | null>(
    localStorage.getItem(SELECTED_KEY),
  );
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const selected = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedId) ?? null,
    [workspaces, selectedId],
  );

  const groups = useMemo(() => {
    const byRepo = new Map<string, Workspace[]>();
    for (const workspace of workspaces) {
      const key = workspace.repoId ?? "";
      const list = byRepo.get(key) ?? [];
      list.push(workspace);
      byRepo.set(key, list);
    }
    const result: { key: string; title: string; subtitle?: string; items: Workspace[] }[] =
      [];
    for (const repo of repos) {
      const items = byRepo.get(repo.id);
      if (!items || items.length === 0) continue;
      result.push({
        key: repo.id,
        title: repo.name,
        subtitle: repo.path,
        items,
      });
      byRepo.delete(repo.id);
    }
    const leftovers: Workspace[] = [];
    for (const items of byRepo.values()) leftovers.push(...items);
    if (leftovers.length > 0) {
      result.push({ key: "", title: "Sin repo", items: leftovers });
    }
    return result;
  }, [workspaces, repos]);

  const templateName = useMemo(() => {
    if (!selected?.templateId) return null;
    const template = templates.find((item) => item.id === selected.templateId);
    return template ? `${template.name} · v${selected.templateVersion ?? template.version}` : selected.templateId;
  }, [selected?.templateId, selected?.templateVersion, templates]);

  async function refresh() {
    try {
      const bootstrap = await api.bootstrap();
      setBoot(bootstrap);
      setWorkspaces(bootstrap.workspaces);
      setRepos(bootstrap.repos);
      setTemplates(bootstrap.templates);
      setWorktreesRoot(bootstrap.worktreesRoot);
      setRunning(
        Object.fromEntries(
          bootstrap.running.map((server) => [server.workspaceId, server]),
        ),
      );
      if (bootstrap.notices.length > 0) {
        setNotice(bootstrap.notices.join(" · "));
      }
      setSelectedId((current) => {
        const next =
          current && bootstrap.workspaces.some((w) => w.id === current)
            ? current
            : (bootstrap.workspaces[0]?.id ?? null);
        if (next) localStorage.setItem(SELECTED_KEY, next);
        return next;
      });
      setLibrary(await api.listLibrary());
    } catch (error) {
      setFatal(errorText(error));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void api
        .workspaceStatus()
        .then((items) => {
          setRunning(
            Object.fromEntries(items.map((server) => [server.workspaceId, server])),
          );
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  function select(id: string) {
    setSelectedId(id);
    localStorage.setItem(SELECTED_KEY, id);
    setNotice(null);
  }

  async function start(id: string) {
    setStartingId(id);
    setNotice(null);
    try {
      const server = await api.startWorkspace(id);
      setRunning((prev) => ({ ...prev, [id]: server }));
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setStartingId(null);
    }
  }

  async function stop(id: string) {
    setNotice(null);
    try {
      await api.stopWorkspace(id);
      setRunning((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function remove(id: string) {
    const workspace = workspaces.find((item) => item.id === id);
    if (!workspace) return;

    let force = false;
    if (workspace.mode === "worktree") {
      try {
        const status = await api.worktreeStatus(id);
        if (
          !window.confirm(
            `¿Eliminar el workspace «${workspace.name}»? Se parará el servidor y se quitará el worktree. La rama «${workspace.branch ?? status.branch ?? "de trabajo"}» se conserva.`,
          )
        ) {
          return;
        }
        if (status.dirty) {
          if (
            !window.confirm(
              "El worktree tiene cambios sin commitear. ¿Eliminarlo igualmente? La rama se conservará.",
            )
          ) {
            return;
          }
          force = true;
        }
      } catch (error) {
        setNotice(errorText(error));
        return;
      }
    } else if (
      !window.confirm(
        `¿Eliminar el workspace «${workspace.name}»? Se parará el servidor y se quitará de la lista. La carpeta del proyecto no se toca.`,
      )
    ) {
      return;
    }

    try {
      await api.deleteWorkspace(id, {
        removeWorktree: workspace.mode === "worktree",
        force,
      });
      setWorkspaces((prev) => prev.filter((item) => item.id !== id));
      setRunning((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (selectedId === id) {
        const next = workspaces.find((item) => item.id !== id);
        setSelectedId(next?.id ?? null);
        if (next) localStorage.setItem(SELECTED_KEY, next.id);
        else localStorage.removeItem(SELECTED_KEY);
      }
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function updated(workspace: Workspace, warnings: string[]) {
    setWorkspaces((prev) =>
      prev.map((item) => (item.id === workspace.id ? workspace : item)),
    );
    if (warnings.length > 0) setNotice(warnings.join(" · "));
  }

  if (fatal) {
    return (
      <main className="fatal">
        <h1>OpenConf no pudo arrancar</h1>
        <p>{fatal}</p>
        <button className="primary" onClick={() => window.location.reload()}>
          Reintentar
        </button>
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
      </button>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◒</span>
          <div>
            <strong>OpenConf</strong>
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
            <p className="muted sidebar-empty">
              Sin workspaces. Crea uno para empezar.
            </p>
          )}
        </nav>

        <div className="sidebar-foot">
          <button
            className="ghost sidebar-link"
            onClick={() => setManaging(true)}
          >
            Repos y templates
          </button>
          {boot.error ? (
            <span className="danger-text">{boot.error}</span>
          ) : (
            <span className="muted">
              opencode · {boot.opencodeBin?.split("/").pop()}
            </span>
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
          />
        ) : (
          <div className="start-pane">
            <div className="start-card">
              <h2>Workspaces aislados sobre opencode</h2>
              <p className="muted">
                Cada workspace arranca su propio servidor con la configuración,
                el template, los MCPs, las skills y las sesiones que le asignes.
                Los demás no se enteran.
              </p>
              <button className="primary" onClick={() => setCreating(true)}>
                Crear el primero
              </button>
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
          onTemplateSaved={(template) =>
            setTemplates((prev) => [...prev, template])
          }
          onCreated={(workspace, warnings, startNow) => {
            setWorkspaces((prev) => [...prev, workspace]);
            setCreating(false);
            select(workspace.id);
            if (warnings.length > 0) setNotice(warnings.join(" · "));
            if (startNow) void start(workspace.id);
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
    </div>
  );
}

export default App;
