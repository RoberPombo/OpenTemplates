/**
 * Datos del Inspector: proyecto/VCS, sesión, límites del proveedor, modelos,
 * MCPs, recursos del sistema y consumo del workspace, con su sondeo.
 *
 * La carga tolera fallos parciales con `Promise.allSettled`: si una fuente cae,
 * el resto se sigue pintando con lo último que hubiera. La vista conserva los
 * derivados de presentación y el render; aquí solo se orquestan los puertos.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompositionRoot } from "../../CompositionRoot";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import { prefKeys } from "../../domain/repositories/Preferences";
import { errorText } from "../../domain/shared";
import type { CatalogModel } from "../../domain/chat/selection";
import type { McpServerStatus } from "../../domain/chat/mcp";
import {
  parseBudgetUsd,
  toSessionUsage,
  usageStatsInput,
  type SessionUsage,
  type UsageLimits,
  type UsageRange,
  type WorkspaceStats,
} from "../../domain/chat/usage";
import type { ResourceUsage, ServerInfo, Workspace } from "../../types";

export type InspectorProjectSummary = {
  branch: string | null;
  files: number;
  additions: number;
  deletions: number;
};

export type UseInspectorDataInput = {
  client: ChatServer;
  root: CompositionRoot;
  workspace: Workspace;
  server: ServerInfo;
  sessionId: string | null;
  /** Rango de consumo elegido en la vista; forma parte de la consulta. */
  usageRange: UsageRange;
  /** El sondeo solo corre mientras la pestaña de resumen está visible. */
  active: boolean;
};

