/**
 * Lista de ficheros modificados y visor de su diff. Dos fuentes:
 * `session.diff` (lo que cambió el agente en la sesión) y `vcs.status`/`vcs.diff`
 * (el árbol de trabajo completo). El estrechado llega hecho del adaptador; aquí
 * solo queda el estado de la vista.
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
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import type { Workspace } from "../../types";
type Props = {
  client: ChatServer;
  workspace: Workspace;
  sessionId: string | null;
};
type Source = "session" | "working";
const REFRESH_DEBOUNCE_MS = 400;
function Counters({ files }: { files: readonly FileChangeSummary[] }) {
  const summary = summarizeChanges(files);
  return (
    <span className="changes-counters" aria-label="Resumen de cambios">
      <span>
        {summary.files} {summary.files === 1 ? "archivo" : "archivos"}
      </span>
      <span className="inspector-add">+{summary.additions}</span>
      <span className="inspector-del">−{summary.deletions}</span>
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
export function ChangesPanel({ client, workspace, sessionId }: Props) {
  const location = useMemo(() => ({ directory: workspace.projectPath }), [workspace.projectPath]);
  const [source, setSource] = useState<Source>(sessionId ? "session" : "working");
  const [sessionChanges, setSessionChanges] = useState<FileChange[]>([]);
  const [workingFiles, setWorkingFiles] = useState<FileChangeSummary[]>([]);
  const [workingPatches, setWorkingPatches] = useState<FileChange[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadSession = useCallback(async () => {
    if (!sessionId) {
      setSessionChanges([]);
      return;
    }
    const result = await client.session.diff({ sessionID: sessionId });
    setSessionChanges(result.data);
  }, [client, sessionId]);
  const loadWorking = useCallback(async () => {
    const result = await client.vcs.status({ location });
    setWorkingFiles(result.data);
    setWorkingPatches(null);
  }, [client, location]);
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
  const files: readonly FileChangeSummary[] = source === "session" ? sessionChanges : workingFiles;
  const selectedChange =
    source === "session"
      ? (sessionChanges.find((change) => change.file === selected) ?? null)
      : (workingPatches?.find((change) => change.file === selected) ?? null);
  async function selectWorking(change: FileChangeSummary) {
    setSelected(change.file);
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
  }
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
      <div className="changes-summary">
        <Counters files={files} />
        {loading && <span className="inspector-muted">Actualizando…</span>}
      </div>
      {files.length === 0 && !loading ? (
        <p className="inspector-empty">
          {source === "session"
            ? sessionId
              ? "El agente no ha cambiado archivos en esta sesión."
              : "Sin sesión activa; mira el árbol de trabajo."
            : "El árbol de trabajo está limpio."}
        </p>
      ) : (
        <ul className="change-list">
          {files.map((change) => (
            <ChangeRow
              key={`${change.status}:${change.file}`}
              change={change}
              selected={selected === change.file}
              onSelect={() => {
                if (source === "session") setSelected(change.file);
                else void selectWorking(change);
              }}
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
    </div>
  );
}
