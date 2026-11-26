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
import type { Bootstrap, Library, Repo, ServerInfo, ProfileManifest, Workspace } from "../../types";

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
  const [profiles, setProfiles] = useState<ProfileManifest[]>([]);
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY);
  const [worktreesRoot, setWorktreesRoot] = useState("");
  const [contexts, setContexts] = useState<ServerInfo[]>([]);
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

  // Un workspace puede tener varios contextos arrancados (un perfil cada uno).
  // `running` conserva el servidor por defecto para el resto de la UI.
  const running = useMemo(() => {
    const map: Record<string, ServerInfo> = {};
    for (const context of contexts) {
      const workspace = workspaces.find((item) => item.id === context.workspaceId);
      const isDefault = Boolean(
        workspace?.contextHash && workspace.contextHash === context.contextHash,
      );
      if (isDefault || !map[context.workspaceId]) {
        map[context.workspaceId] = context;
      }
    }
    return map;
  }, [contexts, workspaces]);

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
      setProfiles(bootstrap.profiles);
      setWorktreesRoot(bootstrap.worktreesRoot);
      setContexts(bootstrap.running);
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
    let alive = true;
    const tick = () => {
      // Con la ventana oculta no hace falta sondear: al volver, visibilitychange
      // lanza un ciclo inmediato.
      if (document.visibilityState === "hidden") return;
      void root.workspaces
        .status()
        .then((items) => {
          if (alive) setContexts(items);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
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
        setContexts((prev) => [...prev.filter((context) => context.workspaceId !== id), server]);
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
        setContexts((prev) => prev.filter((context) => context.workspaceId !== id));
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
        setContexts((prev) => prev.filter((context) => context.workspaceId !== id));
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

  const startProfile = useCallback(
    async (workspaceId: string, profileId: string) => {
      const server = await root.workspaces.startProfile(workspaceId, profileId);
      setContexts((prev) => [
        ...prev.filter((context) => context.contextHash !== server.contextHash),
        server,
      ]);
      return server;
    },
    [root],
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
    markUnseen,
    start,
    startProfile,
    stop,
    remove,
    updated,
    created,
    setNotice,
    setRepos,
    setProfiles,
    setWorktreesRoot,
  };
}
