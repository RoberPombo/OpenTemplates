/**
 * Lista de ficheros modificados y visor de su diff. Dos fuentes:
 * `session.diff` (lo que cambió el agente en la sesión) y `git.status`
 * (el árbol de trabajo completo, con stage y flujo de commit).
 *
 * El commit y el push viven aquí porque este es el panel natural de cambios;
 * las reglas (nunca force, nunca --no-verify, confirmar lo no preparado) están
 * en `domain/workspace/git.ts` y se repiten en Rust.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText } from "../../domain/shared";
import {
  changeStatusCode,
  changeStatusLabel,
  fileDirectory,
  fileDisplayName,
  isTurnEndEvent,
  parsePatch,
  summarizeChanges,
  type FileChange,
  type FileChangeSummary,
} from "../../domain/workspace/changes";
import {
  checkCommit,
  commitMessagePrompt,
  gitFileStatusCode,
  gitFileStatusLabel,
  pushTarget,
  statusTotals,
  type GitFileEntry,
  type GitPushTarget,
  type GitStatus,
} from "../../domain/workspace/git";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import type { ConfirmDialog } from "../../domain/repositories/Dialogs";
import type { GitGateway } from "../../domain/repositories/GitGateway";
import type { PullRequestGateway } from "../../domain/repositories/PullRequestGateway";
import type { Workspace } from "../../types";
import { PullRequestCard } from "./PullRequestCard";

type Props = {
  client: ChatServer;
  workspace: Workspace;
  sessionId: string | null;
  git: GitGateway;
  pullRequests: PullRequestGateway;
  confirm: ConfirmDialog;
};

type Source = "session" | "working";

const REFRESH_DEBOUNCE_MS = 400;

function Counters({
  files,
  additions,
  deletions,
}: {
  files: number;
  additions: number;
  deletions: number;
}) {
  return (
    <span className="changes-counters" aria-label="Resumen de cambios">
      <span>
        {files} {files === 1 ? "archivo" : "archivos"}
      </span>
      <span className="inspector-add">+{additions}</span>
      <span className="inspector-del">−{deletions}</span>
    </span>
  );
}

function ChangeRow({
  change,
  selected,
  onSelect,
}: {
  change: FileChangeSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = fileDisplayName(change.file);
  const directory = fileDirectory(change.file);
  return (
    <li>
      <button
        type="button"
        className={`change-row ${selected ? "active" : ""}`}
        aria-pressed={selected}
        title={change.file}
        onClick={onSelect}
      >
        <span
          className={`change-status ${change.status}`}
          aria-label={changeStatusLabel(change.status)}
        >
          {changeStatusCode(change.status)}
        </span>
        <span className="change-path">
          <span className="change-name">{name}</span>
          {directory && <span className="change-dir">{directory}</span>}
        </span>
        <span className="change-count">
          <span className="inspector-add">+{change.additions}</span>
          <span className="inspector-del">−{change.deletions}</span>
        </span>
      </button>
    </li>
  );
}

function GitChangeRow({
  file,
  selected,
  busy,
  onSelect,
  onToggle,
}: {
  file: GitFileEntry;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggle: (staged: boolean) => void;
}) {
  const name = fileDisplayName(file.path);
  const directory = fileDirectory(file.path);
  return (
    <li className={`git-change-item ${selected ? "active" : ""}`}>
      <input
        type="checkbox"
        className="stage-check"
        checked={file.staged}
        disabled={busy}
        aria-label={`${file.staged ? "Quitar del stage" : "Preparar"} ${file.path}`}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <button
        type="button"
        className={`change-row ${selected ? "active" : ""}`}
        aria-pressed={selected}
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        onClick={onSelect}
      >
        <span
          className={`change-status ${file.status}`}
          aria-label={gitFileStatusLabel(file.status)}
        >
          {gitFileStatusCode(file.status)}
        </span>
        <span className="change-path">
          <span className="change-name">{name}</span>
          <span className="change-dir">{file.oldPath ? `desde ${file.oldPath}` : directory}</span>
        </span>
        <span className="change-count">
          {file.binary ? (
            <span className="inspector-muted">bin</span>
          ) : (
            <>
              <span className="inspector-add">+{file.additions}</span>
              <span className="inspector-del">−{file.deletions}</span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}

function DiffView({ change }: { change: FileChange }) {
  const lines = useMemo(() => parsePatch(change.patch), [change.patch]);
  return (
    <div className="diff-view">
      <header className="diff-head" title={change.file}>
        <span className="change-name">{fileDisplayName(change.file)}</span>
        <span className={`change-status ${change.status}`}>{changeStatusLabel(change.status)}</span>
        <span className="change-count">
          <span className="inspector-add">+{change.additions}</span>
          <span className="inspector-del">−{change.deletions}</span>
        </span>
      </header>
      {lines.length === 0 ? (
        <p className="inspector-empty">El servidor no devolvió parche para este archivo.</p>
      ) : (
        <section className="diff-lines" aria-label={`Diff de ${change.file}`}>
          {lines.map((line, index) => (
            <div className={`diff-line ${line.kind}`} key={index}>
              <span className="diff-number" aria-hidden="true">
                {line.oldLine ?? ""}
              </span>
              <span className="diff-number" aria-hidden="true">
                {line.newLine ?? ""}
              </span>
              <code>{line.text || " "}</code>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function BranchLine({ status }: { status: GitStatus }) {
  return (
    <div className="git-branch-row">
      <span className="git-branch" title="Rama actual">
        ⑂ {status.branch ?? "HEAD desacoplado"}
      </span>
      <span className="git-upstream" title="Upstream">
        {status.upstream ? `→ ${status.upstream}` : "sin upstream"}
      </span>
      <span className="git-ahead" title="Commits por delante y por detrás del upstream">
        ↑{status.ahead} ↓{status.behind}
      </span>
    </div>
  );
}

export function ChangesPanel({ client, workspace, sessionId, git, pullRequests, confirm }: Props) {
  const location = useMemo(() => ({ directory: workspace.projectPath }), [workspace.projectPath]);
  const [source, setSource] = useState<Source>(sessionId ? "session" : "working");
  const [sessionChanges, setSessionChanges] = useState<FileChange[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [workingPatches, setWorkingPatches] = useState<FileChange[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [staging, setStaging] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [prRefreshKey, setPrRefreshKey] = useState(0);

  const loadSession = useCallback(async () => {
    if (!sessionId) {
      setSessionChanges([]);
      return;
    }
    const result = await client.session.diff({ sessionID: sessionId });
    setSessionChanges(result.data);
  }, [client, sessionId]);

  const loadWorking = useCallback(async () => {
    const status = await git.status(workspace.projectPath);
    setGitStatus(status);
    setWorkingPatches(null);
  }, [git, workspace.projectPath]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (source === "session") await loadSession();
      else await loadWorking();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [loadSession, loadWorking, source]);

  useEffect(() => {
    setSelected(null);
    void refresh();
  }, [refresh]);

  // Refresco discreto al terminar un turno: un solo disparo tras el último evento.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    let timer = 0;
    const abort = new AbortController();
    (async () => {
      try {
        for await (const event of client.event.subscribe({ signal: abort.signal })) {
          if (!isTurnEndEvent(event)) continue;
          const data = event.data as { sessionID?: unknown } | undefined;
          if (sessionId && typeof data?.sessionID === "string" && data.sessionID !== sessionId) {
            continue;
          }
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            void refreshRef.current();
          }, REFRESH_DEBOUNCE_MS);
        }
      } catch {
        // El cierre de la suscripción no es un error de la vista.
      }
    })();
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [client, sessionId]);

  const files: readonly FileChangeSummary[] = source === "session" ? sessionChanges : [];
  const sessionSummary = summarizeChanges(files);
  const totals = gitStatus ? statusTotals(gitStatus) : { files: 0, additions: 0, deletions: 0 };
  const selectedChange =
    source === "session"
      ? (sessionChanges.find((change) => change.file === selected) ?? null)
      : (workingPatches?.find((change) => change.file === selected) ?? null);

  async function selectWorking(change: GitFileEntry) {
    setSelected(change.path);
    if (workingPatches) return;
    setLoading(true);
    setError(null);
    try {
      const result = await client.vcs.diff({ location, mode: "working", untracked: "files" });
      setWorkingPatches(result.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  function chooseSource(next: Source) {
    setSource(next);
    setSelected(null);
    setError(null);
    setNotice(null);
  }

  async function toggleStage(file: GitFileEntry, staged: boolean) {
    setStaging(file.path);
    setError(null);
    setNotice(null);
    // Un renombrado ocupa dos rutas: prepara también el borrado de la antigua.
    const paths =
      file.status === "renamed" && file.oldPath ? [file.path, file.oldPath] : [file.path];
    try {
      const status = staged
        ? await git.stage(workspace.projectPath, paths)
        : await git.unstage(workspace.projectPath, paths);
      setGitStatus(status);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setStaging(null);
    }
  }

  async function suggestMessage() {
    setSuggesting(true);
    setError(null);
    setNotice(null);
    try {
      const diff = await git.stagedDiff(workspace.projectPath);
      if (!diff.trim()) {
        setError("No hay diff preparado para sugerir un mensaje.");
        return;
      }
      const response = await client.generate.text({ prompt: commitMessagePrompt(diff) });
      const text = response.text.trim();
      if (!text) {
        setError("El modelo no devolvió un mensaje de commit.");
        return;
      }
      setMessage(text);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSuggesting(false);
    }
  }

  async function commitChanges() {
    if (!gitStatus) return;
    const check = checkCommit(gitStatus, message);
    if (!check.ok) {
      if (!check.needsConfirmation) {
        setError(check.error);
        return;
      }
      const preview = (check.unstaged ?? []).slice(0, 8).join("\n");
      const extra = (check.unstaged ?? []).length > 8 ? "\n…" : "";
      const accepted = confirm.confirm(
        `${check.error}\n\n${preview}${extra}\n\n¿Commitear solo lo preparado?`,
      );
      if (!accepted) return;
      const confirmed = checkCommit(gitStatus, message, { confirmedUnstaged: true });
      if (!confirmed.ok) {
        setError(confirmed.error);
        return;
      }
    }

    setCommitting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await git.commit(workspace.projectPath, message.trim());
      setMessage("");
      setSelected(null);
      setNotice(`Commit ${result.oid.slice(0, 7)} creado.`);
      await loadWorking();
      setPrRefreshKey((key) => key + 1);
    } catch (err) {
      // Un hook que falla devuelve su salida; no se continúa ni se hace push.
      setError(errorText(err));
    } finally {
      setCommitting(false);
    }
  }

  async function publish(target: GitPushTarget) {
    setPushing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await git.push(workspace.projectPath, {
        branch: target.branch,
        setUpstream: target.setUpstream,
        remote: target.remote,
      });
      setNotice(
        result.upstream
          ? `Push completado a ${result.upstream}.`
          : `Push completado a ${result.remote}/${result.branch}.`,
      );
      await loadWorking();
      setPrRefreshKey((key) => key + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPushing(false);
    }
  }

  const pushResult = gitStatus ? pushTarget(gitStatus) : null;
  const pushAction = pushResult && !("error" in pushResult) ? pushResult : null;
  const pushError = pushResult && "error" in pushResult ? pushResult.error : null;
  const stagedCount = gitStatus?.files.filter((file) => file.staged).length ?? 0;

  return (
    <div className="changes-panel">
      <div className="changes-toolbar">
        <div className="changes-mode">
          <button
            type="button"
            aria-pressed={source === "session"}
            onClick={() => chooseSource("session")}
          >
            Sesión
          </button>
          <button
            type="button"
            aria-pressed={source === "working"}
            onClick={() => chooseSource("working")}
          >
            Working tree
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Actualizar cambios"
          aria-label="Actualizar cambios"
          onClick={() => void refresh()}
          disabled={loading}
        >
          ↻
        </button>
      </div>
      {error && <div className="inline-error small-text">{error}</div>}
      {notice && <output className="inline-notice small-text">{notice}</output>}

      {source === "session" ? (
        <>
          <div className="changes-summary">
            <Counters
              files={files.length}
              additions={sessionSummary.additions}
              deletions={sessionSummary.deletions}
            />
            {loading && <span className="inspector-muted">Actualizando…</span>}
          </div>
          {files.length === 0 && !loading ? (
            <p className="inspector-empty">
              {sessionId
                ? "El agente no ha cambiado archivos en esta sesión."
                : "Sin sesión activa; mira el árbol de trabajo."}
            </p>
          ) : (
            <ul className="change-list">
              {files.map((change) => (
                <ChangeRow
                  key={`${change.status}:${change.file}`}
                  change={change}
                  selected={selected === change.file}
                  onSelect={() => setSelected(change.file)}
                />
              ))}
            </ul>
          )}
          {selectedChange ? (
            <DiffView change={selectedChange} />
          ) : (
            selected && (
              <p className="inspector-empty">
                {loading ? "Cargando diff…" : "El servidor no devolvió parche para este archivo."}
              </p>
            )
          )}
        </>
      ) : (
        <div className="git-flow">
          {gitStatus && <BranchLine status={gitStatus} />}
          <div className="changes-summary">
            <Counters
              files={totals.files}
              additions={totals.additions}
              deletions={totals.deletions}
            />
            {gitStatus && (
              <span className="inspector-muted" title="Archivos preparados">
                {stagedCount} en stage
              </span>
            )}
            {loading && <span className="inspector-muted">Actualizando…</span>}
          </div>

          {!gitStatus || gitStatus.files.length === 0 ? (
            !loading && <p className="inspector-empty">El árbol de trabajo está limpio.</p>
          ) : (
            <ul className="change-list git-change-list">
              {gitStatus.files.map((file) => (
                <GitChangeRow
                  key={`${file.status}:${file.path}`}
                  file={file}
                  selected={selected === file.path}
                  busy={staging === file.path}
                  onSelect={() => void selectWorking(file)}
                  onToggle={(staged) => void toggleStage(file, staged)}
                />
              ))}
            </ul>
          )}

          {selectedChange && <DiffView change={selectedChange} />}

          <section className="commit-box">
            <label className="commit-label" htmlFor="commit-message">
              Mensaje del commit
            </label>
            <textarea
              id="commit-message"
              className="commit-message"
              value={message}
              placeholder="feat(panel): describe el cambio"
              rows={3}
              onChange={(event) => setMessage(event.target.value)}
            />
            <div className="commit-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => void suggestMessage()}
                disabled={suggesting || committing || stagedCount === 0}
                title={
                  stagedCount === 0
                    ? "Prepara algún archivo para generar el mensaje"
                    : "Generar mensaje desde el diff preparado"
                }
              >
                {suggesting ? "Sugiriendo…" : "Sugerir mensaje"}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void commitChanges()}
                disabled={committing || stagedCount === 0 || !message.trim()}
              >
                {committing ? "Commiteando…" : "Commit"}
              </button>
            </div>
          </section>

          <section className="push-box">
            <span className="inspector-muted">
              {gitStatus?.upstream
                ? `Upstream: ${gitStatus.upstream}`
                : "Sin upstream: publica la rama para poder abrir la PR."}
            </span>
            {pushError ? (
              <span className="small-text danger-text">{pushError}</span>
            ) : (
              pushAction && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void publish(pushAction)}
                  disabled={pushing || !gitStatus}
                >
                  {pushing ? "Publicando…" : pushAction.label}
                </button>
              )
            )}
          </section>

          <PullRequestCard
            pullRequests={pullRequests}
            git={git}
            client={client}
            projectPath={workspace.projectPath}
            branch={gitStatus?.branch ?? null}
            defaultBase={gitStatus?.mainBranch ?? "main"}
            sessionId={sessionId}
            refreshKey={prRefreshKey}
          />
        </div>
      )}
    </div>
  );
}
