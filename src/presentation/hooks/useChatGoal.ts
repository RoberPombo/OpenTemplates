/**
 * Objetivo de sesión: estado persistido, evaluación al cerrar cada turno y
 * acciones del diálogo (guardar, pausar, reanudar y quitar).
 *
 * La política vive en `domain/chat/goals`; este hook solo orquesta I/O,
 * preferencias y efectos de React.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
} from "react";
import type { CompositionRoot } from "../../CompositionRoot";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import { prefKeys } from "../../domain/repositories/Preferences";
import type { Workspace } from "../../types";
import { errorTextOr } from "../../domain/shared";
import type { ChatMessage } from "../../domain/chat/messages";
import type { SessionSummary } from "../../domain/chat/sessions";
import type { ChatStreamAction } from "../../domain/chat/stream";
import type { CatalogModel } from "../../domain/chat/selection";
import { notificationsEnabled } from "../../domain/chat/notifications";
import {
  advanceGoal,
  conversationFingerprint,
  createGoal,
  describeGoalStop,
  editGoal,
  goalContinuation,
  goalDecisionRequest,
  goalLimitReason,
  isGoalActive,
  parseGoal,
  pauseGoal,
  pickDecisionModel,
  resumeGoal,
  serializeGoal,
  type Goal,
  type GoalDecisionResult,
  type GoalStopReason,
} from "../../domain/chat/goals";

type TurnEnd = { seq: number; failed: boolean };

export type UseChatGoalInput = {
  client: ChatServer;
  sessionId: string | null;
  workspace: Workspace;
  root: CompositionRoot;
  /** Sesiones del panel: marca las que tienen un objetivo activo. */
  sessions: SessionSummary[];
  /** Mensajes actuales de la sesión; el objetivo los lee al evaluar. */
  messages: ChatMessage[];
  sessionsRef: RefObject<SessionSummary[]>;
  busy: boolean;
  permissionsCount: number;
  formsCount: number;
  dispatch: Dispatch<ChatStreamAction>;
};

