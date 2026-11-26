/**
 * Datos del Inspector: proyecto/VCS, sesión, límites del proveedor, modelos,
 * MCPs, recursos del sistema y consumo del workspace, con su sondeo.
 *
 * La carga tolera fallos parciales con `Promise.allSettled`: si una fuente cae,
 * el resto se sigue pintando con lo último que hubiera. La vista conserva los
 * derivados de presentación y el render; aquí solo se orquestan los puertos.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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

  const refresh = useCallback(async () => {
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

  const refreshMcp = useCallback(async () => {
    try {
      const result = await client.mcp.list({ location });
      setStatuses(Object.fromEntries(result.data.map((item) => [item.name, item])));
    } catch {
      // El servidor puede estar parando; el siguiente ciclo reintenta.
    }
  }, [client, location]);

  // `mcp.status.changed` avisa cuando un servidor se conecta, falla o cierra:
  // se relee el estado sin esperar al sondeo de 5 s.
  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        for await (const event of client.event.subscribe({ signal: abort.signal })) {
          if (event.type !== "mcp.status.changed") continue;
          await refreshMcp();
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

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive || !active || document.visibilityState === "hidden") return;
      void refresh();
      void refreshSession();
      void refreshStats();
    };
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [active, refresh, refreshSession, refreshStats]);

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
