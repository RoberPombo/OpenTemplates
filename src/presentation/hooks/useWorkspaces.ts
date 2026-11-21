/**
 * Orquestación de workspaces (carga, polling, selección, arranque/parada/borrado).
 * Consume los puertos del CompositionRoot vía contexto; el borrado delega en el
 * caso de uso DeleteWorkspace (política de confirmación en el dominio).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { errorText } from "../../domain/shared";
import { groupWorkspacesByRepo } from "../../domain/workspace/grouping";
import { prefKeys } from "../../domain/repositories/Preferences";
import type {
  Bootstrap,
  Library,
  Repo,
  ServerInfo,
  TemplateManifest,
  Workspace,
} from "../../types";

const EMPTY_LIBRARY: Library = {
  agents: [],
  commands: [],
  plugins: [],
  skills: [],
  mcps: [],
};

export function useWorkspaces() {
  const root = useAppContext();

  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY);
  const [worktreesRoot, setWorktreesRoot] = useState("");
  const [running, setRunning] = useState<Record<string, ServerInfo>>({});
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    root.preferences.get(prefKeys.selectedWorkspace),
  );
  const [startingId, setStartingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const selected = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedId) ?? null,
    [workspaces, selectedId],
  );

  const groups = useMemo(() => groupWorkspacesByRepo(workspaces, repos), [workspaces, repos]);

  const refresh = useCallback(async () => {
    try {
      const bootstrap = await root.bootstrap.bootstrap();
      setBoot(bootstrap);
      setWorkspaces(bootstrap.workspaces);
      setRepos(bootstrap.repos);
      setTemplates(bootstrap.templates);
      setWorktreesRoot(bootstrap.worktreesRoot);
      setRunning(
        Object.fromEntries(bootstrap.running.map((server) => [server.workspaceId, server])),
      );
      if (bootstrap.notices.length > 0) {
        setNotice(bootstrap.notices.join(" · "));
      }
      setSelectedId((current) => {
        const next =
          current && bootstrap.workspaces.some((w) => w.id === current)
            ? current
            : (bootstrap.workspaces[0]?.id ?? null);
        if (next) root.preferences.set(prefKeys.selectedWorkspace, next);
        return next;
      });
      setLibrary(await root.library.library());
    } catch (error) {
      setFatal(errorText(error));
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void root.workspaces
        .status()
        .then((items) => {
          setRunning(Object.fromEntries(items.map((server) => [server.workspaceId, server])));
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [root]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      root.preferences.set(prefKeys.selectedWorkspace, id);
      setNotice(null);
    },
    [root],
  );

  const start = useCallback(
    async (id: string) => {
      setStartingId(id);
      setNotice(null);
      try {
        const server = await root.workspaces.start(id);
        setRunning((prev) => ({ ...prev, [id]: server }));
      } catch (error) {
        setNotice(errorText(error));
      } finally {
        setStartingId(null);
      }
    },
    [root],
  );

  const stop = useCallback(
    async (id: string) => {
      setNotice(null);
      try {
        await root.workspaces.stop(id);
        setRunning((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } catch (error) {
        setNotice(errorText(error));
      }
    },
    [root],
  );

  const remove = useCallback(
    async (id: string) => {
      const workspace = workspaces.find((item) => item.id === id);
      if (!workspace) return;
      try {
        const { deleted } = await root.provideDeleteWorkspace().execute(workspace);
        if (!deleted) return;
        setWorkspaces((prev) => prev.filter((item) => item.id !== id));
        setRunning((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (selectedId === id) {
          const next = workspaces.find((item) => item.id !== id);
          setSelectedId(next?.id ?? null);
          if (next) root.preferences.set(prefKeys.selectedWorkspace, next.id);
          else root.preferences.remove(prefKeys.selectedWorkspace);
        }
      } catch (error) {
        setNotice(errorText(error));
      }
    },
    [root, workspaces, selectedId],
  );

  const updated = useCallback((workspace: Workspace, warnings: string[]) => {
    setWorkspaces((prev) => prev.map((item) => (item.id === workspace.id ? workspace : item)));
    if (warnings.length > 0) setNotice(warnings.join(" · "));
  }, []);

  const created = useCallback(
    (workspace: Workspace, warnings: string[], startNow: boolean) => {
      setWorkspaces((prev) => [...prev, workspace]);
      select(workspace.id);
      if (warnings.length > 0) setNotice(warnings.join(" · "));
      if (startNow) void start(workspace.id);
    },
    [select, start],
  );

  return {
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
    fatal,
    select,
    start,
    stop,
    remove,
    updated,
    created,
    setNotice,
    setRepos,
    setTemplates,
    setWorktreesRoot,
  };
}
