/**
 * Orquestación de workspaces (carga, polling, selección, arranque/parada/borrado).
 * Consume los puertos del CompositionRoot vía contexto; el borrado delega en el
 * caso de uso DeleteWorkspace (política de confirmación en el dominio).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const MAX_RECENT_WORKSPACES = 8;

function parseRecentWorkspaces(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .slice(0, MAX_RECENT_WORKSPACES);
  } catch {
    return [];
  }
}

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
  const [recentWorkspaceIds, setRecentWorkspaceIds] = useState<string[]>(() =>
    parseRecentWorkspaces(root.preferences.get(prefKeys.recentWorkspaces)),
  );
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  // Avisos sin ver por workspace: turnos o peticiones terminadas sin foco.
  const [unseen, setUnseen] = useState<Record<string, number>>({});

  const selected = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedId) ?? null,
    [workspaces, selectedId],
  );

  const groups = useMemo(() => groupWorkspacesByRepo(workspaces, repos), [workspaces, repos]);

  const rememberWorkspace = useCallback(
    (id: string) => {
      setRecentWorkspaceIds((prev) => {
        const next = [id, ...prev.filter((item) => item !== id)].slice(0, MAX_RECENT_WORKSPACES);
        root.preferences.set(prefKeys.recentWorkspaces, JSON.stringify(next));
        return next;
      });
    },
    [root],
  );

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
      const current = selectedIdRef.current;
      const next =
        current && bootstrap.workspaces.some((workspace) => workspace.id === current)
          ? current
          : (bootstrap.workspaces[0]?.id ?? null);
      if (next) {
        root.preferences.set(prefKeys.selectedWorkspace, next);
        rememberWorkspace(next);
      }
      setSelectedId(next);
      setLibrary(await root.library.library());
    } catch (error) {
      setFatal(errorText(error));
    }
  }, [root, rememberWorkspace]);

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
      rememberWorkspace(id);
      setNotice(null);
      // Mirar el workspace limpia su marca de actividad pendiente.
      setUnseen((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [root, rememberWorkspace],
  );

  const markUnseen = useCallback((id: string) => {
    setUnseen((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  }, []);

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
        setUnseen((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setRunning((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setRecentWorkspaceIds((prev) => {
          if (!prev.includes(id)) return prev;
          const next = prev.filter((item) => item !== id);
          root.preferences.set(prefKeys.recentWorkspaces, JSON.stringify(next));
          return next;
        });
        if (selectedId === id) {
          const next = workspaces.find((item) => item.id !== id);
          setSelectedId(next?.id ?? null);
          if (next) {
            root.preferences.set(prefKeys.selectedWorkspace, next.id);
            rememberWorkspace(next.id);
          } else {
            root.preferences.remove(prefKeys.selectedWorkspace);
          }
        }
      } catch (error) {
        setNotice(errorText(error));
      }
    },
    [root, workspaces, selectedId, rememberWorkspace],
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
    recentWorkspaceIds,
    groups,
    startingId,
    notice,
    unseen,
    fatal,
    select,
    markUnseen,
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
