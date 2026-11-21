import { useEffect, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { errorText } from "../../domain/shared";
import { slugify } from "../../domain/workspace/wizard";
import type { AssetInfo, Library, Repo, TemplateManifest, Workspace } from "../../types";

type Props = {
  repos: Repo[];
  templates: TemplateManifest[];
  library: Library;
  workspaces: Workspace[];
  worktreesRoot: string;
  defaultTemplateId?: string | null;
  onReposChanged: (repos: Repo[]) => void;
  onTemplatesChanged: (templates: TemplateManifest[]) => void;
  onWorktreesRootChanged: (root: string) => void;
  onClose: () => void;
};

type TemplateField = "agents" | "skills" | "mcps" | "commands" | "plugins";

function emptyTemplate(): TemplateManifest {
  const now = Date.now();
  return {
    id: "",
    name: "",
    description: "",
    version: 1,
    agents: [],
    skills: [],
    mcps: [],
    commands: [],
    plugins: [],
    models: [],
    model: null,
    permissions: [],
    createdAt: now,
    updatedAt: now,
  };
}

function AssetChecks({
  items,
  selected,
  onToggle,
}: {
  items: AssetInfo[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="muted small-text">Nada en la biblioteca global.</p>;
  }
  return (
    <div className="check-list compact">
      {items.map((item) => {
        const checked = selected.includes(item.id);
        return (
          <label key={item.id} className={`check ${checked ? "on" : ""}`}>
            <input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} />
            <span className="check-main">
              <span className="check-title">
                {item.name}
                <span className="tool-chip">{item.source}</span>
              </span>
              <span className="check-sub">{item.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function ManagePanel({
  repos,
  templates,
  library,
  workspaces,
  worktreesRoot,
  defaultTemplateId,
  onReposChanged,
  onTemplatesChanged,
  onWorktreesRootChanged,
  onClose,
}: Props) {
  const composition = useAppContext();
  const [tab, setTab] = useState<"repos" | "templates" | "settings">("repos");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    templates[0]?.id ?? null,
  );
  const [draft, setDraft] = useState<TemplateManifest>(() => templates[0] ?? emptyTemplate());
  const [agentsMd, setAgentsMd] = useState("");
  const [templateSaved, setTemplateSaved] = useState(false);
  const [worktreesDraft, setWorktreesDraft] = useState(worktreesRoot);
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    if (!selectedTemplateId) {
      setAgentsMd("");
      return;
    }
    let alive = true;
    composition.templates
      .agentsMd(selectedTemplateId)
      .then((text) => {
        if (alive) setAgentsMd(text);
      })
      .catch(() => {
        if (alive) setAgentsMd("");
      });
    return () => {
      alive = false;
    };
  }, [selectedTemplateId, composition]);

  function chooseTemplate(template: TemplateManifest) {
    setSelectedTemplateId(template.id);
    setDraft({ ...template });
    setTemplateSaved(false);
    setError(null);
  }

  function newTemplate() {
    setSelectedTemplateId(null);
    setDraft(emptyTemplate());
    setAgentsMd("");
    setTemplateSaved(false);
    setError(null);
  }

  function toggle(field: TemplateField, id: string) {
    setDraft((prev) => {
      const current = new Set(prev[field]);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...prev, [field]: [...current] };
    });
    setTemplateSaved(false);
  }

  async function reloadRepos() {
    onReposChanged(await composition.repos.list());
  }

  async function addRepo() {
    try {
      const picked = await composition.folderPicker.pickDirectory("Elegir repositorio git");
      if (!picked) return;
      setBusy(true);
      setError(null);
      await composition.repos.add(picked);
      await reloadRepos();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshRepo(repo: Repo) {
    try {
      setBusy(true);
      setError(null);
      await composition.repos.refresh(repo.id);
      await reloadRepos();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeRepo(repo: Repo) {
    if (!composition.confirm.confirm(`¿Quitar el repositorio «${repo.name}» de la app?`)) return;
    try {
      setBusy(true);
      setError(null);
      await composition.repos.remove(repo.id);
      await reloadRepos();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    const name = draft.name.trim();
    if (!name) {
      setError("El template necesita un nombre.");
      return;
    }
    const id = draft.id || slugify(name);
    if (!id) {
      setError("El nombre no genera un identificador válido.");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const models = [...new Set(draft.models.map((model) => model.trim()))].filter(Boolean);
      const model = draft.model && models.includes(draft.model) ? draft.model : null;
      const saved = await composition.templates.save({ ...draft, id, name, models, model });
      await composition.templates.saveAgentsMd(saved.id, agentsMd);
      onTemplatesChanged(await composition.templates.list());
      setSelectedTemplateId(saved.id);
      setDraft({ ...saved });
      setTemplateSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate() {
    if (!draft.id) return;
    if (
      !composition.confirm.confirm(
        `¿Borrar el template «${draft.name}»? Los workspaces existentes conservan su selección congelada.`,
      )
    ) {
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await composition.templates.delete(draft.id);
      const next = await composition.templates.list();
      onTemplatesChanged(next);
      setSelectedTemplateId(next[0]?.id ?? null);
      setDraft(next[0] ?? emptyTemplate());
      setTemplateSaved(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    try {
      setBusy(true);
      setError(null);
      const saved = await composition.settings.save({
        version: 2,
        worktreesRoot: worktreesDraft.trim() || null,
        defaultTemplateId: defaultTemplateId ?? null,
      });
      const root = saved.worktreesRoot ?? worktreesRoot;
      setWorktreesDraft(root);
      onWorktreesRootChanged(root);
      setSettingsSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal manage" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Repos y templates</h2>
            <p className="muted small-text">
              Biblioteca global: {library.agents.length} agentes · {library.skills.length} skills ·{" "}
              {library.mcps.length} MCPs · {library.commands.length} comandos ·{" "}
              {library.plugins.length} plugins
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <div className="tabs">
          <button className={tab === "repos" ? "active" : ""} onClick={() => setTab("repos")}>
            Repos
          </button>
          <button
            className={tab === "templates" ? "active" : ""}
            onClick={() => setTab("templates")}
          >
            Templates
          </button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
            Ajustes
          </button>
        </div>

        <div className="modal-body manage-body">
          {tab === "repos" && (
            <section className="manage-pane">
              <div className="section-head">
                <h3>{repos.length} repositorios</h3>
                <button className="ghost small" onClick={() => void addRepo()} disabled={busy}>
                  Añadir repo…
                </button>
              </div>
              {repos.length === 0 && (
                <p className="muted">
                  Añade la carpeta de un repo git. Se usa su checkout principal y su rama principal
                  para proponer worktrees.
                </p>
              )}
              <div className="manage-list">
                {repos.map((repo) => {
                  const count = workspaces.filter(
                    (workspace) => workspace.repoId === repo.id,
                  ).length;
                  return (
                    <div key={repo.id} className="manage-row">
                      <div className="manage-row-main">
                        <strong>
                          {repo.name} <span className="tool-chip">{repo.provider}</span>
                          <span className="tool-chip">{count} ws</span>
                        </strong>
                        <span className="muted small-text">{repo.path}</span>
                        <span className="muted small-text">
                          {repo.remote ?? "sin remoto"} · principal: {repo.mainBranch}
                        </span>
                      </div>
                      <div className="row">
                        <button
                          className="ghost small"
                          onClick={() => void refreshRepo(repo)}
                          disabled={busy}
                        >
                          Refrescar
                        </button>
                        <button
                          className="ghost small danger-text"
                          onClick={() => void removeRepo(repo)}
                          disabled={busy}
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {tab === "templates" && (
            <section className="manage-pane template-pane">
              <aside className="template-list">
                <button className="ghost small" onClick={newTemplate}>
                  + Nuevo template
                </button>
                {templates.map((template) => (
                  <button
                    key={template.id}
                    className={`template-item ${
                      selectedTemplateId === template.id ? "active" : ""
                    }`}
                    onClick={() => chooseTemplate(template)}
                  >
                    <span>{template.name}</span>
                    <span className="muted small-text">
                      {template.id} · v{template.version}
                    </span>
                  </button>
                ))}
                {templates.length === 0 && (
                  <p className="muted small-text">
                    Sin templates. Crea uno para agrupar agentes, skills y MCPs.
                  </p>
                )}
              </aside>

              <div className="template-editor">
                <div className="form-grid two">
                  <label className="field">
                    <span>Nombre</span>
                    <input
                      className="text-input"
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, name: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Id</span>
                    <input
                      className="text-input"
                      value={draft.id}
                      placeholder="se deriva del nombre"
                      disabled={selectedTemplateId !== null}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, id: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Descripción</span>
                    <input
                      className="text-input"
                      value={draft.description}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Versión</span>
                    <input
                      className="text-input"
                      type="number"
                      min={1}
                      value={draft.version}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          version: Number(event.target.value) || 1,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="field">
                  <span>Modelos del selector</span>
                  {draft.models.length === 0 && (
                    <p className="muted small-text">
                      Sin lista, el selector ofrece todos los modelos del servidor.
                    </p>
                  )}
                  {draft.models.map((model, index) => (
                    <div className="row" key={index}>
                      <input
                        className="text-input"
                        value={model}
                        placeholder="provider/modelo"
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraft((prev) => ({
                            ...prev,
                            models: prev.models.map((item, i) => (i === index ? value : item)),
                          }));
                          setTemplateSaved(false);
                        }}
                      />
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          const removed = model.trim();
                          setDraft((prev) => ({
                            ...prev,
                            models: prev.models.filter((_, i) => i !== index),
                            model: prev.model === removed ? null : prev.model,
                          }));
                          setTemplateSaved(false);
                        }}
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setDraft((prev) => ({ ...prev, models: [...prev.models, ""] }));
                      setTemplateSaved(false);
                    }}
                  >
                    Añadir modelo
                  </button>
                </div>

                <label className="field">
                  <span>Modelo por defecto</span>
                  <select
                    className="text-input"
                    value={draft.model ?? ""}
                    onChange={(event) => {
                      setDraft((prev) => ({
                        ...prev,
                        model: event.target.value || null,
                      }));
                      setTemplateSaved(false);
                    }}
                  >
                    <option value="">Sin modelo por defecto</option>
                    {[...new Set(draft.models.map((model) => model.trim()))]
                      .filter(Boolean)
                      .map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="muted small-text">
                  El modelo por defecto se aplica a los agentes que no traen uno asignado.
                </p>

                <div className="template-assets">
                  <section>
                    <div className="section-head">
                      <h3>Agentes</h3>
                      <span className="muted">{draft.agents.length}</span>
                    </div>
                    <AssetChecks
                      items={library.agents}
                      selected={draft.agents}
                      onToggle={(id) => toggle("agents", id)}
                    />
                  </section>
                  <section>
                    <div className="section-head">
                      <h3>Skills</h3>
                      <span className="muted">{draft.skills.length}</span>
                    </div>
                    <div className="check-list compact">
                      {library.skills.map((skill) => {
                        const checked = draft.skills.includes(skill.id);
                        return (
                          <label key={skill.id} className={`check ${checked ? "on" : ""}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle("skills", skill.id)}
                            />
                            <span className="check-main">
                              <span className="check-title">{skill.name}</span>
                              <span className="check-sub">{skill.description}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                  <section>
                    <div className="section-head">
                      <h3>MCPs</h3>
                      <span className="muted">{draft.mcps.length}</span>
                    </div>
                    <div className="check-list compact">
                      {library.mcps.map((mcp) => {
                        const checked = draft.mcps.includes(mcp.name);
                        return (
                          <label key={mcp.name} className={`check ${checked ? "on" : ""}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle("mcps", mcp.name)}
                            />
                            <span className="check-main">
                              <span className="check-title">{mcp.name}</span>
                              <span className="check-sub">
                                {typeof mcp.config.url === "string"
                                  ? mcp.config.url
                                  : Array.isArray(mcp.config.command)
                                    ? mcp.config.command.join(" ")
                                    : ""}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                  <section>
                    <div className="section-head">
                      <h3>Comandos</h3>
                      <span className="muted">{draft.commands.length}</span>
                    </div>
                    <AssetChecks
                      items={library.commands}
                      selected={draft.commands}
                      onToggle={(id) => toggle("commands", id)}
                    />
                  </section>
                  <section>
                    <div className="section-head">
                      <h3>Plugins</h3>
                      <span className="muted">{draft.plugins.length}</span>
                    </div>
                    <AssetChecks
                      items={library.plugins}
                      selected={draft.plugins}
                      onToggle={(id) => toggle("plugins", id)}
                    />
                  </section>
                </div>

                <label className="field">
                  <span>AGENTS.md del template</span>
                  <textarea
                    className="text-area"
                    rows={6}
                    value={agentsMd}
                    placeholder="Instrucciones propias del template…"
                    onChange={(event) => {
                      setAgentsMd(event.target.value);
                      setTemplateSaved(false);
                    }}
                  />
                </label>
                {templateSaved && (
                  <div className="ok-box">
                    Template guardado. Reaplícalo en los workspaces que quieras actualizar.
                  </div>
                )}
                <div className="row">
                  {draft.id && (
                    <button
                      className="ghost danger-text"
                      onClick={() => void deleteTemplate()}
                      disabled={busy}
                    >
                      Borrar template
                    </button>
                  )}
                  <button className="primary" onClick={() => void saveTemplate()} disabled={busy}>
                    {busy ? "Guardando…" : "Guardar template"}
                  </button>
                </div>
              </div>
            </section>
          )}

          {tab === "settings" && (
            <section className="manage-pane">
              <div className="section-head">
                <h3>Worktrees</h3>
              </div>
              <p className="muted small-text">
                Raíz donde se crean las carpetas de worktree. Por defecto,{" "}
                <code>{worktreesRoot}</code>.
              </p>
              <label className="field">
                <span>Raíz de worktrees</span>
                <div className="row">
                  <input
                    className="text-input"
                    value={worktreesDraft}
                    placeholder={worktreesRoot}
                    onChange={(event) => {
                      setWorktreesDraft(event.target.value);
                      setSettingsSaved(false);
                    }}
                  />
                </div>
                <span className="field-hint">
                  Ruta absoluta. Vacío = valor por defecto en app data.
                </span>
              </label>
              {settingsSaved && <div className="ok-box">Ajustes guardados.</div>}
              <div className="row">
                <button className="primary" onClick={() => void saveSettings()} disabled={busy}>
                  {busy ? "Guardando…" : "Guardar ajustes"}
                </button>
              </div>
            </section>
          )}

          {error && <div className="inline-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
