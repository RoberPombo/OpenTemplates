/** Alta de una feature: nombre, tipo, objetivo, metarepo opcional y repos. */
import { useMemo, useState } from "react";
import { toggleSetValue } from "../../domain/shared";
import {
  createFeatureDraft,
  flowForKind,
  type Feature,
  type FeatureKind,
  type FeatureRootInput,
  type FeatureTargetInput,
} from "../../domain/features/model";
import type { Repo } from "../../types";

type Props = {
  repos: Repo[];
  dataDir: string;
  onClose: () => void;
  onCreated: (feature: Feature) => void;
};

const KINDS: { value: FeatureKind; label: string; hint: string }[] = [
  { value: "feature", label: "Feature", hint: "Funcionalidad nueva. Flujo completo." },
  { value: "fix", label: "Fix", hint: "Bug con alcance normal. Flujo completo." },
  { value: "hotfix", label: "Hotfix", hint: "Producción rota. Flujo rápido." },
  { value: "chore", label: "Chore", hint: "Sin código de producción. Flujo rápido." },
];

function parseScopes(raw: string): string[] {
  const scopes = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : ["."];
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `feat-${Date.now()}`;
}

export function FeatureDialog({ repos, dataDir, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FeatureKind>("feature");
  const [brief, setBrief] = useState("");
  const [rootId, setRootId] = useState("");
  const [baseRoot, setBaseRoot] = useState("main");
  const [baseTarget, setBaseTarget] = useState("main");
  const [scopes, setScopes] = useState(".");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const rootRepo = repos.find((repo) => repo.id === rootId) ?? null;
  const targetRepos = useMemo(
    () => repos.filter((repo) => selected.has(repo.id) && repo.id !== rootId),
    [repos, selected, rootId],
  );
  const canCreate = name.trim().length > 0 && brief.trim().length > 0 && targetRepos.length > 0;
  const flow = flowForKind(kind);

  function toggleTarget(id: string) {
    setSelected((prev) => toggleSetValue(prev, id));
    setError(null);
  }

  function submit() {
    const id = newId();
    const root: FeatureRootInput | null = rootRepo
      ? {
          repoId: rootRepo.id,
          name: rootRepo.name,
          repoPath: rootRepo.path,
          baseBranch: baseRoot.trim() || "main",
          bootstrap: rootRepo.bootstrap ?? [],
        }
      : null;

    const targets: FeatureTargetInput[] = targetRepos.map((repo) => ({
      repoId: repo.id,
      name: repo.name,
      repoPath: repo.path,
      baseBranch: baseTarget.trim() || "main",
      scopes: parseScopes(scopes),
      bootstrap: repo.bootstrap ?? [],
    }));

    const directory = `${dataDir.replace(/\/+$/, "")}/features/${id}`;
    const result = createFeatureDraft({
      id,
      name,
      kind,
      brief,
      directory,
      root,
      targets,
      now: Date.now(),
    });
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onCreated(result.feature);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal feature-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Nueva feature</h2>
            <p className="muted small-text">
              Un objetivo y los repos que toca. El worktree se crea al confirmar.
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <div className="modal-body">
          <label className="field">
            <span>Nombre</span>
            <input
              className="text-input"
              value={name}
              placeholder="Checkout con Stripe"
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
          </label>

          <div className="row feature-form-row">
            <label className="field">
              <span>Tipo</span>
              <select
                className="text-input"
                value={kind}
                onChange={(event) => setKind(event.target.value as FeatureKind)}
              >
                {KINDS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Metarepo (opcional)</span>
              <select
                className="text-input"
                value={rootId}
                onChange={(event) => {
                  const next = event.target.value;
                  setRootId(next);
                  if (next) {
                    setSelected((prev) => {
                      const copy = new Set(prev);
                      copy.delete(next);
                      return copy;
                    });
                  }
                }}
              >
                <option value="">Sin metarepo</option>
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Objetivo</span>
            <textarea
              className="text-input feature-brief"
              value={brief}
              placeholder="Qué hay que conseguir y cómo se sabrá que está hecho."
              onChange={(event) => {
                setBrief(event.target.value);
                setError(null);
              }}
            />
          </label>

          <div className="row feature-form-row">
            <label className="field">
              <span>Base del metarepo</span>
              <input
                className="text-input"
                value={baseRoot}
                onChange={(event) => setBaseRoot(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Base de los repos</span>
              <input
                className="text-input"
                value={baseTarget}
                placeholder="main"
                onChange={(event) => setBaseTarget(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Scopes</span>
              <input
                className="text-input"
                value={scopes}
                placeholder="front, back"
                onChange={(event) => setScopes(event.target.value)}
              />
            </label>
          </div>
          <p className="muted small-text">
            Scopes separados por comas; se aplican a todos los repos. Para un repo suelto, no elijas
            metarepo: selecciónalo como repo.
          </p>

          <section className="feature-pick">
            <div className="section-head">
              <h3>Repos que entran</h3>
              <span className="muted small-text">{targetRepos.length} seleccionado(s)</span>
            </div>
            {repos.length === 0 && (
              <p className="muted">
                No hay repositorios. Añádelos en Ajustes → Repositorios antes de crear una feature.
              </p>
            )}
            {repos.map((repo) => {
              const isRoot = repo.id === rootId;
              return (
                <label key={repo.id} className={`check ${selected.has(repo.id) ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(repo.id)}
                    disabled={isRoot}
                    onChange={() => toggleTarget(repo.id)}
                  />
                  <span className="check-main">
                    <span className="check-title">
                      {repo.name}
                      {isRoot ? " · metarepo" : ""}
                    </span>
                    <span className="check-sub">{repo.path}</span>
                  </span>
                </label>
              );
            })}
          </section>

          <p className="muted small-text">
            {flow === "fast"
              ? "Flujo rápido: cambio y verificación, sin coordinador ni plan."
              : "Flujo completo: coordinación, recon, plan, implementación y verificación."}
          </p>
          {error && <div className="inline-error">{error}</div>}
        </div>

        <footer className="modal-foot">
          <span className="muted">
            {targetRepos.length === 0 ? "Elige al menos un repo" : "Se confirmará al crear"}
          </span>
          <div className="row">
            <button className="ghost" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary" disabled={!canCreate} onClick={submit}>
              Crear feature
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