function safe<T>(call: () => Promise<T>): Promise<T> {
  try {
    return call();
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Cadencia de sondeo con la ventana en primer plano y actividad reciente. */
export const INSPECTOR_POLL_FAST_MS = 5_000;
/** Cadencia cuando el inspector lleva más de `INSPECTOR_POLL_FAST_WINDOW_MS` abierto. */
export const INSPECTOR_POLL_SLOW_MS = 15_000;
/** Ventana tras el último evento o refresco manual en la que se mantiene el sondeo rápido. */
export const INSPECTOR_POLL_FAST_WINDOW_MS = 2 * 60_000;

/**
 * El sondeo solo corre con la pestaña visible y la ventana enfocada. `hasFocus`
 * cubre el caso de una app tapada por otra con la pestaña aún "visible".
 */
function canPoll(): boolean {
  return document.visibilityState !== "hidden" && document.hasFocus();
}

export function useInspectorData({
  client,
  root,
  workspace,
  server,
  sessionId,
  usageRange,
  active,
}: UseInspectorDataInput) {
  const [project, setProject] = useState<InspectorProjectSummary | null>(null);
  const [session, setSession] = useState<SessionUsage | null>(null);
  const [usage, setUsage] = useState<UsageLimits | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({});
  const [resources, setResources] = useState<ResourceUsage | null>(null);
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [monthlyBudget, setMonthlyBudget] = useState<number | null>(() =>
    parseBudgetUsd(root.preferences.get(prefKeys.budget(workspace.id))),
  );
  /** Inicio de la ventana de sondeo rápido; el efecto lo fija y lo reinician eventos y refresco manual. */
  const pollStartedAt = useRef(0);
  /** Rearma el temporizador desde fuera del efecto de sondeo (eventos MCP, refresco manual). */
  const restartPolling = useRef<() => void>(() => {});

  const location = useMemo(() => ({ directory: workspace.projectPath }), [workspace.projectPath]);
  const timeZone = useMemo(() => {
    try {
      return new Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    setStats(null);
    setStatsError(null);
    setMonthlyBudget(parseBudgetUsd(root.preferences.get(prefKeys.budget(workspace.id))));
  }, [root, workspace.id]);

  useEffect(() => {
    let alive = true;
    safe(() => client.model.list({ location, types: ["chat"] }))
      .then((result) => {
        if (alive) setModels(result.data);
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client, location]);

  const loadSnapshot = useCallback(async () => {
    const [vcs, vcsInfo, limits, mcpList, resourcesNow] = await Promise.allSettled([
      safe(() => client.vcs.status({ location })),
      safe(() => client.vcs.get({ location })),
      safe(() => client.usage.limits()),
      safe(() => client.mcp.list({ location })),
      root.resources.usage(server.pid),
    ]);

    if (vcs.status === "fulfilled") {
      const files = vcs.value.data;
      setProject((prev) => ({
        branch:
          vcsInfo.status === "fulfilled"
            ? (vcsInfo.value.data.branch.current ?? null)
            : (prev?.branch ?? null),
        files: files.length,
        additions: files.reduce((total, file) => total + file.additions, 0),
        deletions: files.reduce((total, file) => total + file.deletions, 0),
      }));
    } else if (vcsInfo.status === "fulfilled") {
      setProject((prev) => ({
        branch: vcsInfo.value.data.branch.current ?? null,
        files: prev?.files ?? 0,
        additions: prev?.additions ?? 0,
        deletions: prev?.deletions ?? 0,
      }));
    }

    if (limits.status === "fulfilled") {
      setUsage(limits.value.data ?? null);
    }

    if (mcpList.status === "fulfilled") {
      setStatuses(Object.fromEntries(mcpList.value.data.map((item) => [item.name, item])));
    }

    setResources(resourcesNow.status === "fulfilled" ? resourcesNow.value : null);
  }, [client, location, server.pid, root]);

  /**
   * Refresco manual de la vista: relee la instantánea y vuelve a la cadencia
   * rápida, porque la interacción indica que el usuario está mirando.
   */
  const refresh = useCallback(async () => {
    restartPolling.current();
    await loadSnapshot();
  }, [loadSnapshot]);

  const refreshMcp = useCallback(async () => {
    try {
      const result = await client.mcp.list({ location });
      setStatuses(Object.fromEntries(result.data.map((item) => [item.name, item])));
    } catch {
      // El servidor puede estar parando; el siguiente ciclo reintenta.
    }
  }, [client, location]);

  // `mcp.status.changed` avisa cuando un servidor se conecta, falla o cierra:
  // se relee el estado sin esperar al sondeo y se rearma el backoff.
  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        for await (const event of client.event.subscribe({ signal: abort.signal })) {
          if (event.type !== "mcp.status.changed") continue;
          await refreshMcp();
          restartPolling.current();
        }
      } catch {
        // El cierre de la suscripción no es un error de la vista.
      }
    })();
    return () => abort.abort();
  }, [client, refreshMcp]);

  const refreshSession = useCallback(async () => {
    if (!sessionId) {
      setSession(null);
      return;
    }
    try {
      const [messages, info] = await Promise.all([
        client.message.list({
          sessionID: sessionId,
          limit: 10,
          order: "desc",
        }),
        client.session.get({ sessionID: sessionId }).catch(() => null),
      ]);
      setSession(toSessionUsage(messages.data, info));
    } catch {
      setSession(null);
    }
  }, [client, sessionId]);

  const refreshStats = useCallback(async () => {
    setMonthlyBudget(parseBudgetUsd(root.preferences.get(prefKeys.budget(workspace.id))));
    try {
      const result = await client.session.stats(usageStatsInput(usageRange, Date.now(), timeZone));
      setStats(result.data);
      setStatsError(null);
    } catch (err) {
      setStats(null);
      setStatsError(errorText(err));
    }
  }, [client, root, timeZone, usageRange, workspace.id]);

  // Sondeo adaptativo: primer ciclo inmediato y luego 5 s durante la ventana
  // reciente, 15 s cuando el inspector lleva un rato abierto. Solo corre con la
  // ventana enfocada y la pestaña visible; al recuperar el foco se refresca una
  // vez y se rearma el temporizador.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: number | null = null;

    const stopTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      stopTimer();
      if (!alive || !canPoll()) return;
      const fast = Date.now() - pollStartedAt.current < INSPECTOR_POLL_FAST_WINDOW_MS;
      timer = window.setTimeout(poll, fast ? INSPECTOR_POLL_FAST_MS : INSPECTOR_POLL_SLOW_MS);
    };

    const poll = () => {
      if (!alive) return;
      timer = null;
      // Sin foco no hay peticiones periódicas: los listeners reanudan al volver.
      if (!canPoll()) return;
      void loadSnapshot();
      void refreshSession();
      void refreshStats();
      schedule();
    };

    // Vuelta a primer plano: un refresco inmediato y el intervalo desde ahora.
    const resume = () => {
      if (!alive || timer !== null || !canPoll()) return;
      void loadSnapshot();
      void refreshSession();
      void refreshStats();
      schedule();
    };

    const onFocusChanged = () => {
      if (!alive) return;
      if (canPoll()) resume();
      else stopTimer();
    };

    // El primer ciclo no espera al intervalo ni al foco.
    pollStartedAt.current = Date.now();
    void loadSnapshot();
    void refreshSession();
    void refreshStats();
    if (canPoll()) schedule();

    restartPolling.current = () => {
      pollStartedAt.current = Date.now();
      if (canPoll()) schedule();
      else stopTimer();
    };

    document.addEventListener("visibilitychange", onFocusChanged);
    window.addEventListener("focus", onFocusChanged);
    window.addEventListener("blur", onFocusChanged);

    return () => {
      alive = false;
      stopTimer();
      restartPolling.current = () => {};
      document.removeEventListener("visibilitychange", onFocusChanged);
      window.removeEventListener("focus", onFocusChanged);
      window.removeEventListener("blur", onFocusChanged);
    };
  }, [active, loadSnapshot, refreshSession, refreshStats]);

  return {
    project,
    session,
    usage,
    models,
    statuses,
    resources,
    stats,
    statsError,
    monthlyBudget,
    location,
    timeZone,
    refresh,
    refreshMcp,
    refreshSession,
    refreshStats,
  };
}
