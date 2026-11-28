/**
 * Selector de issues abiertos de GitHub para el alta de una feature. Solo
 * lectura: usa `gh issue list` y nunca crea, cierra, edita ni comenta issues.
 * Si `gh` falta, no tiene sesión o la consulta falla, se puede seguir sin issue.
 */
import { useEffect, useRef, useState } from "react";
import { errorText } from "../../domain/shared";
import type { GitHubIssue } from "../../domain/features/issue";
import { sameIssue, shortIssueText } from "../../domain/features/issue";
import type { IssueGateway } from "../../domain/repositories/IssueGateway";
import type { GhStatus } from "../../domain/workspace/pullRequest";
import type { Repo } from "../../types";

export type IssueSelection = {
  repoId: string;
  issue: GitHubIssue;
};

type Props = {
  repos: Repo[];
  gateway?: IssueGateway;
  value: IssueSelection | null;
  onChange: (selection: IssueSelection | null) => void;
  /** Milisegundos de espera tras teclear; 300 por defecto. */
  searchDelayMs?: number;
};

const DEFAULT_LIMIT = 30;

export function FeatureIssuePicker({
  repos,
  gateway,
  value,
  onChange,
  searchDelayMs = 300,
}: Props) {
  const firstRepoId = repos[0]?.id ?? "";
  const [repoId, setRepoId] = useState(value?.repoId ?? firstRepoId);
  const [query, setQuery] = useState("");
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const request = useRef(0);

  const repo = repos.find((item) => item.id === repoId) ?? null;

  useEffect(() => {
    if (!repos.some((item) => item.id === repoId)) {
      // oxlint-disable-next-line react/set-state-in-effect -- el repo elegido desaparece del alta
      setRepoId(firstRepoId);
    }
  }, [repos, firstRepoId, repoId]);

  useEffect(() => {
    if (!gateway) return;
    let alive = true;
    // oxlint-disable-next-line react/set-state-in-effect -- consulta externa de gh
    setStatusError(null);
    // oxlint-disable-next-line react/set-state-in-effect -- consulta externa de gh
    setGh(null);
    void gateway
      .status()
      .then((status) => {
        if (alive) setGh(status);
        return undefined;
      })
      .catch((err: unknown) => {
        if (alive) setStatusError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [gateway]);

  useEffect(() => {
    if (!gateway || !repo || !gh?.installed || !gh.authenticated) {
      // oxlint-disable-next-line react/set-state-in-effect -- gh no disponible
      setIssues([]);
      setLoading(false);
      return;
    }
    const id = request.current + 1;
    request.current = id;
    let alive = true;
    // oxlint-disable-next-line react/set-state-in-effect -- recarga externa de issues
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void gateway
        .list(repo.path, { search: query.trim() || undefined, limit: DEFAULT_LIMIT })
        .then((result) => {
          if (!alive || request.current !== id) return;
          setIssues(result);
          setLoading(false);
          return undefined;
        })
        .catch((err: unknown) => {
          if (!alive || request.current !== id) return;
          setIssues([]);
          setError(errorText(err));
          setLoading(false);
        });
    }, searchDelayMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // `reloadKey` es un disparador externo (botón Reintentar): no se lee dentro.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- disparador externo
  }, [gateway, repo, query, gh?.installed, gh?.authenticated, searchDelayMs, reloadKey]);

  if (!gateway) return null;

  function toggleRepo(next: string) {
    setRepoId(next);
    setQuery("");
    setIssues([]);
    setError(null);
    if (value && value.repoId !== next) onChange(null);
  }

  return (
    <section className="feature-pick feature-issue" aria-labelledby="feature-issue-title">
      <div className="section-head">
        <h3 id="feature-issue-title">Issue de GitHub</h3>
        <span className="muted small-text">Opcional · solo lectura</span>
      </div>

      {repos.length === 0 ? (
        <p className="muted small-text">Elige al menos un repo para buscar sus issues.</p>
      ) : (
        <>
          {repos.length > 1 ? (
            <label className="field" htmlFor="feature-issue-repo">
              <span>Repositorio de los issues</span>
              <select
                id="feature-issue-repo"
                className="text-input"
                value={repoId}
                onChange={(event) => toggleRepo(event.target.value)}
              >
                {repos.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted small-text">
              Issues abiertos de <strong>{repos[0].name}</strong>.
            </p>
          )}

          <label className={`check ${!value ? "on" : ""}`}>
            <input
              type="radio"
              name="feature-issue"
              checked={!value}
              onChange={() => onChange(null)}
              aria-label="Sin issue"
            />
            <span className="check-main">
              <span className="check-title">Sin issue</span>
              <span className="check-sub">La feature se crea solo con el objetivo.</span>
            </span>
          </label>

          <label className="field" htmlFor="feature-issue-search">
            <span>Buscar issues</span>
            <input
              id="feature-issue-search"
              type="search"
              className="text-input"
              value={query}
              placeholder="Título, texto o etiqueta"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {statusError && (
            <p className="inline-error small-text" role="alert">
              No se pudo comprobar GitHub CLI: {statusError}
            </p>
          )}
          {!gh && !statusError && (
            <output className="muted small-text">Comprobando GitHub CLI…</output>
          )}
          {gh && (!gh.installed || !gh.authenticated) && (
            <div className="callout info">
              <p>{gh.message ?? "GitHub CLI no está disponible."}</p>
              <a href={gh.docsUrl} target="_blank" rel="noreferrer">
                Abrir la documentación de GitHub CLI
              </a>
            </div>
          )}

          {gh?.installed && gh.authenticated && (
            <>
              {loading && <output className="muted small-text">Buscando issues abiertos…</output>}
              {error && (
                <p className="inline-error small-text" role="alert">
                  No se pudieron cargar los issues: {error}
                  <button
                    type="button"
                    className="ghost small-text"
                    onClick={() => setReloadKey((current) => current + 1)}
                  >
                    Reintentar
                  </button>
                </p>
              )}
              {!loading && !error && issues.length === 0 && (
                <p className="muted small-text">No hay issues abiertos con esa búsqueda.</p>
              )}

              {issues.length > 0 && (
                <div className="check-list compact" aria-label="Issues abiertos">
                  {issues.map((issue) => {
                    const checked =
                      sameIssue(value?.issue ?? null, issue) && value?.repoId === repoId;
                    const labels =
                      issue.labels.length > 0 ? issue.labels.join(" · ") : "sin etiquetas";
                    return (
                      <label
                        key={`${issue.url}:${issue.number}`}
                        className={`check ${checked ? "on" : ""}`}
                      >
                        <input
                          type="radio"
                          name="feature-issue"
                          checked={checked}
                          onChange={() => onChange({ repoId, issue })}
                          aria-label={`#${issue.number} ${issue.title}`}
                        />
                        <span className="check-main">
                          <span className="check-title">
                            #{issue.number} {issue.title}
                          </span>
                          <span className="check-sub">
                            {labels} · {issue.author || "autor desconocido"}
                          </span>
                          {issue.body && (
                            <span className="check-sub">{shortIssueText(issue.body)}</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {value && (
                <p className="small-text">
                  Seleccionado: #{value.issue.number} {value.issue.title}
                  {value.issue.url && (
                    <>
                      {" · "}
                      <a href={value.issue.url} target="_blank" rel="noreferrer">
                        Abrir en GitHub
                      </a>
                    </>
                  )}
                  {value.issue.bodyTruncated ? " · cuerpo recortado" : ""}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
