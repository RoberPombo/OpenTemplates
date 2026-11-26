/**
 * Tarjeta de pull request dentro del panel de cambios. Usa `gh` a través del
 * puerto: estado de la PR, checks, revisiones y creación con borrador. Si `gh`
 * no está instalado o no hay sesión, lo dice y enlaza a la documentación.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText } from "../../domain/shared";
import {
  buildReviewPrompt,
  checksSummary,
  draftPullRequest,
  failedChecks,
  prStateLabel,
  type GhStatus,
  type PullRequestCheck,
  type PullRequestInfo,
} from "../../domain/workspace/pullRequest";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import type { GitGateway } from "../../domain/repositories/GitGateway";
import type { PullRequestGateway } from "../../domain/repositories/PullRequestGateway";

type Props = {
  pullRequests: PullRequestGateway;
  git: GitGateway;
  client: ChatServer;
  projectPath: string;
  branch: string | null;
  defaultBase: string;
  sessionId: string | null;
  /** Cambia al commitear o publicar: recarga la PR y sus checks. */
  refreshKey: number;
};

function shortText(value: string, limit = 160): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export function PullRequestCard({
  pullRequests,
  git,
  client,
  projectPath,
  branch,
  defaultBase,
  sessionId,
  refreshKey,
}: Props) {
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [pr, setPr] = useState<PullRequestInfo | null>(null);
  const [checks, setChecks] = useState<PullRequestCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [base, setBase] = useState(defaultBase);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await pullRequests.status();
      setGh(status);
      if (!status.installed || !status.authenticated) {
        setPr(null);
        setChecks([]);
        return;
      }
      const info = await pullRequests.view(projectPath);
      setPr(info);
      if (!info) {
        setChecks([]);
        return;
      }
      setChecks(await pullRequests.checks(projectPath));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [pullRequests, projectPath]);

  useEffect(() => {
    // `load` consulta gh (sistema externo) y refleja el estado de carga; el
    // setState ocurre antes del primer await a propósito.
    // oxlint-disable-next-line react/set-state-in-effect -- recarga externa de la PR
    void load();
    // `refreshKey` es un disparador externo (commit o publicación): no se lee
    // dentro de `load`, pero debe volver a lanzarla.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- disparador externo
  }, [load, refreshKey]);

  const failed = failedChecks(checks);
  const summary = checksSummary(checks);
  const prompt = useMemo(
    () => (pr ? buildReviewPrompt({ pullRequest: pr, checks }) : ""),
    [pr, checks],
  );

  async function openForm() {
    setFormOpen(true);
    setError(null);
    setNotice(null);
    setBase(defaultBase);
    setTitle("");
    setBody("");
    setDrafting(true);
    try {
      const commits = await git.commits(projectPath, defaultBase);
      const draft = draftPullRequest({
        branch: branch ?? "",
        base: defaultBase,
        commits,
      });
      setTitle(draft.title);
      setBody(draft.body);
    } catch (err) {
      // Sin commits legibles la PR se puede crear igualmente a mano.
      setError(errorText(err));
    } finally {
      setDrafting(false);
    }
  }

  async function createPullRequest() {
    if (!branch) {
      setError("La rama está desacoplada; cambia a una rama antes de abrir la PR.");
      return;
    }
    if (!title.trim()) {
      setError("El título de la pull request no puede estar vacío.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const result = await pullRequests.create(projectPath, {
        base: base.trim() || defaultBase,
        head: branch,
        title: title.trim(),
        body,
      });
      setFormOpen(false);
      setNotice(`Pull request creada: ${result.url}`);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function sendToAgent() {
    if (!sessionId) {
      setError("No hay una sesión activa; abre o crea una para enviar la revisión.");
      return;
    }
    if (!prompt) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      await client.session.prompt({ sessionID: sessionId, text: prompt });
      setNotice("Revisión enviada a la sesión activa.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="pr-card" aria-label="Pull request">
      <header className="pr-head">
        <strong>Pull request</strong>
        <button
          type="button"
          className="icon-button"
          title="Actualizar pull request"
          aria-label="Actualizar pull request"
          onClick={() => void load()}
          disabled={loading}
        >
          ↻
        </button>
      </header>

      {error && <div className="inline-error small-text">{error}</div>}
      {notice && <output className="inline-notice small-text">{notice}</output>}

      {gh && (!gh.installed || !gh.authenticated) ? (
        <div className="pr-notice">
          <p>{gh.message ?? "GitHub CLI no está disponible."}</p>
          <a href={gh.docsUrl} target="_blank" rel="noreferrer">
            Abrir la documentación de GitHub CLI
          </a>
        </div>
      ) : loading && !gh ? (
        <p className="inspector-muted small-text">Comprobando GitHub CLI…</p>
      ) : pr ? (
        <>
          <div className="pr-title-row">
            <span className="pr-number">#{pr.number}</span>
            <span className={`pr-state ${pr.state.toLowerCase()}`}>{prStateLabel(pr.state)}</span>
            {pr.isDraft && <span className="pr-state draft">borrador</span>}
            <span className="pr-title" title={pr.title}>
              {pr.title}
            </span>
          </div>
          <div className="pr-links">
            <a href={pr.url} target="_blank" rel="noreferrer">
              Abrir en GitHub
            </a>
            <span className="inspector-muted small-text">
              {pr.headBranch} → {pr.baseBranch}
            </span>
          </div>

          <div className="pr-checks">
            {checks.length === 0 ? (
              <span className="inspector-muted small-text">La PR todavía no tiene checks.</span>
            ) : (
              <>
                <span className="pr-check-summary">
                  {summary.passed} en verde · {summary.failed} fallidos · {summary.pending}{" "}
                  pendientes
                </span>
                {failed.length > 0 && (
                  <ul className="pr-failed-list" aria-label="Checks fallidos">
                    {failed.map((check) => (
                      <li key={`${check.workflow ?? ""}:${check.name}`}>
                        {check.url ? (
                          <a href={check.url} target="_blank" rel="noreferrer">
                            {check.name}
                          </a>
                        ) : (
                          check.name
                        )}
                        <span className="inspector-muted"> · {check.state}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {(pr.reviews.length > 0 || pr.comments.length > 0) && (
            <div className="pr-feedback">
              <span className="inspector-muted small-text">
                {pr.reviews.length} revisión(es) · {pr.comments.length} comentario(s)
                {pr.reviewDecision ? ` · ${pr.reviewDecision.toLowerCase()}` : ""}
              </span>
              {pr.reviews
                .filter((review) => review.body.trim())
                .slice(0, 3)
                .map((review) => (
                  <p className="pr-feedback-line" key={`${review.author}:${review.submittedAt}`}>
                    <strong>{review.author}</strong> ({review.state}): {shortText(review.body)}
                  </p>
                ))}
              {pr.comments
                .filter((comment) => comment.body.trim())
                .slice(0, 3)
                .map((comment) => (
                  <p className="pr-feedback-line" key={`${comment.author}:${comment.createdAt}`}>
                    <strong>{comment.author}</strong>: {shortText(comment.body)}
                  </p>
                ))}
            </div>
          )}

          <div className="pr-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => void sendToAgent()}
              disabled={!prompt || !sessionId || sending}
              title={
                !sessionId
                  ? "No hay sesión activa"
                  : !prompt
                    ? "No hay checks fallidos ni comentarios que enviar"
                    : "Enviar los problemas al agente de la sesión activa"
              }
            >
              {sending ? "Enviando…" : "Enviar al agente"}
            </button>
          </div>
        </>
      ) : (
        <div className="pr-create">
          {!formOpen ? (
            <>
              <p className="inspector-muted small-text">
                La rama {branch ?? "desacoplada"} todavía no tiene pull request.
              </p>
              <button
                type="button"
                className="ghost"
                onClick={() => void openForm()}
                disabled={!branch || loading}
              >
                Crear pull request
              </button>
            </>
          ) : (
            <>
              <label className="pr-field">
                <span>Base</span>
                <input
                  value={base}
                  onChange={(event) => setBase(event.target.value)}
                  placeholder={defaultBase}
                />
              </label>
              <label className="pr-field">
                <span>Título</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={drafting ? "Generando borrador…" : "Título de la pull request"}
                />
              </label>
              <label className="pr-field">
                <span>Cuerpo</span>
                <textarea
                  rows={7}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={
                    drafting ? "Generando borrador desde los commits…" : "Cuerpo de la PR"
                  }
                />
              </label>
              <div className="pr-form-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void createPullRequest()}
                  disabled={creating || drafting || !title.trim()}
                >
                  {creating ? "Creando…" : "Crear pull request"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setFormOpen(false)}
                  disabled={creating}
                >
                  Cancelar
                </button>
              </div>
              {drafting && (
                <p className="inspector-muted small-text">
                  Generando el borrador desde los commits de la rama…
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
