import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { errorText } from "../domain/shared";
import {
  cacheRatio as computeCacheRatio,
  contextRatio as computeContextRatio,
  toSessionUsage,
  type SessionUsage,
  type UsageLimits,
} from "../domain/chat/usage";
import type { CatalogModel } from "../domain/chat/selection";
import type { ChatServer } from "../domain/repositories/ChatGateway";
import type { ResourceUsage, ServerInfo, SkillRef, Workspace } from "../types";

type Props = {
  workspace: Workspace;
  client: ChatServer;
  server: ServerInfo;
  sessionId: string | null;
  onUpdated: (workspace: Workspace, warnings: string[]) => void;
  onClose: () => void;
};

type ProjectSummary = {
  branch: string | null;
  files: number;
  additions: number;
  deletions: number;
};

function safe<T>(call: () => Promise<T>): Promise<T> {
  try {
    return call();
  } catch (error) {
    return Promise.reject(error);
  }
}

function percent(value: number) {
  return `${value.toFixed(1)}%`;
}

function tokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function bytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function resetText(at: number) {
  const delta = at - Date.now();
  if (!Number.isFinite(at) || delta <= 0) return "ahora";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `en ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `en ${hours} h ${minutes % 60} min`;
  return `en ${Math.round(hours / 24)} d`;
}

function statusOf(status: unknown) {
  if (typeof status === "string") return status;
  const value = (status as { status?: string } | null)?.status;
  return value ?? "unknown";
}

function statusTone(status: string) {
  if (status === "connected") return "ok";
  if (status === "failed") return "bad";
  if (status === "needs_auth" || status === "pending") return "warn";
  return "";
}

function Bar({ ratio }: { ratio: number | null }) {
  const value = ratio === null ? 0 : Math.max(0, Math.min(1, ratio));
  return (
    <div className="inspector-bar">
      <span style={{ width: `${value * 100}%` }} />
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector-line">
      <span>{label}</span>
      <span className="inspector-value">{value}</span>
    </div>
  );
}

export function Inspector({ workspace, client, server, sessionId, onUpdated, onClose }: Props) {
  const root = useAppContext();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [session, setSession] = useState<SessionUsage | null>(null);
  const [usage, setUsage] = useState<UsageLimits | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [resources, setResources] = useState<ResourceUsage | null>(null);
  const [savingMcp, setSavingMcp] = useState<string | null>(null);
  const [savingSkill, setSavingSkill] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const location = useMemo(() => ({ directory: workspace.projectPath }), [workspace.projectPath]);

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
    const [vcs, vcsInfo, limits, mcpList, stats] = await Promise.allSettled([
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
      const next: Record<string, string> = {};
      for (const item of mcpList.value.data) next[item.name] = statusOf(item.status);
      setStatuses(next);
    }

    setResources(stats.status === "fulfilled" ? stats.value : null);
  }, [client, location, server.pid, root]);

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

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      void refresh();
      void refreshSession();
    };
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refresh, refreshSession]);

  const modelEntry = session?.model
    ? (models.find(
        (entry) =>
          entry.providerID === session.model?.providerID && entry.modelID === session.model?.id,
      ) ?? null)
    : null;

  const contextRatio = useMemo(
    () => computeContextRatio(session, modelEntry?.limit?.context),
    [session, modelEntry],
  );

  const cacheRatio = useMemo(() => computeCacheRatio(session), [session]);

  const mcpNames = useMemo(
    () => [...workspace.mcpNames].sort((a, b) => a.localeCompare(b)),
    [workspace.mcpNames],
  );

  const activeSkills = useMemo(
    () => [...workspace.skills].sort((a, b) => a.id.localeCompare(b.id)),
    [workspace.skills],
  );

  const enabledMcps = mcpNames.filter((name) => !workspace.disabledMcps.includes(name));
  const enabledSkills = activeSkills.filter(
    (skill) => !workspace.disabledSkills.includes(skill.id),
  );

  async function saveDisabled(disabledMcps: string[], disabledSkills: string[]) {
    const outcome = await root.workspaces.setDisabled({
      id: workspace.id,
      disabledMcps,
      disabledSkills,
    });
    onUpdated(outcome.workspace, outcome.warnings);
    await client.location.reload().catch(() => undefined);
    await refresh();
  }

  async function toggleMcp(name: string, enabled: boolean) {
    setSavingMcp(name);
    setError(null);
    try {
      const disabled = enabled
        ? workspace.disabledMcps.filter((item) => item !== name)
        : [...workspace.disabledMcps, name];
      await saveDisabled(disabled, workspace.disabledSkills);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingMcp(null);
    }
  }

  async function toggleSkill(skill: SkillRef, enabled: boolean) {
    setSavingSkill(skill.id);
    setError(null);
    try {
      const disabled = enabled
        ? workspace.disabledSkills.filter((item) => item !== skill.id)
        : [...workspace.disabledSkills, skill.id];
      await saveDisabled(workspace.disabledMcps, disabled);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingSkill(null);
    }
  }

  const folder = workspace.projectPath.split("/").filter(Boolean).pop() ?? workspace.projectPath;
  const system = resources?.system;
  const budgets = usage?.budgets ?? [];
  const hasUsage = Boolean(usage?.go || budgets.length > 0);

  function mcpRow(name: string) {
    const enabled = !workspace.disabledMcps.includes(name);
    const status = statuses[name];
    return (
      <div className="inspector-switch-row" key={name}>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? "Desactivar" : "Activar"} ${name}`}
          className={`switch ${enabled ? "on" : ""}`}
          disabled={savingMcp !== null}
          onClick={() => void toggleMcp(name, !enabled)}
        >
          <span />
        </button>
        <span className="inspector-switch-label" title={name}>
          {name}
        </span>
        {status && <span className={`inspector-dot ${statusTone(status)}`} title={status} />}
      </div>
    );
  }

  function skillRow(skill: SkillRef) {
    const enabled = !workspace.disabledSkills.includes(skill.id);
    return (
      <div className="inspector-switch-row" key={skill.id}>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? "Desactivar" : "Activar"} ${skill.id}`}
          className={`switch ${enabled ? "on" : ""}`}
          disabled={savingSkill !== null}
          onClick={() => void toggleSkill(skill, !enabled)}
        >
          <span />
        </button>
        <span className="inspector-switch-label" title={skill.path}>
          {skill.id}
        </span>
      </div>
    );
  }

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <strong>Panel</strong>
        <button className="icon-button" title="Ocultar panel" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="inspector-body">
        {error && <div className="inline-error small-text">{error}</div>}

        <section className="inspector-section">
          <h3>Sesión</h3>
          {session ? (
            <>
              <div className="inspector-line">
                <span>Contexto</span>
                <span className="inspector-value">
                  {contextRatio === null ? "—" : percent(contextRatio * 100)}
                </span>
              </div>
              <Bar ratio={contextRatio} />
              <Line
                label="Acierto de caché"
                value={cacheRatio === null ? "—" : percent(cacheRatio * 100)}
              />
              <Line
                label="Tokens"
                value={`${tokens(session.input)} in · ${tokens(session.output)} out`}
              />
              <Line label="Coste" value={`$${session.cost.toFixed(3)}`} />
              {modelEntry && (
                <p
                  className="inspector-note"
                  title={`${modelEntry.providerID}/${modelEntry.modelID}`}
                >
                  {modelEntry.name ?? modelEntry.modelID}
                </p>
              )}
            </>
          ) : (
            <p className="inspector-empty">Sin actividad todavía.</p>
          )}
        </section>

        <section className="inspector-section">
          <h3>Proyecto</h3>
          <div className="inspector-line">
            <span className="inspector-strong" title={workspace.projectPath}>
              {folder}
            </span>
            {project?.branch && <span className="inspector-tag">⎇ {project.branch}</span>}
          </div>
          <div className="inspector-line">
            <span>
              {project
                ? `${project.files} ${project.files === 1 ? "archivo" : "archivos"} modificados`
                : "Sin datos de git"}
            </span>
            {project && project.files > 0 && (
              <span className="inspector-value">
                <span className="inspector-add">+{project.additions}</span>{" "}
                <span className="inspector-del">−{project.deletions}</span>
              </span>
            )}
          </div>
        </section>

        {hasUsage && (
          <section className="inspector-section">
            <h3>Uso</h3>
            {usage?.go?.rolling && (
              <>
                <div className="inspector-line">
                  <span>5 h</span>
                  <span className="inspector-value">
                    {percent(usage.go.rolling.percent)}{" "}
                    <span className="inspector-muted">{resetText(usage.go.rolling.resetsAt)}</span>
                  </span>
                </div>
                <Bar ratio={usage.go.rolling.percent / 100} />
              </>
            )}
            {usage?.go?.weekly && (
              <>
                <div className="inspector-line">
                  <span>Semanal</span>
                  <span className="inspector-value">
                    {percent(usage.go.weekly.percent)}{" "}
                    <span className="inspector-muted">{resetText(usage.go.weekly.resetsAt)}</span>
                  </span>
                </div>
                <Bar ratio={usage.go.weekly.percent / 100} />
              </>
            )}
            {usage?.go?.monthly && (
              <>
                <div className="inspector-line">
                  <span>Mensual</span>
                  <span className="inspector-value">
                    {percent(usage.go.monthly.percent)}{" "}
                    <span className="inspector-muted">{resetText(usage.go.monthly.resetsAt)}</span>
                  </span>
                </div>
                <Bar ratio={usage.go.monthly.percent / 100} />
              </>
            )}
            {budgets.map((budget) => {
              const ratio = budget.limit > 0 ? budget.spent / budget.limit : null;
              return (
                <div key={budget.id}>
                  <Line
                    label="Saldo"
                    value={`$${Math.max(0, budget.limit - budget.spent).toFixed(2)}`}
                  />
                  <Bar ratio={ratio} />
                </div>
              );
            })}
          </section>
        )}

        <section className="inspector-section">
          <h3>Fuentes</h3>
          <Line label="Habilidades" value={`${enabledSkills.length}/${activeSkills.length}`} />
          <Line label="Servidores MCP" value={`${enabledMcps.length}/${mcpNames.length}`} />
          <Line label="Agentes" value={String(workspace.agents.length)} />
          <Line label="Plugins" value={String(workspace.plugins.length)} />
        </section>

        <section className="inspector-section">
          <h3>
            MCP
            <span className="inspector-count">
              {enabledMcps.length}/{mcpNames.length}
            </span>
          </h3>
          {mcpNames.length === 0 && (
            <p className="inspector-empty">
              Ningún MCP en este workspace. Se añaden desde Ajustes o desde el template.
            </p>
          )}
          {mcpNames.map((name) => mcpRow(name))}
        </section>

        <section className="inspector-section">
          <h3>
            Skills
            <span className="inspector-count">
              {enabledSkills.length}/{activeSkills.length}
            </span>
          </h3>
          {activeSkills.length === 0 && (
            <p className="inspector-empty">
              Ninguna skill en este workspace. Se añaden desde Ajustes o desde el template.
            </p>
          )}
          {activeSkills.map((skill) => skillRow(skill))}
        </section>

        {system && (
          <section className="inspector-section">
            <h3>Recursos</h3>
            {resources?.app && (
              <Line
                label="App"
                value={`${bytes(resources.app.memoryBytes)} · ${
                  system.memoryTotalBytes > 0
                    ? percent((resources.app.memoryBytes / system.memoryTotalBytes) * 100)
                    : "—"
                }`}
              />
            )}
            {resources?.workspace && (
              <Line
                label="opencode"
                value={`${bytes(resources.workspace.memoryBytes)} · ${percent(
                  resources.workspace.cpuPercent,
                )} CPU`}
              />
            )}
            <div className="inspector-line">
              <span>CPU</span>
              <span className="inspector-value">{percent(system.cpuPercent)}</span>
            </div>
            <Bar ratio={system.cpuPercent / 100} />
            <Line
              label="Memoria"
              value={`${bytes(system.memoryUsedBytes)} / ${bytes(system.memoryTotalBytes)}`}
            />
            <Bar
              ratio={
                system.memoryTotalBytes > 0
                  ? system.memoryUsedBytes / system.memoryTotalBytes
                  : null
              }
            />
          </section>
        )}
      </div>
    </aside>
  );
}
