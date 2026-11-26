import { useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { useBudgetAlerts } from "../hooks/useBudgetAlerts";
import { useInspectorData } from "../hooks/useInspectorData";
import { errorText, formatBytes, formatPercent } from "../../domain/shared";
import { mcpAction, mcpStateLabel, readableMcpError } from "../../domain/chat/mcp";
import {
  activityBars,
  budgetLevel,
  budgetRatio,
  cacheRatio as computeCacheRatio,
  contextRatio as computeContextRatio,
  formatActivityDay,
  formatCost,
  formatCount,
  formatTokens,
  sortModelUsage,
  totalTokens,
  usageModelKey,
  type UsageRange,
} from "../../domain/chat/usage";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import type { ServerInfo, SkillRef, Workspace } from "../../types";
import { ChangesPanel } from "./ChangesPanel";
import { FilesPanel } from "./FilesPanel";

export type InspectorTab = "resumen" | "cambios" | "ficheros";

type Props = {
  workspace: Workspace;
  client: ChatServer;
  server: ServerInfo;
  sessionId: string | null;
  onUpdated: (workspace: Workspace, warnings: string[]) => void;
  onClose: () => void;
  tab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
};

function resetText(at: number) {
  const delta = at - Date.now();
  if (!Number.isFinite(at) || delta <= 0) return "ahora";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `en ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `en ${hours} h ${minutes % 60} min`;
  return `en ${Math.round(hours / 24)} d`;
}

/* El estado de cada MCP se normaliza en domain/chat/mcp. */
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

export function Inspector({
  workspace,
  client,
  server,
  sessionId,
  onUpdated,
  onClose,
  tab = "resumen",
  onTabChange,
}: Props) {
  const root = useAppContext();
  const [savingMcp, setSavingMcp] = useState<string | null>(null);
  const [savingSkill, setSavingSkill] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usageRange, setUsageRange] = useState<UsageRange>("30d");

  const {
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
  } = useInspectorData({
    client,
    root,
    workspace,
    server,
    sessionId,
    usageRange,
    active: tab === "resumen",
  });

  useBudgetAlerts({
    root,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    cost: stats?.cost ?? null,
    budget: monthlyBudget,
    timeZone,
  });

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

  const usageActivity = useMemo(() => activityBars(stats?.activity ?? []), [stats]);
  const usageModels = useMemo(() => sortModelUsage(stats?.models ?? []), [stats]);
  const budgetState = budgetLevel(stats?.cost ?? 0, monthlyBudget);
  const budgetShare = budgetRatio(stats?.cost ?? 0, monthlyBudget);
  const modelNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const model of models) {
      const id = model.modelID ?? model.id;
      names.set(`${model.providerID}/${id}`, model.name);
    }
    return names;
  }, [models]);

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

  /** Conecta o desconecta en caliente; no reescribe config ni recarga la location. */
  async function toggleMcpRuntime(name: string, action: "connect" | "disconnect") {
    setSavingMcp(name);
    setError(null);
    try {
      if (action === "connect") await client.mcp.connect({ server: name, location });
      else await client.mcp.disconnect({ server: name, location });
    } catch (err) {
      setError(errorText(err));
    } finally {
      await refreshMcp();
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
    const state = status?.state ?? "unknown";
    const action = mcpAction(state);
    const mcpError = readableMcpError(status?.error);
    return (
      <div className="inspector-mcp-row" key={name}>
        <div className="inspector-switch-row">
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
          <span className="inspector-switch-label" title={status?.title ?? name}>
            {name}
          </span>
          <span className={`mcp-status ${state}`} title={mcpStateLabel(state)}>
            {mcpStateLabel(state)}
          </span>
          {enabled && (
            <button
              type="button"
              className="ghost mcp-action"
              disabled={savingMcp !== null}
              title={
                action === "connect"
                  ? `Conectar ${name} sin reaplicar el perfil`
                  : `Desconectar ${name} sin borrar su configuración`
              }
              onClick={() => void toggleMcpRuntime(name, action)}
            >
              {action === "connect"
                ? state === "failed"
                  ? "Reintentar"
                  : "Conectar"
                : "Desconectar"}
            </button>
          )}
        </div>
        {mcpError && (
          <p className="mcp-error" title={status?.error}>
            {mcpError}
          </p>
        )}
      </div>
    );
  }

  function usageModelName(model: { providerID: string; id: string }) {
    return modelNames.get(usageModelKey(model)) ?? usageModelKey(model);
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
    <aside className={`inspector ${tab === "resumen" ? "" : "inspector-wide"}`}>
      <header className="inspector-head">
        <strong>Panel</strong>
        <button className="icon-button" title="Ocultar panel" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="inspector-tabs" role="tablist" aria-label="Secciones del panel">
        {(
          [
            ["resumen", "Resumen"],
            ["cambios", "Cambios"],
            ["ficheros", "Ficheros"],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => onTabChange?.(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "cambios" ? (
        <ChangesPanel
          client={client}
          workspace={workspace}
          sessionId={sessionId}
          git={root.git}
          pullRequests={root.pullRequests}
          confirm={root.confirm}
        />
      ) : tab === "ficheros" ? (
        <FilesPanel client={client} workspace={workspace} />
      ) : (
        <div className="inspector-body">
          {error && <div className="inline-error small-text">{error}</div>}

          <section className="inspector-section">
            <h3>Sesión</h3>
            {session ? (
              <>
                <div className="inspector-line">
                  <span>Contexto</span>
                  <span className="inspector-value">
                    {contextRatio === null ? "—" : formatPercent(contextRatio * 100)}
                  </span>
                </div>
                <Bar ratio={contextRatio} />
                <Line
                  label="Acierto de caché"
                  value={cacheRatio === null ? "—" : formatPercent(cacheRatio * 100)}
                />
                <Line
                  label="Tokens"
                  value={`${formatTokens(session.input)} in · ${formatTokens(session.output)} out`}
                />
                <Line label="Coste" value={formatCost(session.cost)} />
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

          <section className="inspector-section">
            <h3>
              Consumo del workspace
              <span className="inspector-count">
                {usageRange === "7d" ? "7 días" : usageRange === "30d" ? "30 días" : "total"}
              </span>
            </h3>
            <fieldset className="usage-range">
              <legend className="sr-only">Rango de consumo</legend>
              {(
                [
                  ["7d", "7 días"],
                  ["30d", "30 días"],
                  ["total", "Total"],
                ] as const
              ).map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={usageRange === id}
                  className={usageRange === id ? "active" : ""}
                  onClick={() => setUsageRange(id)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            {stats ? (
              <>
                <div className="usage-total">
                  <span className="usage-total-value">{formatCost(stats.cost)}</span>
                  <span className="inspector-muted">coste del rango</span>
                </div>
                <Line
                  label="Tokens"
                  value={`${formatTokens(stats.tokens.input)} in · ${formatTokens(stats.tokens.output)} out`}
                />
                <Line
                  label="Caché"
                  value={`${formatTokens(stats.tokens.cache.read)} lectura · ${formatTokens(
                    stats.tokens.cache.write,
                  )} escritura`}
                />
                {stats.tokens.reasoning > 0 && (
                  <Line label="Razonamiento" value={formatTokens(stats.tokens.reasoning)} />
                )}
                <Line
                  label="Actividad"
                  value={`${formatCount(stats.sessions)} sesiones · ${formatCount(
                    stats.prompts,
                  )} prompts`}
                />
                {(stats.steps > 0 || stats.subagents > 0) && (
                  <Line
                    label="Trabajo"
                    value={`${formatCount(stats.steps)} pasos${
                      stats.subagents > 0 ? ` · ${formatCount(stats.subagents)} subagentes` : ""
                    }`}
                  />
                )}
                <Line
                  label="Días activos"
                  value={`${formatCount(stats.activeDays)} · racha ${formatCount(stats.streak)}`}
                />

                {usageActivity.length > 0 && (
                  <div className="usage-activity">
                    <div className="inspector-subhead">
                      <span>Actividad por día</span>
                      <span className="inspector-muted">pasos</span>
                    </div>
                    {usageActivity.map((day) => (
                      <div
                        className="usage-activity-row"
                        key={day.date}
                        title={`${day.date}: ${formatCount(day.steps)} pasos`}
                      >
                        <span className="usage-activity-day">{formatActivityDay(day.date)}</span>
                        <div className="inspector-bar">
                          <span style={{ width: `${Math.round(day.ratio * 100)}%` }} />
                        </div>
                        <span className="usage-activity-count">{formatCount(day.steps)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {usageModels.length > 0 && (
                  <div className="usage-models">
                    <div className="inspector-subhead">
                      <span>Por modelo</span>
                      <span className="inspector-muted">coste</span>
                    </div>
                    {usageModels.map((entry) => {
                      const peak = usageModels[0]?.cost ?? 0;
                      return (
                        <div className="usage-model" key={usageModelKey(entry.model)}>
                          <div className="inspector-line">
                            <span title={usageModelKey(entry.model)}>
                              {usageModelName(entry.model)}
                            </span>
                            <span className="inspector-value">{formatCost(entry.cost)}</span>
                          </div>
                          <div className="inspector-bar">
                            <span
                              style={{
                                width: `${peak > 0 ? Math.min(100, (entry.cost / peak) * 100) : 0}%`,
                              }}
                            />
                          </div>
                          <span className="inspector-muted">
                            {formatCount(entry.steps)} pasos ·{" "}
                            {formatTokens(totalTokens(entry.tokens))} tokens
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {monthlyBudget !== null && (
                  <div className={`usage-budget ${budgetState ?? "ok"}`}>
                    <Line
                      label="Presupuesto mensual"
                      value={`${formatCost(stats.cost)} de ${formatCost(monthlyBudget)}`}
                    />
                    <Bar ratio={budgetShare} />
                    {budgetState === "over" && (
                      <p className="usage-budget-alert">Has superado el presupuesto mensual.</p>
                    )}
                    {budgetState === "warning" && (
                      <p className="usage-budget-warning">Te acercas al presupuesto mensual.</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="inspector-empty">{statsError ?? "Sin datos de consumo todavía."}</p>
            )}
          </section>

          {hasUsage && (
            <section className="inspector-section">
              <h3>Límites del proveedor</h3>
              {usage?.go?.rolling && (
                <>
                  <div className="inspector-line">
                    <span>5 h</span>
                    <span className="inspector-value">
                      {formatPercent(usage.go.rolling.percent)}{" "}
                      <span className="inspector-muted">
                        {resetText(usage.go.rolling.resetsAt)}
                      </span>
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
                      {formatPercent(usage.go.weekly.percent)}{" "}
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
                      {formatPercent(usage.go.monthly.percent)}{" "}
                      <span className="inspector-muted">
                        {resetText(usage.go.monthly.resetsAt)}
                      </span>
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
                      value={formatCost(Math.max(0, budget.limit - budget.spent))}
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
                Ningún MCP en este workspace. Se añaden desde Ajustes o desde el perfil.
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
                Ninguna skill en este workspace. Se añaden desde Ajustes o desde el perfil.
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
                  value={`${formatBytes(resources.app.memoryBytes)} · ${
                    system.memoryTotalBytes > 0
                      ? formatPercent((resources.app.memoryBytes / system.memoryTotalBytes) * 100)
                      : "—"
                  }`}
                />
              )}
              {resources?.workspace && (
                <Line
                  label="opencode"
                  value={`${formatBytes(resources.workspace.memoryBytes)} · ${formatPercent(
                    resources.workspace.cpuPercent,
                  )} CPU`}
                />
              )}
              <div className="inspector-line">
                <span>CPU</span>
                <span className="inspector-value">{formatPercent(system.cpuPercent)}</span>
              </div>
              <Bar ratio={system.cpuPercent / 100} />
              <Line
                label="Memoria"
                value={`${formatBytes(system.memoryUsedBytes)} / ${formatBytes(system.memoryTotalBytes)}`}
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
      )}
    </aside>
  );
}
