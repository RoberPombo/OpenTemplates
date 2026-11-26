/** Paso 1 del wizard: elegir repositorio o carpeta suelta. */
import type { Repo } from "../../../types";

type Props = {
  repos: Repo[];
  loose: boolean;
  repoId: string | null;
  loosePath: string;
  onSelectRepo: (id: string) => void;
  onSelectLoose: () => void;
  onPickRepo: () => void;
  onPickLooseFolder: () => void;
  onLoosePathChange: (value: string) => void;
};

export function RepoStep({
  repos,
  loose,
  repoId,
  loosePath,
  onSelectRepo,
  onSelectLoose,
  onPickRepo,
  onPickLooseFolder,
  onLoosePathChange,
}: Props) {
  return (
    <section className="wizard-pane">
      <div className="section-head">
        <h3>Repositorio</h3>
        <button className="ghost small" onClick={onPickRepo}>
          Añadir carpeta…
        </button>
      </div>
      {repos.length === 0 && (
        <p className="muted">
          Todavía no hay repositorios. Añade la carpeta de un repo git para crear workspaces sobre
          su checkout principal o sobre worktrees.
        </p>
      )}
      <div className="option-list">
        {repos.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`option ${!loose && repoId === item.id ? "on" : ""}`}
            aria-label={`${item.name} · ${item.path}`}
            onClick={() => onSelectRepo(item.id)}
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
          aria-label="Carpeta suelta (sin repo)"
          onClick={onSelectLoose}
        >
          <span className="option-main">
            <span className="option-title">Carpeta suelta (sin repo)</span>
            <span className="option-sub">Workspace ad-hoc como en la versión anterior.</span>
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
              onChange={(event) => onLoosePathChange(event.target.value)}
            />
            <button className="ghost" onClick={onPickLooseFolder}>
              Elegir…
            </button>
          </div>
        </label>
      )}
    </section>
  );
}
