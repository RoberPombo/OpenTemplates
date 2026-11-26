/**
 * Sesión de chat de un workspace: id activo, historial de mensajes y lista de
 * sesiones (carga, renombrado, borrado, apertura externa y conversación nueva).
 *
 * Toda la persistencia de sesión (`prefKeys.session`) vive aquí. El streaming y
 * el catálogo siguen en `useChat`: este hook solo avisa por callbacks estables,
 * de modo que `reload` y `refreshSessions` no cambian entre renders.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompositionRoot } from "../../CompositionRoot";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import { prefKeys } from "../../domain/repositories/Preferences";
import type { Workspace } from "../../types";
import { errorTextOr } from "../../domain/shared";
import { toChatMessages, type ChatMessage } from "../../domain/chat/messages";
import { parseModelRef } from "../../domain/chat/selection";
import {
  sortSessionsByRecent,
  toSessionSummaries,
  type SessionSummary,
} from "../../domain/chat/sessions";

export type UseChatSessionsInput = {
  client: ChatServer;
  workspace: Workspace;
  root: CompositionRoot;
  /** Ámbito de sesiones (huella del contexto/perfil); separa historiales. */
  scope?: string;
  /** Sesión externa que debe abrirse (corridas de una carrera). */
  openSessionId?: string | null;
  onSessionOpened?: () => void;
  onSessionChange?: (sessionId: string | null) => void;
  /** Sesión creada por la app antes de montar el chat (coordinador). */
  initialSessionId?: string | null;
  /** Aviso de error para la vista; el estado de streaming vive en `useChat`. */
  onError: (message: string) => void;
  /** Reinicia el estado de streaming al cambiar o limpiar la sesión. */
  onSessionReset: () => void;
};

export function useChatSessions({
  client,
  workspace,
  root,
  scope,
  openSessionId,
  onSessionOpened,
  onSessionChange,
  initialSessionId,
  onError,
  onSessionReset,
}: UseChatSessionsInput) {
  const storageKey = prefKeys.session(workspace.id, scope);

  const [sessionId, setSessionId] = useState<string | null>(
    () => initialSessionId ?? root.preferences.get(storageKey),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsNotice, setSessionsNotice] = useState<string | null>(null);
  /** Sesión cuyos mensajes ya están cargados (puerta de reanudación del objetivo). */
  const [loadedSession, setLoadedSession] = useState<string | null>(null);
  const sessionsRef = useRef<SessionSummary[]>([]);
  // El modelo del perfil se pasa al crear la sesión; no se fija en la config.
  const workspaceModelRef = useMemo(() => parseModelRef(workspace.model), [workspace.model]);

  useEffect(() => {
    onSessionChange?.(sessionId);
  }, [onSessionChange, sessionId]);

  const reload = useCallback(async () => {
    if (!sessionId) return;
    try {
      const response = await client.message.list({
        sessionID: sessionId,
        limit: 200,
        order: "asc",
      });
      setMessages(toChatMessages(response.data));
      setLoadedSession(sessionId);
    } catch (err) {
      root.preferences.remove(storageKey);
      setSessionId(null);
      setMessages([]);
      setLoadedSession(null);
      onError(errorTextOr(err));
    }
  }, [client, sessionId, storageKey, root, onError]);

  const refreshSessions = useCallback(async () => {
    try {
      const response = await client.session.list({
        directory: workspace.projectPath,
        limit: 100,
      });
      setSessions(sortSessionsByRecent(toSessionSummaries(response.data)));
      setSessionsError(null);
    } catch (err) {
      setSessionsError(errorTextOr(err));
    }
  }, [client, workspace.projectPath]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const selectSession = useCallback(
    (id: string) => {
      if (id === sessionId) return;
      setSessionsNotice(null);
      root.preferences.set(storageKey, id);
      setSessionId(id);
      setMessages([]);
      onSessionReset();
    },
    [sessionId, storageKey, root, onSessionReset],
  );

  const openedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openSessionId) {
      openedSessionRef.current = null;
      return;
    }
    if (openedSessionRef.current === openSessionId) return;
    openedSessionRef.current = openSessionId;
    if (openSessionId !== sessionId) selectSession(openSessionId);
    onSessionOpened?.();
  }, [openSessionId, sessionId, selectSession, onSessionOpened]);

  const renameSession = useCallback(
    async (id: string, title: string) => {
      const next = title.trim();
      if (!next) return;
      try {
        await client.session.update({ sessionID: id, title: next });
        await refreshSessions();
      } catch (err) {
        setSessionsError(errorTextOr(err));
      }
    },
    [client, refreshSessions],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await client.session.remove({ sessionID: id });
        if (id === sessionId) {
          root.preferences.remove(storageKey);
          setSessionId(null);
          setMessages([]);
          onSessionReset();
        }
        await refreshSessions();
      } catch (err) {
        setSessionsError(errorTextOr(err));
      }
    },
    [client, sessionId, storageKey, root, onSessionReset, refreshSessions],
  );

  const newConversation = useCallback(() => {
    root.preferences.remove(storageKey);
    setSessionId(null);
    setMessages([]);
    setSessionsNotice(null);
    onSessionReset();
  }, [storageKey, root, onSessionReset]);

  useEffect(() => {
    setSessionId(initialSessionId ?? root.preferences.get(storageKey));
    setMessages([]);
    setLoadedSession(null);
  }, [storageKey, initialSessionId, root]);

  useEffect(() => {
    setLoadedSession(null);
    if (!sessionId) {
      setMessages([]);
      return;
    }
    void reload();
  }, [sessionId, reload]);

  useEffect(() => {
    if (sessionId || initialSessionId) return;
    let alive = true;
    (async () => {
      try {
        const session = await client.session.create({
          location: { directory: workspace.projectPath },
          title: `Chat · ${workspace.name}`,
          ...(workspaceModelRef ? { model: workspaceModelRef } : {}),
        });
        if (!alive) return;
        setSessionId(session.id);
        root.preferences.set(storageKey, session.id);
        void refreshSessions();
      } catch (err) {
        if (alive) onError(errorTextOr(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    client,
    sessionId,
    initialSessionId,
    storageKey,
    workspace.name,
    workspace.projectPath,
    workspaceModelRef,
    root,
    refreshSessions,
    onError,
  ]);

  return {
    sessionId,
    messages,
    setMessages,
    sessions,
    sessionsRef,
    sessionsError,
    sessionsNotice,
    setSessionsError,
    setSessionsNotice,
    loadedSession,
    reload,
    refreshSessions,
    selectSession,
    renameSession,
    deleteSession,
    newConversation,
  };
}
