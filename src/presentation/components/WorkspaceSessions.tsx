/**
 * Sesiones del workspace dentro de la barra lateral: la lista se despliega
 * bajo el workspace seleccionado y desaparece al plegarlo. Mantiene su propio
 * historial (se recarga con los eventos del servidor) y reutiliza la
 * transferencia de sesiones del chat (exportar, importar y duplicar).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerInfo, Workspace } from "../../types";
import { errorTextOr, formatRelativeTime } from "../../domain/shared";
import { parseModelRef } from "../../domain/chat/selection";
import {
  eventTouchesSessionList,
  sortSessionsByRecent,
  toSessionSummaries,
  type SessionSummary,
} from "../../domain/chat/sessions";
import { useAppContext } from "../context/AppContext";
import { useChatTransfer } from "../hooks/useChatTransfer";
import { Button, TextInput } from "./ui";

type Props = {
  workspace: Workspace;
  server: ServerInfo;
  /** Sesión abierta ahora mismo en el chat del workspace. */
  activeSessionId?: string | null;
  /** Abre (o crea) una sesión en el workspace; el contenedor la enfoca. */
  onOpenSession: (workspaceId: string, sessionId: string) => void;
};

export function WorkspaceSessions({ workspace, server, activeSessionId, onOpenSession }: Props) {
  const root = useAppContext();
  // oxlint-disable react-hooks/exhaustive-deps -- gateway estable por URL/contraseña
  const client = useMemo(
    () => root.provideChatGateway(server),
    [root, server.baseUrl, server.password],
  );
  // oxlint-enable react-hooks/exhaustive-deps

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const sessionsRef = useRef<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const workspaceModelRef = useMemo(() => parseModelRef(workspace.model), [workspace.model]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const refreshSessions = useCallback(async () => {
    try {
      const response = await client.session.list({
        directory: workspace.projectPath,
        limit: 100,
      });
      setSessions(sortSessionsByRecent(toSessionSummaries(response.data)));
      setError(null);
    } catch (err) {
      setError(errorTextOr(err));
    } finally {
      setLoading(false);
    }
  }, [client, workspace.projectPath]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- carga asíncrona de la lista
    setLoading(true);
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    let alive = true;
    const abort = new AbortController();
    (async () => {
      try {
        for await (const event of client.event.subscribe({ signal: abort.signal })) {
          if (!alive) break;
          if (eventTouchesSessionList(event)) void refreshSessions();
        }
      } catch {
        // La lista se vuelve a pedir al desplegar el workspace.
      }
    })();
    return () => {
      alive = false;
      abort.abort();
    };
  }, [client, refreshSessions]);

  const openSession = useCallback(
    (id: string) => {
      setError(null);
      setNotice(null);
      onOpenSession(workspace.id, id);
    },
    [onOpenSession, workspace.id],
  );

  const { exportSession, importSession, forkSession } = useChatTransfer({
    client,
    root,
    workspace,
    sessionsRef,
    refreshSessions,
    selectSession: openSession,
    busy: false,
    setSessionsError: setError,
    setSessionsNotice: setNotice,
  });

  const createSession = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const session = await client.session.create({
        location: { directory: workspace.projectPath },
        title: `Chat · ${workspace.name}`,
        ...(workspaceModelRef ? { model: workspaceModelRef } : {}),
      });
      await refreshSessions();
      openSession(session.id);
    } catch (err) {
      setError(errorTextOr(err));
    } finally {
      setCreating(false);
    }
  }, [
    client,
    creating,
    openSession,
    refreshSessions,
    workspace.name,
    workspace.projectPath,
    workspaceModelRef,
  ]);

  const deleteSession = useCallback(
    async (session: SessionSummary) => {
      if (!root.confirm.confirm(`¿Eliminar la sesión «${session.title}»? No se puede deshacer.`)) {
        return;
      }
      setError(null);
      setNotice(null);
      try {
        await client.session.remove({ sessionID: session.id });
        await refreshSessions();
        // Si era la sesión abierta, el chat necesita otra para no quedarse en una
        // sesión borrada: se crea y se abre una nueva.
        if (session.id === activeSessionId) void createSession();
      } catch (err) {
        setError(errorTextOr(err));
      }
    },
    [activeSessionId, client, createSession, refreshSessions, root],
  );

  function startRename(session: SessionSummary) {
    setRenamingId(session.id);
    setDraft(session.title);
  }

  function commitRename() {
    const id = renamingId;
    const title = draft.trim();
    setRenamingId(null);
    if (!id || !title) return;
    void (async () => {
      try {
        await client.session.update({ sessionID: id, title });
        await refreshSessions();
      } catch (err) {
        setError(errorTextOr(err));
      }
    })();
  }

  return (
    <section className="workspace-sessions" aria-label={`Sesiones de ${workspace.name}`}>
      <div className="workspace-sessions-head">
        <span>Sesiones</span>
        <span className="workspace-sessions-count">{sessions.length}</span>
        <Button
          variant="icon"
          size="small"
          title="Importar sesión"
          aria-label={`Importar sesión en ${workspace.name}`}
          onClick={() => void importSession()}
        >
          ⤒
        </Button>
        <Button
          variant="icon"
          size="small"
          title="Nueva sesión"
          aria-label={`Nueva sesión en ${workspace.name}`}
          disabled={creating}
          onClick={() => void createSession()}
        >
          +
        </Button>
      </div>

      {error && <p className="inline-error workspace-sessions-message">{error}</p>}
      {notice && <p className="workspace-sessions-notice">{notice}</p>}

      <ul className="session-list workspace-session-list">
        {sessions.map((session) => (
          <li
            key={session.id}
            className={`session-row ${session.id === activeSessionId ? "active" : ""}`}
          >
            {renamingId === session.id ? (
              <TextInput
                className="session-rename"
                autoFocus
                value={draft}
                aria-label="Título de la sesión"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setRenamingId(null);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="session-open"
                title={`${session.title} · doble clic para renombrar`}
                onClick={() => openSession(session.id)}
                onDoubleClick={() => startRename(session)}
              >
                <span className="session-title">{session.title}</span>
                <span className="session-meta">
                  {formatRelativeTime(session.updated)}
                  {session.cost > 0 ? ` · $${session.cost.toFixed(3)}` : ""}
                </span>
              </button>
            )}
            <div className="session-actions">
              <Button
                variant="icon"
                size="small"
                title="Duplicar sesión"
                aria-label={`Duplicar ${session.title}`}
                onClick={() => void forkSession(session.id)}
              >
                ⧉
              </Button>
              <Button
                variant="icon"
                size="small"
                title="Exportar sesión (Alt+clic sin sanear)"
                aria-label={`Exportar ${session.title}`}
                onClick={(event) => void exportSession(session.id, !event.altKey)}
              >
                ⤓
              </Button>
              <Button
                variant="icon"
                size="small"
                className="danger-text"
                title="Eliminar sesión"
                aria-label={`Eliminar ${session.title}`}
                onClick={() => void deleteSession(session)}
              >
                ×
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {!loading && sessions.length === 0 && (
        <p className="muted small-text workspace-sessions-empty">Aún no hay sesiones.</p>
      )}
    </section>
  );
}
