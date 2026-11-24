import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { AppearanceSettings } from "./AppearanceSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { errorText } from "../../domain/shared";
import { prefKeys } from "../../domain/repositories/Preferences";
import { NOTIFICATIONS_ON, notificationsEnabled } from "../../domain/chat/notifications";
import { parseBudgetUsd } from "../../domain/chat/usage";
import { mcpStateLabel, type McpState } from "../../domain/chat/mcp";
import type { McpInfo, SkillInfo, SkillRef, Workspace } from "../../types";
import type { ChatGateway as WorkspaceClient } from "../../domain/repositories/ChatGateway";

type Props = {
  workspace: Workspace;
  client?: WorkspaceClient | null;
  onUpdated: (workspace: Workspace, warnings: string[]) => void;
  onClose: () => void;
};

function mcpSummary(config: Record<string, unknown>) {
  if (typeof config.url === "string") return config.url;
  if (Array.isArray(config.command)) return config.command.join(" ");
  return "";
}

export function SettingsPanel({ workspace, client, onUpdated, onClose }: Props) {
  const root = useAppContext();
  const [mcps, setMcps] = useState<McpInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [reapplying, setReapplying] = useState(false);
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(() => new Set(workspace.mcpNames));
  const [selectedSkills, setSelectedSkills] = useState<Map<string, SkillRef>>(
    () => new Map(workspace.skills.map((skill) => [skill.id, skill])),
  );
  const [model, setModel] = useState(workspace.model ?? "");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [notifications, setNotifications] = useState(() =>
    notificationsEnabled(root.preferences.get(prefKeys.notifications)),
  );
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [budgetText, setBudgetText] = useState(
    () => root.preferences.get(prefKeys.budget(workspace.id)) ?? "",
  );
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [tab, setTab] = useState<"workspace" | "appearance" | "shortcuts">("workspace");

  useEffect(() => {
    let alive = true;
    root.library
      .mcps()
      .then((items) => {
        if (alive) setMcps(items);
      })
      .catch(() => undefined);
    root.library
      .skills(workspace.projectPath)
      .then((items) => {
        if (alive) setSkills(items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [root, workspace.projectPath]);

  useEffect(() => {
    setSelectedMcps(new Set(workspace.mcpNames));
    setSelectedSkills(new Map(workspace.skills.map((skill) => [skill.id, skill])));
    setModel(workspace.model ?? "");
    setBudgetText(root.preferences.get(prefKeys.budget(workspace.id)) ?? "");
    setBudgetError(null);
    setError(null);
    setWarnings([]);
    setApplied(false);
  }, [root.preferences, workspace.id]);

  const skillList = useMemo(() => {
    const map = new Map<string, SkillInfo>();
    for (const skill of skills) map.set(skill.id, skill);
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [skills]);

  async function refreshStatuses() {
    if (!client) return;
    try {
      const result = await client.mcp.list({
        location: { directory: workspace.projectPath },
      });
      const next: Record<string, string> = {};
      for (const item of result.data) next[item.name] = item.state;
      setStatuses(next);
    } catch {
      // El servidor puede estar arrancando; se reintenta al aplicar.
    }
  }

  useEffect(() => {
    void refreshStatuses();
  }, [workspace.id, workspace.projectPath, client]);

  async function toggleNotifications() {
    setNotificationError(null);
    if (notifications) {
      root.preferences.set(prefKeys.notifications, "0");
      setNotifications(false);
      return;
    }
    const permission = await root.notifications.requestPermission();
    if (permission === "denied") {
      setNotificationError(
        "El sistema denegó el permiso de notificaciones. Actívalo en los ajustes del sistema y vuelve a intentarlo.",
      );
      return;
    }
    root.preferences.set(prefKeys.notifications, NOTIFICATIONS_ON);
    setNotifications(true);
  }

  function changeBudget(value: string) {
    setBudgetText(value);
    const raw = value.trim();
    if (!raw) {
      root.preferences.remove(prefKeys.budget(workspace.id));
      setBudgetError(null);
      return;
    }
    const budget = parseBudgetUsd(raw);
    if (budget === null) {
      setBudgetError("Introduce un importe mayor que 0 o deja el campo vacío.");
      return;
    }
    root.preferences.set(prefKeys.budget(workspace.id), String(budget));
    setBudgetError(null);
  }

  function toggleMcp(name: string) {
    setSelectedMcps((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setApplied(false);
  }

  function toggleSkill(skill: SkillInfo) {
    setSelectedSkills((prev) => {
      const next = new Map(prev);
      if (next.has(skill.id)) next.delete(skill.id);
      else next.set(skill.id, { id: skill.id, path: skill.path });
      return next;
    });
    setApplied(false);
  }

  async function apply() {
    setApplying(true);
    setError(null);
    setWarnings([]);
    try {
      const nextMcps = [...selectedMcps];
      const nextSkills = [...selectedSkills.values()];
      const { outcome, mcpErrors } = await root
        .provideApplyWorkspaceSettings(client ?? null)
        .execute({ workspace, mcpNames: nextMcps, skills: nextSkills, model, mcps });
      setWarnings(outcome.warnings);
      onUpdated(outcome.workspace, outcome.warnings);
      if (mcpErrors.length > 0) setError(mcpErrors[mcpErrors.length - 1]);
      await refreshStatuses();
      setApplied(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setApplying(false);
    }
  }

  async function reapply() {
    setReapplying(true);
    setError(null);
    setWarnings([]);
    try {
      const outcome = await root.workspaces.reapplyTemplate(workspace.id);
      setSelectedMcps(new Set(outcome.workspace.mcpNames));
      setSelectedSkills(new Map(outcome.workspace.skills.map((skill) => [skill.id, skill])));
      setModel(outcome.workspace.model ?? "");
      setWarnings(outcome.warnings);
      onUpdated(outcome.workspace, outcome.warnings);
      setApplied(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setReapplying(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Ajustes del workspace</h2>
            <p className="muted small-text">{workspace.projectPath}</p>
          </div>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <div className="settings-tabs" role="tablist" aria-label="Secciones de ajustes">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "workspace"}
            className={tab === "workspace" ? "active" : ""}
            onClick={() => setTab("workspace")}
          >
            Workspace
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "appearance"}
            className={tab === "appearance" ? "active" : ""}
            onClick={() => setTab("appearance")}
          >
            Apariencia
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "shortcuts"}
            className={tab === "shortcuts" ? "active" : ""}
            onClick={() => setTab("shortcuts")}
          >
            Atajos
          </button>
        </div>

        {tab === "appearance" && (
          <div className="settings-body">
            <AppearanceSettings />
          </div>
        )}
        {tab === "shortcuts" && (
          <div className="settings-body">
            <ShortcutsSettings />
          </div>
        )}

        {tab === "workspace" && (
          <div className="settings-body">
            {workspace.templateId && (
              <section>
                <div className="section-head">
                  <h3>Template</h3>
                  <span className="muted">
                    {workspace.templateId} · v{workspace.templateVersion ?? "?"}
                  </span>
                </div>
                <p className="muted small-text">
                  La selección está congelada por workspace. Reaplicar toma la versión actual del
                  template; editar el template no cambia este workspace por sí solo.
                </p>
                <button className="ghost" onClick={() => void reapply()} disabled={reapplying}>
                  {reapplying ? "Reaplicando…" : "Reaplicar template"}
                </button>
              </section>
            )}

            <section>
              <div className="section-head">
                <h3>Notificaciones</h3>
                <span className="muted">{notifications ? "activadas" : "desactivadas"}</span>
              </div>
              <label className={`check ${notifications ? "on" : ""}`}>
                <input
                  type="checkbox"
                  checked={notifications}
                  onChange={() => void toggleNotifications()}
                />
                <span className="check-main">
                  <span className="check-title">
                    Avisarme cuando el agente termine o espere algo
                  </span>
                  <span className="check-sub">
                    Preferencia global. Solo avisa si la ventana no tiene el foco; pide permiso al
                    sistema la primera vez.
                  </span>
                </span>
              </label>
              {notificationError && <div className="inline-error">{notificationError}</div>}
            </section>

            <section>
              <div className="section-head">
                <h3>MCPs</h3>
                <span className="muted">{selectedMcps.size} activos</span>
              </div>
              {mcps.length === 0 && (
                <p className="muted">No hay MCPs en la configuración global de opencode.</p>
              )}
              <div className="check-list">
                {mcps.map((mcp) => {
                  const checked = selectedMcps.has(mcp.name);
                  return (
                    <label key={mcp.name} className={`check ${checked ? "on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMcp(mcp.name)}
                      />
                      <span className="check-main">
                        <span className="check-title">
                          {mcp.name}
                          {statuses[mcp.name] && (
                            <span className={`mcp-status ${statuses[mcp.name]}`}>
                              {mcpStateLabel(statuses[mcp.name] as McpState)}
                            </span>
                          )}
                        </span>
                        <span className="check-sub">{mcpSummary(mcp.config)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="section-head">
                <h3>Skills</h3>
                <span className="muted">{selectedSkills.size} activas</span>
              </div>
              {skillList.length === 0 && <p className="muted">No se encontraron skills.</p>}
              <div className="check-list">
                {skillList.map((skill) => {
                  const checked = selectedSkills.has(skill.id);
                  return (
                    <label key={skill.id} className={`check ${checked ? "on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSkill(skill)}
                      />
                      <span className="check-main">
                        <span className="check-title">
                          {skill.name}
                          <span className="tool-chip">{skill.source}</span>
                        </span>
                        <span className="check-sub">{skill.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="section-head">
                <h3>Modelo</h3>
                <span className="muted">opcional</span>
              </div>
              <input
                className="text-input"
                value={model}
                placeholder="provider/modelo (vacío = el de la config global)"
                onChange={(event) => {
                  setModel(event.target.value);
                  setApplied(false);
                }}
              />
            </section>

            <section>
              <div className="section-head">
                <h3>Presupuesto</h3>
                <span className="muted">mensual · opcional</span>
              </div>
              <p className="muted small-text">
                El Inspector avisa cuando el coste del rango supera este importe. Se guarda al
                editarlo como preferencia de este workspace: vacío significa sin límite y no toca la
                configuración del servidor.
              </p>
              <input
                className="text-input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                aria-label="Presupuesto mensual en dólares"
                placeholder="p. ej. 20"
                value={budgetText}
                onChange={(event) => changeBudget(event.target.value)}
              />
              {budgetError && <div className="inline-error">{budgetError}</div>}
            </section>

            {warnings.length > 0 && (
              <div className="warning-box">
                {warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
            {error && <div className="inline-error">{error}</div>}
            {applied && !error && <div className="ok-box">Cambios aplicados a este workspace.</div>}
          </div>
        )}

        <footer className="modal-foot">
          <span className="muted">
            {tab === "workspace"
              ? applied
                ? "Aplicado"
                : "Los cambios afectan solo a este workspace"
              : tab === "appearance"
                ? "El tema se aplica al momento"
                : "Set fijo de atajos"}
          </span>
          <div className="row">
            <button className="ghost" onClick={onClose}>
              {tab === "workspace" ? "Cancelar" : "Cerrar"}
            </button>
            {tab === "workspace" && (
              <button className="primary" onClick={() => void apply()} disabled={applying}>
                {applying ? "Aplicando…" : "Aplicar"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
