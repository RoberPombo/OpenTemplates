/** Paso 3 del wizard: nombre del workspace y modo de trabajo. */
import type { Repo, Workspace } from "../../../types";
import { CheckboxRow, SearchField } from "./chrome";

type Props = {
  name: string;
  slug: string;
  loose: boolean;
  loosePath: string;
  repo: Repo | null;
  mode: "principal" | "worktree";
  branch: string;
  base: string;
  worktreePath: string;
  defaultBranch: string;
  defaultPath: string;
  fetchRemote: boolean;
  useExisting: boolean;
  principalConflicts: Workspace[];
  onNameChange: (value: string) => void;
  onModeChange: (mode: "principal" | "worktree") => void;
  onBranchChange: (value: string) => void;
  onBaseChange: (value: string) => void;
  onWorktreePathChange: (value: string) => void;
  onToggleFetchRemote: () => void;
  onToggleUseExisting: () => void;
};

export function NameStep({
  name,
  slug,
  loose,
  loosePath,
  repo,
  mode,
  branch,
  base,
  worktreePath,
  defaultBranch,
  defaultPath,
  fetchRemote,
  useExisting,
  principalConflicts,
  onNameChange,
  onModeChange,
  onBranchChange,
  onBaseChange,
  onWorktreePathChange,
  onToggleFetchRemote,
  onToggleUseExisting,
}: Props) {
  return (
    <section className="wizard-pane">
      <label className="field">
        <span>Nombre del workspace</span>
        <input
          autoFocus
          className="text-input"
          value={name}
          placeholder="login-safari, revisión-api…"
          onChange={(event) => onNameChange(event.target.value)}
        />
        {name.trim() && <span className="field-hint">id de rama y carpeta: {slug || "—"}</span>}
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
              onClick={() => onModeChange("worktree")}
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
              onClick={() => onModeChange("principal")}
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
                onChange={onBranchChange}
                placeholder={defaultBranch}
                hint="Vacío = el id del nombre."
              />
              <SearchField
                label="Base"
                value={base}
                onChange={onBaseChange}
                placeholder={`origin/${repo?.mainBranch ?? "main"}`}
                hint="Vacío = origin/rama principal si existe."
              />
              <SearchField
                label="Ruta del worktree"
                value={worktreePath}
                onChange={onWorktreePathChange}
                placeholder={defaultPath}
                hint="Vacío = raíz configurada / repo / slug."
              />
              <div className="check-list compact">
                <CheckboxRow
                  checked={fetchRemote}
                  title="git fetch antes de crear"
                  subtitle="Actualiza origin para partir de la última base."
                  onChange={onToggleFetchRemote}
                />
                <CheckboxRow
                  checked={useExisting}
                  title="Usar una rama existente"
                  subtitle="Si la rama ya existe en el repo, se reutiliza."
                  onChange={onToggleUseExisting}
                />
              </div>
            </div>
          )}

          {mode === "principal" && principalConflicts.length > 0 && (
            <div className="callout warning">
              Ya hay {principalConflicts.length === 1 ? "un workspace" : "varios workspaces"} sobre
              el checkout principal:{" "}
              {principalConflicts.map((workspace) => workspace.name).join(", ")}. Dos procesos sobre
              la misma carpeta comparten ficheros y estado git. Para paralelo, usa un worktree.
            </div>
          )}
        </>
      )}

      <p className="muted small-text">
        Las issues de GitHub con <code>gh</code> llegan en la siguiente fase; este asistente crea ya
        el workspace, la rama y la config aislada.
      </p>
    </section>
  );
}
