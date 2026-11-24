import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { errorText } from "../../domain/shared";
import { slugify } from "../../domain/workspace/wizard";
import type { AssetInfo, Library, Repo, ProfileManifest, Workspace } from "../../types";
import type { ModelDetails } from "../../domain/models/details";
import { ModelInfoCard } from "./ModelInfoCard";
import { AsyncMultiSearchableSelect, Select } from "./ui";
import type { SelectEntry, SelectOption } from "./ui";

type Props = {
  repos: Repo[];
  profiles: ProfileManifest[];
  library: Library;
  workspaces: Workspace[];
  worktreesRoot: string;
  defaultProfileId?: string | null;
  onReposChanged: (repos: Repo[]) => void;
  onProfilesChanged: (profiles: ProfileManifest[]) => void;
  onWorktreesRootChanged: (root: string) => void;
  onClose: () => void;
};

type ProfileField = "agents" | "skills" | "mcps" | "commands" | "plugins";

function splitModel(model: string): { provider: string; id: string } {
  const slash = model.indexOf("/");
  return slash > 0
    ? { provider: model.slice(0, slash), id: model.slice(slash + 1) }
    : { provider: "otros", id: model };
}

function modelLabel(model: string): string {
  const { provider, id } = splitModel(model);
  return model.includes("/") ? `${id} (${provider})` : model;
}