export function useChatGoal({
  client,
  sessionId,
  workspace,
  root,
  sessions,
  messages,
  sessionsRef,
  busy,
  permissionsCount,
  formsCount,
  dispatch,
}: UseChatGoalInput) {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [decisionModels, setDecisionModels] = useState<CatalogModel[]>([]);
  const [turnEnd, setTurnEnd] = useState<TurnEnd | null>(null);
  const [loadedSession, setLoadedSession] = useState<string | null>(null);

  const goalRef = useRef<Goal | null>(null);
  const goalGenerationRef = useRef(0);
  const checkingGoalRef = useRef(false);
  const processedTurnRef = useRef(0);
  const pendingResumeRef = useRef(false);
  const initialMountRef = useRef(true);
  const turnSeqRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);

  const decisionModel = useMemo(() => pickDecisionModel(decisionModels), [decisionModels]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await client.model.list({
          location: { directory: workspace.projectPath },
          types: ["decision"],
        });
        if (alive) setDecisionModels(response.data);
      } catch {
        if (alive) setDecisionModels([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, workspace.projectPath]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    goalRef.current = goal;
  }, [goal]);

  // Carga el objetivo de la sesión activa. La persistencia la hacen las
  // acciones (guardar, pausar, reanudar, quitar y cada chequeo).
  useEffect(() => {
    goalGenerationRef.current += 1;
    checkingGoalRef.current = false;
    processedTurnRef.current = 0;
    setGoalError(null);
    setTurnEnd(null);
    setLoadedSession(null);
    const stored = sessionId
      ? parseGoal(root.preferences.get(prefKeys.goal(workspace.id, sessionId)))
      : null;
    setGoal(stored);
    // Solo al abrir la app: cambiar de sesión no dispara el bucle solo.
    pendingResumeRef.current = initialMountRef.current && stored?.status === "active";
    initialMountRef.current = false;
  }, [sessionId, workspace.id, root]);

  /** Marca el cierre de un turno; el chequeo lo consume una sola vez. */
  const onTurnEnd = useCallback((failed: boolean) => {
    turnSeqRef.current += 1;
    setTurnEnd({ seq: turnSeqRef.current, failed });
  }, []);

  /** Marca la sesión cuyos mensajes ya están cargados (puerta de reanudación). */
  const markSessionLoaded = useCallback((id: string | null) => setLoadedSession(id), []);

  /** Sesiones del panel con objetivo activo (para marcarlas). */
  const goalSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      const active =
        session.id === sessionId
          ? isGoalActive(goal)
          : isGoalActive(parseGoal(root.preferences.get(prefKeys.goal(workspace.id, session.id))));
      if (active) ids.add(session.id);
    }
    return ids;
  }, [sessions, sessionId, goal, workspace.id, root]);

  const commitGoal = useCallback(
    (next: Goal | null) => {
      goalGenerationRef.current += 1;
      goalRef.current = next;
      setGoal(next);
      if (!sessionId) return;
      const key = prefKeys.goal(workspace.id, sessionId);
      if (next) root.preferences.set(key, serializeGoal(next));
      else root.preferences.remove(key);
    },
    [sessionId, workspace.id, root],
  );

  const notifyGoal = useCallback(
    (stopped: Goal, reason: GoalStopReason) => {
      if (!notificationsEnabled(root.preferences.get(prefKeys.notifications))) return;
      const notice = describeGoalStop(stopped, reason);
      const title = sessionsRef.current.find((item) => item.id === sessionId)?.title;
      void root.notifications.notify({
        title: `${workspace.name} · ${notice.title}`,
        body: title ? `${title} · ${notice.body}` : notice.body,
        workspaceId: workspace.id,
      });
    },
    [root, workspace.id, workspace.name, sessionId, sessionsRef],
  );

  /**
   * Cierra un turno del objetivo: pide la decisión al evaluador y continúa,
   * espera o para. Todas las guardas viven en `advanceGoal`; aquí solo se
   * resuelven las peticiones y el envío del prompt.
   */
  const runGoalCheck = useCallback(
    async (turnFailed: boolean) => {
      const current = goalRef.current;
      if (!current || current.status !== "active" || !sessionId || checkingGoalRef.current) {
        return;
      }
      checkingGoalRef.current = true;
      pendingResumeRef.current = false;
      const generation = goalGenerationRef.current;
      try {
        const [permissionResponse, formResponse, info] = await Promise.all([
          client.permission.list({ sessionID: sessionId }),
          client.form.list({ sessionID: sessionId }),
          client.session.get({ sessionID: sessionId }).catch(() => null),
        ]);
        if (generation !== goalGenerationRef.current) return;
        const pendingRequest = permissionResponse.data.length > 0 || formResponse.data.length > 0;
        let decision: GoalDecisionResult | null = null;
        if (!pendingRequest && !turnFailed) {
          if (!decisionModel) {
            setGoalError("Este workspace no tiene un modelo de decisión disponible.");
            commitGoal(pauseGoal(current, Date.now()));
            notifyGoal(current, "no-decision");
            return;
          }
          const response = await client.generate.decisions(
            goalDecisionRequest(current, messagesRef.current, decisionModel),
          );
          if (generation !== goalGenerationRef.current) return;
          decision = response.data;
          setGoalError(decision.error);
        }
        const step = advanceGoal(current, {
          decision,
          sessionCost: info?.cost ?? 0,
          pendingRequest,
          userStopped: false,
          turnFailed,
          fingerprint: conversationFingerprint(messagesRef.current),
          now: Date.now(),
        });
        commitGoal(step.goal);
        if (step.action.kind === "continue") {
          if (goalRef.current?.status !== "active") return;
          await client.session.prompt({ sessionID: sessionId, text: step.action.prompt });
          dispatch({ kind: "executionStarted" });
        } else if (step.action.kind === "stop") {
          notifyGoal(step.goal, step.action.reason);
        }
      } catch (err) {
        if (generation === goalGenerationRef.current) {
          setGoalError(errorTextOr(err));
          const latest = goalRef.current ?? current;
          commitGoal(pauseGoal(latest, Date.now()));
          notifyGoal(latest, "no-decision");
        }
      } finally {
        checkingGoalRef.current = false;
      }
    },
    [client, sessionId, decisionModel, commitGoal, notifyGoal, messagesRef, dispatch],
  );

  // Un turno recién cerrado se evalúa una sola vez aunque lleguen varios eventos.
  useEffect(() => {
    if (!turnEnd || !sessionId) return;
    if (processedTurnRef.current === turnEnd.seq) return;
    processedTurnRef.current = turnEnd.seq;
    if (!isGoalActive(goalRef.current)) return;
    void runGoalCheck(turnEnd.failed);
  }, [turnEnd, sessionId, runGoalCheck]);

  // Reanudación al abrir la app: solo si el objetivo estaba activo y la sesión
  // no está ocupada ni esperando un permiso o una pregunta.
  useEffect(() => {
    if (!pendingResumeRef.current) return;
    if (!sessionId || loadedSession !== sessionId) return;
    if (!goal || goal.status !== "active") return;
    if (busy || permissionsCount > 0 || formsCount > 0) return;
    if (!decisionModel) {
      pendingResumeRef.current = false;
      setGoalError("Este workspace no tiene un modelo de decisión disponible.");
      commitGoal(pauseGoal(goal, Date.now()));
      return;
    }
    const limit = goalLimitReason(goal);
    if (limit) {
      pendingResumeRef.current = false;
      commitGoal({ ...goal, status: "exhausted", updatedAt: Date.now() });
      notifyGoal(goal, limit);
      return;
    }
    const generation = goalGenerationRef.current;
    void (async () => {
      const [permissionResponse, formResponse] = await Promise.all([
        client.permission.list({ sessionID: sessionId }),
        client.form.list({ sessionID: sessionId }),
      ]);
      // Si hay algo pendiente, el objetivo sigue activo pero no se reanuda
      // hasta que el usuario responda (los estados cambian y reevalúan).
      if (permissionResponse.data.length > 0 || formResponse.data.length > 0) return;
      if (generation !== goalGenerationRef.current) return;
      pendingResumeRef.current = false;
      try {
        await client.session.prompt({ sessionID: sessionId, text: goalContinuation(goal) });
        if (generation === goalGenerationRef.current) dispatch({ kind: "executionStarted" });
      } catch (err) {
        setGoalError(errorTextOr(err));
        commitGoal(pauseGoal(goal, Date.now()));
      }
    })();
  }, [
    sessionId,
    loadedSession,
    goal,
    busy,
    permissionsCount,
    formsCount,
    decisionModel,
    client,
    commitGoal,
    notifyGoal,
    dispatch,
  ]);

  const saveGoal = useCallback(
    async (form: { text: string; maxTurns: number; maxCost: number | null }) => {
      if (!sessionId) return;
      const info = await client.session.get({ sessionID: sessionId }).catch(() => null);
      const now = Date.now();
      const previous = goalRef.current;
      const next = previous
        ? editGoal(previous, { ...form, now })
        : createGoal({
            text: form.text,
            maxTurns: form.maxTurns,
            maxCost: form.maxCost,
            now,
            sessionCost: info?.cost,
          });
      goalGenerationRef.current += 1;
      checkingGoalRef.current = false;
      commitGoal(next);
      setGoalError(null);
    },
    [client, sessionId, commitGoal],
  );

  const pauseGoalAction = useCallback(() => {
    const current = goalRef.current;
    if (!current) return;
    pendingResumeRef.current = false;
    commitGoal(pauseGoal(current, Date.now()));
  }, [commitGoal]);

  /** Pausa solo si el objetivo sigue activo (parada manual del turno). */
  const pauseGoalIfActive = useCallback(() => {
    if (goalRef.current?.status === "active") pauseGoalAction();
  }, [pauseGoalAction]);

  const resumeGoalAction = useCallback(() => {
    const current = goalRef.current;
    if (!current) return;
    const next = resumeGoal(current, Date.now());
    commitGoal(next);
    if (next.status === "active") pendingResumeRef.current = true;
  }, [commitGoal]);

  const removeGoalAction = useCallback(() => {
    pendingResumeRef.current = false;
    setGoalError(null);
    commitGoal(null);
  }, [commitGoal]);

  return {
    goal,
    goalError,
    decisionModel,
    goalSessionIds,
    saveGoal,
    pauseGoal: pauseGoalAction,
    resumeGoal: resumeGoalAction,
    removeGoal: removeGoalAction,
    pauseGoalIfActive,
    onTurnEnd,
    markSessionLoaded,
  };
}
