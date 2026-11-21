import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { McpInfo, SkillInfo, SkillRef, Workspace } from "../types";
import type { WorkspaceClient } from "../opencode";

type Props = {
  workspace: Workspace;
  client?: WorkspaceClient | null;
  onUpdated: (workspace: Workspace, warnings: string[]) => void;
  onClose: () => void;
};

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

function mcpSummary(config: Record<string, unknown>) {
  if (typeof config.url === "string") return config.url;
  if (Array.isArray(config.command)) return config.command.join(" ");
  return "";
}

function errorText(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function SettingsPanel({
  workspace,
  client,
  onUpdated,
  onClose,
}: Props) {
  const [mcps, setMcps] = useState<McpInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [reapplying, setReapplying] = useState(false);
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(
    () => new Set(workspace.mcpNames),
  );
  const [selectedSkills, setSelectedSkills] = useState<Map<string, SkillRef>>(
    () => new Map(workspace.skills.map((skill) => [skill.id, skill])),
  );
  const [model, setModel] = useState(workspace.model ?? "");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    api
      .listMcps()
      .then((items) => {
        if (alive) setMcps(items);
      })
      .catch(() => undefined);
    api
      .listSkills(workspace.projectPath)
      .then((items) => {
        if (alive) setSkills(items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [workspace.projectPath]);

  useEffect(() => {
    setSelectedMcps(new Set(workspace.mcpNames));
    setSelectedSkills(new Map(workspace.skills.map((skill) => [skill.id, skill])));
    setModel(workspace.model ?? "");
    setError(null);
    setWarnings([]);
    setApplied(false);
  }, [workspace.id]);

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
      for (const item of result.data) {
        const status = item.status as unknown as { status?: string } | string;
        next[item.name] =
          typeof status === "string" ? status : (status.status ?? "unknown");
      }
      setStatuses(next);
    } catch {
      // El servidor puede estar arrancando; se reintenta al aplicar.
    }
  }

  useEffect(() => {
    void refreshStatuses();
  }, [workspace.id, workspace.projectPath, client]);

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
      const outcome = await api.updateWorkspace({
        id: workspace.id,
        mcpNames: nextMcps,
        skills: nextSkills,
        model: model.trim() || null,
      });
      setWarnings(outcome.warnings);
      onUpdated(outcome.workspace, outcome.warnings);

      if (client) {
        const location = { directory: workspace.projectPath };
        const before = new Set(workspace.mcpNames);
        const after = new Set(nextMcps);

        for (const name of before) {
          if (!after.has(name)) {
            await client.mcp
              .remove({ server: name, location })
              .catch(() => undefined);
          }
        }
        for (const name of after) {
          if (before.has(name)) continue;
          const info = mcps.find((item) => item.name === name);
          if (!info) continue;
          await client.mcp
            .add({
              server: name,
              config: { ...(info.config as any), disabled: false },
              location,
            })
            .catch((err) => setError(errorText(err)));
        }

        const skillsChanged = !sameSet(
          workspace.skills.map((skill) => skill.id),
          nextSkills.map((skill) => skill.id),
        );
        const modelChanged = (workspace.model ?? "") !== model.trim();
        if (skillsChanged || modelChanged) {
          await client.location.reload();
        }
      }
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
      const outcome = await api.reapplyTemplate(workspace.id);
      setSelectedMcps(new Set(outcome.workspace.mcpNames));
      setSelectedSkills(
        new Map(outcome.workspace.skills.map((skill) => [skill.id, skill])),
      );
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
      <div
        className="modal settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2>Ajustes del workspace</h2>
            <p className="muted small-text">{workspace.projectPath}</p>
          </div>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </header>

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
                La selección está congelada por workspace. Reaplicar toma la
                versión actual del template; editar el template no cambia este
                workspace por sí solo.
              </p>
              <button
                className="ghost"
                onClick={() => void reapply()}
                disabled={reapplying}
              >
                {reapplying ? "Reaplicando…" : "Reaplicar template"}
              </button>
            </section>
          )}

          <section>
            <div className="section-head">
              <h3>MCPs</h3>
              <span className="muted">{selectedMcps.size} activos</span>
            </div>
            {mcps.length === 0 && (
              <p className="muted">
                No hay MCPs en la configuración global de opencode.
              </p>
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
                            {statuses[mcp.name]}
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
            {skillList.length === 0 && (
              <p className="muted">No se encontraron skills.</p>
            )}
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

          {warnings.length > 0 && (
            <div className="warning-box">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          {error && <div className="inline-error">{error}</div>}
          {applied && !error && (
            <div className="ok-box">Cambios aplicados a este workspace.</div>
          )}
        </div>

        <footer className="modal-foot">
          <span className="muted">
            {applied ? "Aplicado" : "Los cambios afectan solo a este workspace"}
          </span>
          <div className="row">
            <button className="ghost" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary" onClick={() => void apply()} disabled={applying}>
              {applying ? "Aplicando…" : "Aplicar"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