function emptyProfile(): ProfileManifest {
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
  profiles,
  library,
  workspaces,
  worktreesRoot,
  defaultProfileId,
  onReposChanged,
  onProfilesChanged,
  onWorktreesRootChanged,
  onClose,
}: Props) {
  const composition = useAppContext();
  const [tab, setTab] = useState<"repos" | "profiles" | "settings">("repos");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    profiles[0]?.id ?? null,
  );
  const [draft, setDraft] = useState<ProfileManifest>(() => profiles[0] ?? emptyProfile());
  const [agentsMd, setAgentsMd] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [worktreesDraft, setWorktreesDraft] = useState(worktreesRoot);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [catalogModels, setCatalogModels] = useState<ModelDetails[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const [subscriptionFilter, setSubscriptionFilter] = useState("");

  useEffect(() => {
    let alive = true;
    composition.modelCatalog
      .list()
      .then((models) => {
        if (alive) {
          setCatalogModels(models);
          setCatalogStatus("ready");
        }
        return undefined;
      })
      .catch(() => {
        if (alive) setCatalogStatus("error");
        return undefined;
      });
    return () => {
      alive = false;
    };
  }, [composition]);

  const catalogIndex = useMemo(
    () => new Map(catalogModels.map((model) => [model.key, model])),
    [catalogModels],
  );

  const subscriptionOptions = useMemo<SelectEntry[]>(() => {
    const providers = new Set<string>();
    for (const key of [...catalogModels.map((model) => model.key), ...draft.models]) {
      const trimmed = key.trim();
      if (trimmed) providers.add(splitModel(trimmed).provider);
    }
    return [
      { value: "", label: "Todas" },
      ...[...providers]
        .sort((left, right) => left.localeCompare(right))
        .map((provider) => ({ value: provider, label: provider })),
    ];
  }, [catalogModels, draft.models]);

  const modelOptions = useMemo<SelectEntry[]>(() => {
    const selected = draft.models.map((model) => model.trim()).filter(Boolean);
    const available = catalogModels.filter(
      (model) => !subscriptionFilter || model.providerID === subscriptionFilter,
    );
    const keys = new Set([...available.map((model) => model.key), ...selected]);
    const groups = new Map<string, SelectOption[]>();
    for (const key of keys) {
      const { provider } = splitModel(key);
      const details = catalogIndex.get(key);
      const group = groups.get(provider) ?? [];
      group.push({
        value: key,
        label: modelLabel(key),
        searchText: key,
        tooltip: details ? <ModelInfoCard details={details} /> : undefined,
      });
      groups.set(provider, group);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, options]) => ({
        label,
        options: options.sort((left, right) => left.label.localeCompare(right.label)),
      }));
  }, [catalogIndex, catalogModels, draft.models, subscriptionFilter]);

  useEffect(() => {
    if (!selectedProfileId) {
      setAgentsMd("");
      return;
    }
    let alive = true;
    composition.profiles
      .agentsMd(selectedProfileId)
      .then((text) => {
        if (alive) setAgentsMd(text);
      })
      .catch(() => {
        if (alive) setAgentsMd("");
      });
    return () => {
      alive = false;
    };
  }, [selectedProfileId, composition]);

  function chooseProfile(profile: ProfileManifest) {
    setSelectedProfileId(profile.id);
    setDraft({ ...profile });
    setProfileSaved(false);
    setError(null);
  }

  function newProfile() {
    setSelectedProfileId(null);
    setDraft(emptyProfile());
    setAgentsMd("");
    setProfileSaved(false);
    setError(null);
  }

  function toggle(field: ProfileField, id: string) {
    setDraft((prev) => {
      const current = new Set(prev[field]);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...prev, [field]: [...current] };
    });
    setProfileSaved(false);
  }

  function removeModel(model: string) {
    setDraft((prev) => ({
      ...prev,
      models: prev.models.filter((item) => item !== model),
      model: prev.model === model ? null : prev.model,
    }));
    setProfileSaved(false);
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

  async function saveProfile() {
    const name = draft.name.trim();
    if (!name) {
      setError("El perfil necesita un nombre.");
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
      const saved = await composition.profiles.save({ ...draft, id, name, models, model });
      await composition.profiles.saveAgentsMd(saved.id, agentsMd);
      onProfilesChanged(await composition.profiles.list());
      setSelectedProfileId(saved.id);
      setDraft({ ...saved });
      setProfileSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile() {
    if (!draft.id) return;
    if (
      !composition.confirm.confirm(
        `¿Borrar el perfil «${draft.name}»? Los workspaces existentes conservan su selección congelada.`,
      )
    ) {
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await composition.profiles.delete(draft.id);
      const next = await composition.profiles.list();
      onProfilesChanged(next);
      setSelectedProfileId(next[0]?.id ?? null);
      setDraft(next[0] ?? emptyProfile());
      setProfileSaved(false);
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
        defaultProfileId: defaultProfileId ?? null,
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
            <h2>Repos y perfiles</h2>
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
          <button className={tab === "profiles" ? "active" : ""} onClick={() => setTab("profiles")}>
            Perfiles
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

          {tab === "profiles" && (
            <section className="manage-pane profile-pane">
              <aside className="profile-list">
                <button className="ghost small" onClick={newProfile}>
                  + Nuevo perfil
                </button>
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    className={`profile-item ${selectedProfileId === profile.id ? "active" : ""}`}
                    onClick={() => chooseProfile(profile)}
                  >
                    <span>{profile.name}</span>
                    <span className="muted small-text">
                      {profile.id} · v{profile.version}
                    </span>
                  </button>
                ))}
                {profiles.length === 0 && (
                  <p className="muted small-text">
                    Sin perfils. Crea uno para agrupar agentes, skills y MCPs.
                  </p>
                )}
              </aside>

              <div className="profile-editor">
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
                      disabled={selectedProfileId !== null}
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
                  <div className="model-picker">
                    <Select
                      aria-label="Suscripción"
                      value={subscriptionFilter}
                      placeholder="Todas"
                      options={subscriptionOptions}
                      variant="field"
                      className="model-picker-subscription"
                      onValueChange={setSubscriptionFilter}
                    />
                    <AsyncMultiSearchableSelect
                      aria-label="Modelos del perfil"
                      value={draft.models}
                      options={modelOptions}
                      placeholder={
                        catalogStatus === "loading" ? "Cargando modelos…" : "Buscar modelo…"
                      }
                      disabled={catalogStatus === "loading"}
                      variant="field"
                      className="model-picker-models"
                      emptyText={
                        catalogStatus === "error"
                          ? "No se pudo cargar el catálogo de modelos"
                          : "No hay modelos que coincidan"
                      }
                      onValueChange={(models) => {
                        setDraft((prev) => ({
                          ...prev,
                          models,
                          model: prev.model && models.includes(prev.model) ? prev.model : null,
                        }));
                        setProfileSaved(false);
                      }}
                    />
                  </div>
                  {draft.models.length > 0 ? (
                    <div className="model-chips">
                      {draft.models.map((model) => (
                        <span key={model} className="model-chip">
                          {modelLabel(model)}
                          <button
                            type="button"
                            aria-label={`Quitar ${model}`}
                            onClick={() => removeModel(model)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted small-text">
                      Sin selección, el selector ofrece todos los modelos disponibles.
                    </p>
                  )}
                  {catalogStatus === "error" && (
                    <p className="muted small-text">
                      No se pudo leer el catálogo de opencode; se conservan los modelos ya
                      asignados.
                    </p>
                  )}
                </div>

                <div className="field">
                  <span>Modelo por defecto</span>
                  <Select
                    aria-label="Modelo por defecto"
                    value={draft.model ?? ""}
                    placeholder="Sin modelo por defecto"
                    options={[...new Set(draft.models.map((model) => model.trim()))]
                      .filter(Boolean)
                      .map((model) => {
                        const details = catalogIndex.get(model);
                        return {
                          value: model,
                          label: modelLabel(model),
                          tooltip: details ? <ModelInfoCard details={details} /> : undefined,
                        };
                      })}
                    variant="field"
                    onValueChange={(model) => {
                      setDraft((prev) => ({
                        ...prev,
                        model: model || null,
                      }));
                      setProfileSaved(false);
                    }}
                  />
                </div>
                <p className="muted small-text">
                  El modelo por defecto se aplica a los agentes que no traen uno asignado.
                </p>

                <div className="profile-assets">
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
                  <span>AGENTS.md del perfil</span>
                  <textarea
                    className="text-area"
                    rows={6}
                    value={agentsMd}
                    placeholder="Instrucciones propias del perfil…"
                    onChange={(event) => {
                      setAgentsMd(event.target.value);
                      setProfileSaved(false);
                    }}
                  />
                </label>
                {profileSaved && (
                  <div className="ok-box">
                    Profile guardado. Reaplícalo en los workspaces que quieras actualizar.
                  </div>
                )}
                <div className="row">
                  {draft.id && (
                    <button
                      className="ghost danger-text"
                      onClick={() => void deleteProfile()}
                      disabled={busy}
                    >
                      Borrar perfil
                    </button>
                  )}
                  <button className="primary" onClick={() => void saveProfile()} disabled={busy}>
                    {busy ? "Guardando…" : "Guardar perfil"}
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
