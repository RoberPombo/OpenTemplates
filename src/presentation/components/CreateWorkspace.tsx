import { useState } from "react";
import { useAppContext } from "../context/AppContext";
import { errorText } from "../../domain/shared";
import {
  canContinue as canContinueStep,
  defaultBranch as branchDefault,
  defaultWorktreePath,
  pathConflicts as findPathConflicts,
  principalConflicts as findPrincipalConflicts,
  quickProfileId,
  slugify,
  workspaceNameError,
} from "../../domain/workspace/wizard";
import type {
  CreateWorkspaceInput,
  Library,
  Repo,
  SkillRef,
  ProfileManifest,
  Workspace,
} from "../../types";
import { TextInput } from "./ui";

type Props = {
  repos: Repo[];
  profiles: ProfileManifest[];
  library: Library;
  workspaces: Workspace[];
  worktreesRoot: string;
  onClose: () => void;
  onRepoAdded: (repo: Repo) => void;
  onProfileSaved: (profile: ProfileManifest) => void;
  onCreated: (workspace: Workspace, warnings: string[], startNow: boolean) => void;
};

const STEPS = ["Repo", "Profile", "Nombre", "Resumen"];

function SearchField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <TextInput
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function CheckboxRow({
  checked,
  title,
  subtitle,
  onChange,
}: {
  checked: boolean;
  title: string;
  subtitle: string;
  onChange: () => void;
}) {
  return (
    <label className={`check ${checked ? "on" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="check-main">
        <span className="check-title">{title}</span>
        <span className="check-sub">{subtitle}</span>
      </span>
    </label>
  );
}

export function CreateWorkspace({
  repos,
  profiles,
  library,
  workspaces,
  worktreesRoot,
  onClose,
  onRepoAdded,
  onProfileSaved,
  onCreated,
}: Props) {
  const root = useAppContext();
  const [step, setStep] = useState(0);
  const [loose, setLoose] = useState(repos.length === 0);
  const [repoId, setRepoId] = useState<string | null>(repos[0]?.id ?? null);
  const [loosePath, setLoosePath] = useState("");
  const [profileId, setProfileId] = useState<string | null>(profiles[0]?.id ?? null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"principal" | "worktree">("worktree");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [worktreePath, setWorktreePath] = useState("");
  const [fetchRemote, setFetchRemote] = useState(false);
  const [useExisting, setUseExisting] = useState(false);
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(new Set());
  const [selectedSkills, setSelectedSkills] = useState<Map<string, SkillRef>>(new Map());
  const [startNow, setStartNow] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickDescription, setQuickDescription] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repo = repos.find((item) => item.id === repoId) ?? null;
  const profile = profiles.find((item) => item.id === profileId) ?? null;
  const slug = slugify(name);
  const defaultBranch = branchDefault(slug);
  const defaultPath = repo ? defaultWorktreePath(worktreesRoot, repo.name, slug) : "";

  const principalConflicts = repo ? findPrincipalConflicts(workspaces, repo.id) : [];
  const pathConflicts = repo ? findPathConflicts(workspaces, repo.path) : [];

  function selectRepo(id: string) {
    setRepoId(id);
    setLoose(false);
    setError(null);
  }

  async function pickRepo() {
    try {
      const picked = await root.folderPicker.pickDirectory("Elegir repositorio git");
      if (!picked) return;
      const added = await root.repos.add(picked);
      onRepoAdded(added);
      selectRepo(added.id);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function pickLooseFolder() {
    const picked = await root.folderPicker.pickDirectory("Elegir carpeta del proyecto");
    if (picked) {
      setLoose(true);
      setLoosePath(picked);
      setError(null);
    }
  }

  async function createQuickProfile() {
    const result = quickProfileId(
      quickName,
      profiles.map((item) => item.id),
    );
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const id = result.id;
    setSavingProfile(true);
    setError(null);
    try {
      const now = Date.now();
      const saved = await root.profiles.save({
        id,
        name: quickName.trim(),
        description: quickDescription.trim(),
        version: 1,
        agents: [],
        skills: [...selectedSkills.keys()],
        mcps: [...selectedMcps],
        commands: [],
        plugins: [],
        models: [],
        model: null,
        permissions: [],
        createdAt: now,
        updatedAt: now,
      });
      onProfileSaved(saved);
      setProfileId(saved.id);
      setQuickOpen(false);
      setQuickName("");
      setQuickDescription("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingProfile(false);
    }
  }

  function toggleMcp(name_: string) {
    setSelectedMcps((prev) => {
      const next = new Set(prev);
      if (next.has(name_)) next.delete(name_);
      else next.add(name_);
      return next;
    });
  }

  function toggleSkill(skill: Library["skills"][number]) {
    setSelectedSkills((prev) => {
      const next = new Map(prev);
      if (next.has(skill.id)) next.delete(skill.id);
      else next.set(skill.id, { id: skill.id, path: skill.path });
      return next;
    });
  }

  function canContinue() {
    return canContinueStep(step, { loose, loosePath, repoId, name, mode, useExisting, branch });
  }

  async function create() {
    const nameError = workspaceNameError(name);
    if (nameError) {
      setError(nameError);
      return;
    }
    const isWorktree = !loose && mode === "worktree";
    const input: CreateWorkspaceInput = {
      name: name.trim(),
      repoId: loose ? null : repoId,
      projectPath: loose ? loosePath : null,
      // El perfil también aplica a carpetas sueltas: define agentes, skills y MCPs.
      profileId,
      mode: loose ? "adhoc" : mode,
      branch: isWorktree ? branch.trim() || null : null,
      base: isWorktree ? base.trim() || null : null,
      worktreePath: isWorktree ? worktreePath.trim() || null : null,
      useExistingBranch: useExisting,
      fetch: fetchRemote,
      mcpNames: profileId ? [] : [...selectedMcps],
      skills: profileId ? [] : [...selectedSkills.values()],
      model: null,
    };
    setSubmitting(true);
    setError(null);
    try {
      const outcome = await root.provideCreateWorkspace().execute(input);
      onCreated(outcome.workspace, outcome.warnings, startNow);
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal wizard" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Nuevo workspace</h2>
            <p className="muted small-text">
              Repo, perfil y modo de trabajo. La config queda aislada.
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <ol className="wizard-steps">
          {STEPS.map((label, index) => (
            <li key={label}>
              <button
                className={index === step ? "active" : index < step ? "done" : ""}
                onClick={() => {
                  if (index < step) {
                    setStep(index);
                    setError(null);
                  }
                }}
                disabled={index > step}
                type="button"
              >
                <span>{index + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        <div className="modal-body wizard-body">
          {step === 0 && (
            <section className="wizard-pane">
              <div className="section-head">
                <h3>Repositorio</h3>
                <button className="ghost small" onClick={() => void pickRepo()}>
                  Añadir carpeta…
                </button>
              </div>
              {repos.length === 0 && (
                <p className="muted">
                  Todavía no hay repositorios. Añade la carpeta de un repo git para crear workspaces
                  sobre su checkout principal o sobre worktrees.
                </p>
              )}
              <div className="option-list">
                {repos.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`option ${!loose && repoId === item.id ? "on" : ""}`}
                    onClick={() => selectRepo(item.id)}
                  >
                    <span className="option-main">
                      <span className="option-title">
                        {item.name}
                        <span className="tool-chip">{item.provider}</span>
                      </span>
                      <span className="option-sub">{item.path}</span>
                      <span className="option-sub">
                        rama principal · {item.mainBranch}
                        {item.remote ? ` · ${item.remote}` : " · sin remoto"}
                      </span>
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className={`option ${loose ? "on" : ""}`}
                  onClick={() => {
                    setLoose(true);
                    setError(null);
                  }}
                >
                  <span className="option-main">
                    <span className="option-title">Carpeta suelta (sin repo)</span>
                    <span className="option-sub">
                      Workspace ad-hoc como en la versión anterior.
                    </span>
                  </span>
                </button>
              </div>
              {loose && (
                <label className="field">
                  <span>Carpeta</span>
                  <div className="row">
                    <input
                      className="text-input"
                      value={loosePath}
                      placeholder="/ruta/al/proyecto"
                      onChange={(event) => setLoosePath(event.target.value)}
                    />
                    <button className="ghost" onClick={() => void pickLooseFolder()}>
                      Elegir…
                    </button>
                  </div>
                </label>
              )}
            </section>
          )}

          {step === 1 && (
            <section className="wizard-pane">
              <div className="section-head">
                <h3>Perfil</h3>
                <button className="ghost small" onClick={() => setQuickOpen((value) => !value)}>
                  {quickOpen ? "Cancelar" : "Crear perfil"}
                </button>
              </div>
              <p className="muted small-text">
                El perfil elige agentes, skills, MCPs, comandos y plugins de la biblioteca global.
                Se congela al crear el workspace.
              </p>

              {quickOpen && (
                <div className="quick-profile">
                  <label className="field">
                    <span>Nombre</span>
                    <input
                      className="text-input"
                      value={quickName}
                      placeholder="Backend, revisión, observabilidad…"
                      onChange={(event) => setQuickName(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Descripción</span>
                    <input
                      className="text-input"
                      value={quickDescription}
                      placeholder="API, tests y revisión"
                      onChange={(event) => setQuickDescription(event.target.value)}
                    />
                  </label>
                  <div className="row">
                    <span className="muted small-text">id: {slugify(quickName) || "—"}</span>
                    <button
                      className="primary"
                      onClick={() => void createQuickProfile()}
                      disabled={savingProfile}
                    >
                      {savingProfile ? "Guardando…" : "Crear y elegir"}
                    </button>
                  </div>
                  <p className="muted small-text">
                    Se crea con los MCPs y skills que has marcado. Podrás ajustar agentes, comandos
                    y plugins en «Repos y perfiles».
                  </p>
                </div>
              )}

              <div className="option-list">
                <button
                  type="button"
                  className={`option ${profileId === null ? "on" : ""}`}
                  onClick={() => setProfileId(null)}
                >
                  <span className="option-main">
                    <span className="option-title">Sin perfil</span>
                    <span className="option-sub">
                      Elige MCPs y skills ahora; el resto hereda de la config global.
                    </span>
                  </span>
                </button>
                {profiles.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`option ${profileId === item.id ? "on" : ""}`}
                    onClick={() => setProfileId(item.id)}
                  >
                    <span className="option-main">
                      <span className="option-title">
                        {item.name}
                        <span className="tool-chip">v{item.version}</span>
                      </span>
                      <span className="option-sub">{item.description || "Sin descripción"}</span>
                      <span className="option-sub">
                        {item.agents.length} agentes · {item.skills.length} skills ·{" "}
                        {item.mcps.length} MCPs · {item.commands.length} comandos ·{" "}
                        {item.plugins.length} plugins
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              {profileId === null && (
                <div className="pick-lists">
                  <section>
                    <div className="section-head">
                      <h3>MCPs</h3>
                      <span className="muted">{selectedMcps.size} elegidos</span>
                    </div>
                    <div className="check-list compact">
                      {library.mcps.map((mcp) => (
                        <CheckboxRow
                          key={mcp.name}
                          checked={selectedMcps.has(mcp.name)}
                          title={mcp.name}
                          subtitle={
                            typeof mcp.config.url === "string"
                              ? mcp.config.url
                              : Array.isArray(mcp.config.command)
                                ? mcp.config.command.join(" ")
                                : ""
                          }
                          onChange={() => toggleMcp(mcp.name)}
                        />
                      ))}
                      {library.mcps.length === 0 && (
                        <p className="muted">No hay MCPs en la config global.</p>
                      )}
                    </div>
                  </section>
                  <section>
                    <div className="section-head">
                      <h3>Skills</h3>
                      <span className="muted">{selectedSkills.size} elegidas</span>
                    </div>
                    <div className="check-list compact">
                      {library.skills.map((skill) => (
                        <CheckboxRow
                          key={skill.id}
                          checked={selectedSkills.has(skill.id)}
                          title={skill.name}
                          subtitle={skill.description}
                          onChange={() => toggleSkill(skill)}
                        />
                      ))}
                      {library.skills.length === 0 && (
                        <p className="muted">No se encontraron skills.</p>
                      )}
                    </div>
                  </section>
                </div>
              )}
            </section>
          )}

          {step === 2 && (
            <section className="wizard-pane">
              <label className="field">
                <span>Nombre del workspace</span>
                <input
                  autoFocus
                  className="text-input"
                  value={name}
                  placeholder="login-safari, revisión-api…"
                  onChange={(event) => setName(event.target.value)}
                />
                {name.trim() && (
                  <span className="field-hint">id de rama y carpeta: {slug || "—"}</span>
                )}
              </label>

              {loose ? (
                <div className="callout info">
                  Workspace ad-hoc sobre <code>{loosePath || "la carpeta elegida"}</code>.
                </div>
              ) : (
                <>
                  <div className="section-head">
                    <h3>Modo</h3>
                  </div>
                  <div className="option-list">
                    <button
                      type="button"
                      className={`option ${mode === "worktree" ? "on" : ""}`}
                      onClick={() => setMode("worktree")}
                    >
                      <span className="option-main">
                        <span className="option-title">Worktree (recomendado)</span>
                        <span className="option-sub">
                          Carpeta aparte y rama propia. Varios workspaces en paralelo sin compartir
                          ficheros.
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`option ${mode === "principal" ? "on" : ""}`}
                      onClick={() => setMode("principal")}
                    >
                      <span className="option-main">
                        <span className="option-title">Checkout principal</span>
                        <span className="option-sub">
                          Trabaja sobre {repo?.path ?? "la carpeta del repo"} y su rama actual.
                        </span>
                      </span>
                    </button>
                  </div>

                  {mode === "worktree" && (
                    <div className="form-grid">
                      <SearchField
                        label="Rama"
                        value={branch}
                        onChange={setBranch}
                        placeholder={defaultBranch}
                        hint="Vacío = el id del nombre."
                      />
                      <SearchField
                        label="Base"
                        value={base}
                        onChange={setBase}
                        placeholder={`origin/${repo?.mainBranch ?? "main"}`}
                        hint="Vacío = origin/rama principal si existe."
                      />
                      <SearchField
                        label="Ruta del worktree"
                        value={worktreePath}
                        onChange={setWorktreePath}
                        placeholder={defaultPath}
                        hint="Vacío = raíz configurada / repo / slug."
                      />
                      <div className="check-list compact">
                        <CheckboxRow
                          checked={fetchRemote}
                          title="git fetch antes de crear"
                          subtitle="Actualiza origin para partir de la última base."
                          onChange={() => setFetchRemote((value) => !value)}
                        />
                        <CheckboxRow
                          checked={useExisting}
                          title="Usar una rama existente"
                          subtitle="Si la rama ya existe en el repo, se reutiliza."
                          onChange={() => setUseExisting((value) => !value)}
                        />
                      </div>
                    </div>
                  )}

                  {mode === "principal" && principalConflicts.length > 0 && (
                    <div className="callout warning">
                      Ya hay{" "}
                      {principalConflicts.length === 1 ? "un workspace" : "varios workspaces"} sobre
                      el checkout principal:{" "}
                      {principalConflicts.map((workspace) => workspace.name).join(", ")}. Dos
                      procesos sobre la misma carpeta comparten ficheros y estado git. Para
                      paralelo, usa un worktree.
                    </div>
                  )}
                </>
              )}

              <p className="muted small-text">
                Las issues de GitHub con <code>gh</code> llegan en la siguiente fase; este asistente
                crea ya el workspace, la rama y la config aislada.
              </p>
            </section>
          )}

          {step === 3 && (
            <section className="wizard-pane">
              <div className="section-head">
                <h3>Resumen</h3>
              </div>
              <dl className="summary">
                <div>
                  <dt>Nombre</dt>
                  <dd>{name.trim() || "—"}</dd>
                </div>
                <div>
                  <dt>Repo</dt>
                  <dd>{loose ? "Sin repo (ad-hoc)" : (repo?.name ?? "—")}</dd>
                </div>
                <div>
                  <dt>Carpeta</dt>
                  <dd>
                    {loose
                      ? loosePath || "—"
                      : mode === "principal"
                        ? (repo?.path ?? "—")
                        : worktreePath.trim() || defaultPath || "—"}
                  </dd>
                </div>
                <div>
                  <dt>Modo</dt>
                  <dd>{loose ? "ad-hoc" : mode}</dd>
                </div>
                {!loose && mode === "worktree" && (
                  <>
                    <div>
                      <dt>Rama</dt>
                      <dd>{branch.trim() || defaultBranch}</dd>
                    </div>
                    <div>
                      <dt>Base</dt>
                      <dd>
                        {base.trim() ||
                          (repo?.remote ? `origin/${repo.mainBranch}` : repo?.mainBranch || "—")}
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Profile</dt>
                  <dd>{profile ? `${profile.name} · v${profile.version}` : "Sin perfil"}</dd>
                </div>
                <div>
                  <dt>Selección</dt>
                  <dd>
                    {profile
                      ? `${profile.agents.length} agentes · ${profile.skills.length} skills · ${profile.mcps.length} MCPs`
                      : `${selectedMcps.size} MCPs · ${selectedSkills.size} skills`}
                  </dd>
                </div>
              </dl>

              {pathConflicts.length > 0 && (
                <div className="callout warning">
                  La carpeta del checkout principal ya la usa{" "}
                  {pathConflicts.map((workspace) => `«${workspace.name}»`).join(", ")}. Puedes
                  continuar, pero los dos procesos compartirán ficheros.
                </div>
              )}

              <CheckboxRow
                checked={startNow}
                title="Arrancar el servidor al crear"
                subtitle="Lanza opencode con la config recién materializada."
                onChange={() => setStartNow((value) => !value)}
              />
            </section>
          )}

          {error && <div className="inline-error">{error}</div>}
        </div>

        <footer className="modal-foot">
          <span className="muted">
            {step === 3
              ? "Se materializa la config y, si procede, se crea el worktree"
              : `Paso ${step + 1} de ${STEPS.length}`}
          </span>
          <div className="row">
            {step > 0 && (
              <button
                className="ghost"
                onClick={() => {
                  setStep((value) => value - 1);
                  setError(null);
                }}
                disabled={submitting}
              >
                Atrás
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                className="primary"
                onClick={() => setStep((value) => value + 1)}
                disabled={!canContinue()}
              >
                Siguiente
              </button>
            ) : (
              <button
                className="primary"
                onClick={() => void create()}
                disabled={submitting || !name.trim()}
              >
                {submitting ? "Creando…" : "Crear workspace"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
