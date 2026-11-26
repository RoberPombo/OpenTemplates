import { useWizard, type UseWizardInput } from "../hooks/useWizard";
import type { Library } from "../../types";
import {
  CheckboxRow,
  SearchField,
  WIZARD_STEPS as STEPS,
  WizardFooter,
  WizardShell,
  WizardStepper,
} from "./wizard/chrome";

type Props = UseWizardInput & { library: Library; onClose: () => void };

export function CreateWorkspace(props: Props) {
  const { repos, profiles, library, onClose } = props;
  const wizard = useWizard(props);

  return (
    <WizardShell
      onClose={onClose}
      error={wizard.error}
      stepper={<WizardStepper steps={STEPS} step={wizard.step} onSelect={wizard.goToStep} />}
      footer={
        <WizardFooter
          step={wizard.step}
          steps={STEPS.length}
          name={wizard.name}
          submitting={wizard.submitting}
          canContinue={wizard.canContinue()}
          onBack={wizard.back}
          onNext={wizard.next}
          onCreate={() => void wizard.create()}
        />
      }
    >
      {wizard.step === 0 && (
        <section className="wizard-pane">
          <div className="section-head">
            <h3>Repositorio</h3>
            <button className="ghost small" onClick={() => void wizard.pickRepo()}>
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
                className={`option ${!wizard.loose && wizard.repoId === item.id ? "on" : ""}`}
                onClick={() => wizard.selectRepo(item.id)}
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
              className={`option ${wizard.loose ? "on" : ""}`}
              onClick={wizard.selectLoose}
            >
              <span className="option-main">
                <span className="option-title">Carpeta suelta (sin repo)</span>
                <span className="option-sub">Workspace ad-hoc como en la versión anterior.</span>
              </span>
            </button>
          </div>
          {wizard.loose && (
            <label className="field">
              <span>Carpeta</span>
              <div className="row">
                <input
                  className="text-input"
                  value={wizard.loosePath}
                  placeholder="/ruta/al/proyecto"
                  onChange={(event) => wizard.setLoosePath(event.target.value)}
                />
                <button className="ghost" onClick={() => void wizard.pickLooseFolder()}>
                  Elegir…
                </button>
              </div>
            </label>
          )}
        </section>
      )}

      {wizard.step === 1 && (
        <section className="wizard-pane">
          <div className="section-head">
            <h3>Perfil</h3>
            <button className="ghost small" onClick={wizard.toggleQuickOpen}>
              {wizard.quickOpen ? "Cancelar" : "Crear perfil"}
            </button>
          </div>
          <p className="muted small-text">
            El perfil elige agentes, skills, MCPs, comandos y plugins de la biblioteca global. Se
            congela al crear el workspace.
          </p>

          {wizard.quickOpen && (
            <div className="quick-profile">
              <label className="field">
                <span>Nombre</span>
                <input
                  className="text-input"
                  value={wizard.quickName}
                  placeholder="Backend, revisión, observabilidad…"
                  onChange={(event) => wizard.setQuickName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Descripción</span>
                <input
                  className="text-input"
                  value={wizard.quickDescription}
                  placeholder="API, tests y revisión"
                  onChange={(event) => wizard.setQuickDescription(event.target.value)}
                />
              </label>
              <div className="row">
                <span className="muted small-text">id: {wizard.quickSlug || "—"}</span>
                <button
                  className="primary"
                  onClick={() => void wizard.createQuickProfile()}
                  disabled={wizard.savingProfile}
                >
                  {wizard.savingProfile ? "Guardando…" : "Crear y elegir"}
                </button>
              </div>
              <p className="muted small-text">
                Se crea con los MCPs y skills que has marcado. Podrás ajustar agentes, comandos y
                plugins en Ajustes → Perfiles.
              </p>
            </div>
          )}

          <div className="option-list">
            <button
              type="button"
              className={`option ${wizard.profileId === null ? "on" : ""}`}
              onClick={() => wizard.setProfileId(null)}
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
                className={`option ${wizard.profileId === item.id ? "on" : ""}`}
                onClick={() => wizard.setProfileId(item.id)}
              >
                <span className="option-main">
                  <span className="option-title">
                    {item.name}
                    <span className="tool-chip">v{item.version}</span>
                  </span>
                  <span className="option-sub">{item.description || "Sin descripción"}</span>
                  <span className="option-sub">
                    {item.agents.length} agentes · {item.skills.length} skills · {item.mcps.length}{" "}
                    MCPs · {item.commands.length} comandos · {item.plugins.length} plugins
                  </span>
                </span>
              </button>
            ))}
          </div>

          {wizard.profileId === null && (
            <div className="pick-lists">
              <section>
                <div className="section-head">
                  <h3>MCPs</h3>
                  <span className="muted">{wizard.selectedMcps.size} elegidos</span>
                </div>
                <div className="check-list compact">
                  {library.mcps.map((mcp) => (
                    <CheckboxRow
                      key={mcp.name}
                      checked={wizard.selectedMcps.has(mcp.name)}
                      title={mcp.name}
                      subtitle={
                        typeof mcp.config.url === "string"
                          ? mcp.config.url
                          : Array.isArray(mcp.config.command)
                            ? mcp.config.command.join(" ")
                            : ""
                      }
                      onChange={() => wizard.toggleMcp(mcp.name)}
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
                  <span className="muted">{wizard.selectedSkills.size} elegidas</span>
                </div>
                <div className="check-list compact">
                  {library.skills.map((skill) => (
                    <CheckboxRow
                      key={skill.id}
                      checked={wizard.selectedSkills.has(skill.id)}
                      title={skill.name}
                      subtitle={skill.description}
                      onChange={() => wizard.toggleSkill(skill)}
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

      {wizard.step === 2 && (
        <section className="wizard-pane">
          <label className="field">
            <span>Nombre del workspace</span>
            <input
              autoFocus
              className="text-input"
              value={wizard.name}
              placeholder="login-safari, revisión-api…"
              onChange={(event) => wizard.setName(event.target.value)}
            />
            {wizard.name.trim() && (
              <span className="field-hint">id de rama y carpeta: {wizard.slug || "—"}</span>
            )}
          </label>

          {wizard.loose ? (
            <div className="callout info">
              Workspace ad-hoc sobre <code>{wizard.loosePath || "la carpeta elegida"}</code>.
            </div>
          ) : (
            <>
              <div className="section-head">
                <h3>Modo</h3>
              </div>
              <div className="option-list">
                <button
                  type="button"
                  className={`option ${wizard.mode === "worktree" ? "on" : ""}`}
                  onClick={() => wizard.setMode("worktree")}
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
                  className={`option ${wizard.mode === "principal" ? "on" : ""}`}
                  onClick={() => wizard.setMode("principal")}
                >
                  <span className="option-main">
                    <span className="option-title">Checkout principal</span>
                    <span className="option-sub">
                      Trabaja sobre {wizard.repo?.path ?? "la carpeta del repo"} y su rama actual.
                    </span>
                  </span>
                </button>
              </div>

              {wizard.mode === "worktree" && (
                <div className="form-grid">
                  <SearchField
                    label="Rama"
                    value={wizard.branch}
                    onChange={wizard.setBranch}
                    placeholder={wizard.defaultBranch}
                    hint="Vacío = el id del nombre."
                  />
                  <SearchField
                    label="Base"
                    value={wizard.base}
                    onChange={wizard.setBase}
                    placeholder={`origin/${wizard.repo?.mainBranch ?? "main"}`}
                    hint="Vacío = origin/rama principal si existe."
                  />
                  <SearchField
                    label="Ruta del worktree"
                    value={wizard.worktreePath}
                    onChange={wizard.setWorktreePath}
                    placeholder={wizard.defaultPath}
                    hint="Vacío = raíz configurada / repo / slug."
                  />
                  <div className="check-list compact">
                    <CheckboxRow
                      checked={wizard.fetchRemote}
                      title="git fetch antes de crear"
                      subtitle="Actualiza origin para partir de la última base."
                      onChange={wizard.toggleFetchRemote}
                    />
                    <CheckboxRow
                      checked={wizard.useExisting}
                      title="Usar una rama existente"
                      subtitle="Si la rama ya existe en el repo, se reutiliza."
                      onChange={wizard.toggleUseExisting}
                    />
                  </div>
                </div>
              )}

              {wizard.mode === "principal" && wizard.principalConflicts.length > 0 && (
                <div className="callout warning">
                  Ya hay{" "}
                  {wizard.principalConflicts.length === 1 ? "un workspace" : "varios workspaces"}{" "}
                  sobre el checkout principal:{" "}
                  {wizard.principalConflicts.map((workspace) => workspace.name).join(", ")}. Dos
                  procesos sobre la misma carpeta comparten ficheros y estado git. Para paralelo,
                  usa un worktree.
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

      {wizard.step === 3 && (
        <section className="wizard-pane">
          <div className="section-head">
            <h3>Resumen</h3>
          </div>
          <dl className="summary">
            <div>
              <dt>Nombre</dt>
              <dd>{wizard.name.trim() || "—"}</dd>
            </div>
            <div>
              <dt>Repo</dt>
              <dd>{wizard.loose ? "Sin repo (ad-hoc)" : (wizard.repo?.name ?? "—")}</dd>
            </div>
            <div>
              <dt>Carpeta</dt>
              <dd>
                {wizard.loose
                  ? wizard.loosePath || "—"
                  : wizard.mode === "principal"
                    ? (wizard.repo?.path ?? "—")
                    : wizard.worktreePath.trim() || wizard.defaultPath || "—"}
              </dd>
            </div>
            <div>
              <dt>Modo</dt>
              <dd>{wizard.loose ? "ad-hoc" : wizard.mode}</dd>
            </div>
            {!wizard.loose && wizard.mode === "worktree" && (
              <>
                <div>
                  <dt>Rama</dt>
                  <dd>{wizard.branch.trim() || wizard.defaultBranch}</dd>
                </div>
                <div>
                  <dt>Base</dt>
                  <dd>
                    {wizard.base.trim() ||
                      (wizard.repo?.remote
                        ? `origin/${wizard.repo.mainBranch}`
                        : wizard.repo?.mainBranch || "—")}
                  </dd>
                </div>
              </>
            )}
            <div>
              <dt>Profile</dt>
              <dd>
                {wizard.profile
                  ? `${wizard.profile.name} · v${wizard.profile.version}`
                  : "Sin perfil"}
              </dd>
            </div>
            <div>
              <dt>Selección</dt>
              <dd>
                {wizard.profile
                  ? `${wizard.profile.agents.length} agentes · ${wizard.profile.skills.length} skills · ${wizard.profile.mcps.length} MCPs`
                  : `${wizard.selectedMcps.size} MCPs · ${wizard.selectedSkills.size} skills`}
              </dd>
            </div>
          </dl>

          {wizard.pathConflicts.length > 0 && (
            <div className="callout warning">
              La carpeta del checkout principal ya la usa{" "}
              {wizard.pathConflicts.map((workspace) => `«${workspace.name}»`).join(", ")}. Puedes
              continuar, pero los dos procesos compartirán ficheros.
            </div>
          )}

          <CheckboxRow
            checked={wizard.startNow}
            title="Arrancar el servidor al crear"
            subtitle="Lanza opencode con la config recién materializada."
            onChange={wizard.toggleStartNow}
          />
        </section>
      )}
    </WizardShell>
  );
}
