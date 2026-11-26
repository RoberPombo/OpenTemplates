/**
 * Comportamiento del chat de un workspace: sesión, catálogo de modelos/agentes,
 * streaming, envío y parada. La vista solo pinta el estado que devuelve este hook.
 *
 * El reducer de eventos es dominio (`domain/chat/stream`); aquí quedan los
 * efectos secundarios (I/O, preferencias y ciclo de vida de React).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { prefKeys } from "../../domain/repositories/Preferences";
import type { Workspace } from "../../types";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import { errorTextOr } from "../../domain/shared";
import {
  resolveCommandInvocation,
  selectWorkspaceSkills,
  type ChatCommand,
  type ChatSkill,
} from "../../domain/chat/commands";
import { toChatMessages, type ChatMessage } from "../../domain/chat/messages";
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
import {
  removeAgentForm,
  upsertAgentForm,
  type AgentForm,
  type FormAnswer,
} from "../../domain/chat/forms";
import {
  removePermissionRequest,
  upsertPermissionRequest,
  type PermissionDecision,
  type PermissionRequest,
} from "../../domain/chat/permissions";
import {
  effectiveVariant as supportedVariant,
  parseModelRef,
  selectWorkspaceModels,
  toAgentOptions,
  toModelOptions,
  type AgentOption,
  type ModelOption,
} from "../../domain/chat/selection";
import {
  chatStreamReducer,
  eventRequestsReload,
  initialChatStreamState,
} from "../../domain/chat/stream";
import {
  decideNotification,
  describeNotification,
  eventSessionId,
  isThrottledKind,
  notificationsEnabled,
} from "../../domain/chat/notifications";
import {
  eventTouchesSessionList,
  sortSessionsByRecent,
  toSessionSummaries,
  type SessionSummary,
} from "../../domain/chat/sessions";
import {
  createSessionFile,
  importErrorMessage,
  parseSessionFile,
  prepareImport,
  serializeSessionFile,
  suggestedSessionFileName,
} from "../../domain/chat/transfer";

type UseChatInput = {
  client: ChatServer;
  workspace: Workspace;
  /** Ámbito de sesiones (huella del contexto/perfil); separa historiales. */
  scope?: string;
  onSessionChange?: (sessionId: string | null) => void;
  /** Marca actividad de este workspace terminada sin foco (aviso en el sidebar). */
  onWorkspaceActivity?: (workspaceId: string) => void;
  /** Sesión externa que debe abrirse (corridas de una carrera). */
  openSessionId?: string | null;
  onSessionOpened?: () => void;
  /** Sesión creada por la app antes de montar el chat (coordinador). */
  initialSessionId?: string | null;
};

/** El catálogo puede tardar en calentar; reintentos antes de darlo por vacío. */
const CATALOG_RETRIES = 8;
const CATALOG_RETRY_MS = 1500;

export function useChat({
  client,
  workspace,
  scope,
  onSessionChange,
  onWorkspaceActivity,
  openSessionId,
  onSessionOpened,
  initialSessionId,
}: UseChatInput) {
  const root = useAppContext();
  const storageKey = prefKeys.session(workspace.id, scope);
  const modelStorageKey = prefKeys.model(workspace.id, scope);
  const agentStorageKey = prefKeys.agent(workspace.id, scope);
  const variantStorageKey = prefKeys.variant(workspace.id, scope);

  const [sessionId, setSessionId] = useState<string | null>(
    () => initialSessionId ?? root.preferences.get(storageKey),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsNotice, setSessionsNotice] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [commands, setCommands] = useState<ChatCommand[]>([]);
  const [skillCatalog, setSkillCatalog] = useState<ChatSkill[]>([]);
  const [command, setCommand] = useState<ChatCommand | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<ChatSkill[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [forms, setForms] = useState<AgentForm[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  // Objetivo de sesión: estado persistido, modelo de decisión y fin de turno.
  const [goal, setGoal] = useState<Goal | null>(null);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [decisionModel, setDecisionModel] = useState<{ providerID: string; id: string } | null>(
    null,
  );
  const [turnEnd, setTurnEnd] = useState<{ seq: number; failed: boolean } | null>(null);
  const [loadedSession, setLoadedSession] = useState<string | null>(null);
  // Avisos: último turno avisado por sesión y permisos ya avisados (sin repetir).
  const lastNotifiedAt = useRef<Record<string, number>>({});
  const notifiedRequests = useRef<Set<string>>(new Set());
  const sessionsRef = useRef<SessionSummary[]>([]);
  const goalRef = useRef<Goal | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const goalGenerationRef = useRef(0);
  const checkingGoalRef = useRef(false);
  const processedTurnRef = useRef(0);
  const pendingResumeRef = useRef(false);
  const initialMountRef = useRef(true);
  const turnSeqRef = useRef(0);

  const [stream, dispatch] = useReducer(chatStreamReducer, undefined, () =>
    initialChatStreamState({
      branch: workspace.branch ?? null,
      modelChoice: root.preferences.get(modelStorageKey) ?? "",
      agentChoice: root.preferences.get(agentStorageKey) ?? "",
      variant: root.preferences.get(variantStorageKey) ?? "",
    }),
  );
  const { streaming, busy, liveTools, branch, modelChoice, agentChoice, variant, error } = stream;

  const selectedModel = useMemo(
    () => models.find((model) => model.key === modelChoice) ?? null,
    [models, modelChoice],
  );
  // El modelo del perfil se pasa a la sesión al crearla: el contexto ya no lo
  // fija en la config para que dos perfiles puedan compartir servidor.
  const workspaceModelRef = useMemo(() => parseModelRef(workspace.model), [workspace.model]);
  const modelGroups = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of models) {
      const list = groups.get(model.providerID) ?? [];
      list.push(model);
      groups.set(model.providerID, list);
    }
    return [...groups.entries()];
  }, [models]);
  const effectiveVariant = useMemo(
    () => supportedVariant(variant, selectedModel),
    [selectedModel, variant],
  );
  const skills = useMemo(
    () => selectWorkspaceSkills(skillCatalog, workspace.skills, workspace.disabledSkills),
    [skillCatalog, workspace.skills, workspace.disabledSkills],
  );
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

  const modelName = useCallback(
    (model: { providerID: string; id: string } | undefined) => {
      if (!model) return "";
      return (
        models.find((item) => item.providerID === model.providerID && item.id === model.id)?.name ??
        model.id
      );
    },
    [models],
  );

  const agentName = useCallback(
    (id: string | undefined) => {
      if (!id) return "";
      return agents.find((agent) => agent.id === id)?.name ?? id;
    },
    [agents],
  );

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
      dispatch({ kind: "error", error: errorTextOr(err) });
    }
  }, [client, sessionId, storageKey, root]);

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
  useEffect(() => {
    goalRef.current = goal;
  }, [goal]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
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

  const selectSession = useCallback(
    (id: string) => {
      if (id === sessionId) return;
      setSessionsNotice(null);
      root.preferences.set(storageKey, id);
      setSessionId(id);
      setMessages([]);
      dispatch({ kind: "reset" });
    },
    [sessionId, storageKey, root],
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
          dispatch({ kind: "reset" });
        }
        await refreshSessions();
      } catch (err) {
        setSessionsError(errorTextOr(err));
      }
    },
    [client, sessionId, storageKey, root, refreshSessions],
  );

  const exportSession = useCallback(
    async (id: string, sanitize: boolean) => {
      setSessionsError(null);
      setSessionsNotice(null);
      const title = sessionsRef.current.find((session) => session.id === id)?.title ?? "";
      try {
        const transfer = await client.session.export({ sessionID: id, sanitize });
        const contents = serializeSessionFile(createSessionFile(transfer, { sanitized: sanitize }));
        const suggestedName = suggestedSessionFileName(title);
        let result = await root.sessionFiles.save({ suggestedName, contents });
        if (result.status === "exists") {
          const overwrite = root.confirm.confirm(
            `Ya existe un archivo en ${result.path}. ¿Sobrescribirlo?`,
          );
          if (!overwrite) return;
          result = await root.sessionFiles.save({ suggestedName, contents, overwrite: true });
        }
        if (result.status === "saved") {
          setSessionsNotice(`Sesión exportada en ${result.path}`);
        }
      } catch (err) {
        setSessionsError(errorTextOr(err));
      }
    },
    [client, root],
  );

  const importSession = useCallback(async () => {
    setSessionsError(null);
    setSessionsNotice(null);
    try {
      const picked = await root.sessionFiles.open();
      if (!picked) return;
      const parsed = parseSessionFile(picked.contents);
      if (!parsed.ok) {
        setSessionsError(parsed.error);
        return;
      }
      const payload = prepareImport(parsed.file, {
        directory: workspace.projectPath,
        title: `Importada · ${workspace.name}`,
      });
      try {
        const created = await client.session.import(payload);
        await refreshSessions();
        selectSession(created.id);
        setSessionsNotice(`Sesión importada desde ${picked.path}`);
      } catch (err) {
        setSessionsError(importErrorMessage(err, payload.info.id));
      }
    } catch (err) {
      setSessionsError(errorTextOr(err));
    }
  }, [client, root, refreshSessions, selectSession, workspace.name, workspace.projectPath]);

  const forkSession = useCallback(
    async (id: string, before?: string) => {
      if (busy) {
        setSessionsError("Espera a que termine el turno en curso para duplicar la sesión.");
        return;
      }
      setSessionsError(null);
      setSessionsNotice(null);
      try {
        const created = await client.session.fork({ sessionID: id, before });
        await refreshSessions();
        selectSession(created.id);
        setSessionsNotice(before ? "Sesión duplicada hasta ese mensaje." : "Sesión duplicada.");
      } catch (err) {
        setSessionsError(errorTextOr(err));
      }
    },
    [busy, client, refreshSessions, selectSession],
  );

  const loadPendingRequests = useCallback(
    async (id: string) => {
      try {
        const [permissionResponse, formResponse] = await Promise.all([
          client.permission.list({ sessionID: id }),
          client.form.list({ sessionID: id }),
        ]);
        setPermissions(permissionResponse.data);
        setForms(formResponse.data);
        setRequestError(null);
      } catch (err) {
        setPermissions([]);
        setForms([]);
        setRequestError(errorTextOr(err));
      }
    },
    [client],
  );

  useEffect(() => {
    setPermissions([]);
    setForms([]);
    setRequestError(null);
    setRequestBusy(null);
    // Los ids avisados son de la sesión anterior: al cambiarla se liberan para
    // que el mapa no crezca sin límite durante una sesión larga.
    notifiedRequests.current.clear();
    if (!sessionId) return;
    void loadPendingRequests(sessionId);
  }, [sessionId, loadPendingRequests]);

  useEffect(() => {
    setSessionId(initialSessionId ?? root.preferences.get(storageKey));
    setMessages([]);
    setCommand(null);
    setSelectedSkills([]);
    dispatch({
      kind: "workspaceChanged",
      modelChoice: root.preferences.get(modelStorageKey) ?? "",
      agentChoice: root.preferences.get(agentStorageKey) ?? "",
      variant: root.preferences.get(variantStorageKey) ?? "",
    });
  }, [storageKey, modelStorageKey, agentStorageKey, variantStorageKey, initialSessionId, root]);

  useEffect(() => {
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
        if (alive) dispatch({ kind: "error", error: errorTextOr(err) });
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
  ]);

  // Catálogo de modelos y agentes del workspace.
  useEffect(() => {
    let alive = true;
    (async () => {
      // El servidor tarda en resolver proveedores al arrancar: reintentamos el
      // catálogo para no dejar el selector en "Cargando…".
      const loadCatalog = async () => {
        for (let attempt = 0; ; attempt++) {
          const response = await client.model.list({
            location: { directory: workspace.projectPath },
          });
          const options = toModelOptions(response.data);
          if (options.length > 0 || attempt >= CATALOG_RETRIES) return options;
          await new Promise((resolve) => setTimeout(resolve, CATALOG_RETRY_MS));
          if (!alive) return null;
        }
      };

      try {
        const [catalog, agentResponse, defaultResponse, decisionResponse] = await Promise.all([
          loadCatalog(),
          client.agent.list({ location: { directory: workspace.projectPath } }),
          client.model
            .default({ location: { directory: workspace.projectPath } })
            .catch(() => null),
          client.model
            .list({ location: { directory: workspace.projectPath }, types: ["decision"] })
            .catch(() => null),
        ]);
        if (!alive || !catalog) return;

        const nextModels = selectWorkspaceModels(catalog, workspace.models);
        const nextAgents = toAgentOptions(agentResponse.data);
        setModels(nextModels);
        setAgents(nextAgents);
        setCatalogLoading(false);
        setDecisionModel(pickDecisionModel(decisionResponse?.data ?? []));

        dispatch({
          kind: "catalogResolved",
          models: nextModels,
          agents: nextAgents,
          savedModel: root.preferences.get(modelStorageKey),
          savedAgent: root.preferences.get(agentStorageKey),
          workspaceModel: workspace.model,
          serverDefault: defaultResponse?.data ?? null,
        });
      } catch (err) {
        if (alive) {
          setCatalogLoading(false);
          dispatch({ kind: "error", error: errorTextOr(err) });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    client,
    workspace.projectPath,
    workspace.model,
    workspace.models,
    modelStorageKey,
    agentStorageKey,
    root,
  ]);

  // Catálogo de comandos y skills del servidor. Si falla, el composer sigue
  // funcionando: sin comandos y con las skills seleccionadas por id.
  useEffect(() => {
    let alive = true;
    (async () => {
      const location = { directory: workspace.projectPath };
      const [commandResponse, skillResponse] = await Promise.allSettled([
        client.command.list({ location }),
        client.skill.list({ location }),
      ]);
      if (!alive) return;
      setCommands(commandResponse.status === "fulfilled" ? commandResponse.value.data : []);
      setSkillCatalog(skillResponse.status === "fulfilled" ? skillResponse.value.data : []);
    })();
    return () => {
      alive = false;
    };
  }, [client, workspace.projectPath]);

  useEffect(() => {
    if (modelChoice) root.preferences.set(modelStorageKey, modelChoice);
  }, [modelChoice, modelStorageKey, root]);

  useEffect(() => {
    if (agentChoice) root.preferences.set(agentStorageKey, agentChoice);
  }, [agentChoice, agentStorageKey, root]);

  useEffect(() => {
    if (effectiveVariant) root.preferences.set(variantStorageKey, effectiveVariant);
    else root.preferences.remove(variantStorageKey);
  }, [effectiveVariant, variantStorageKey, root]);

  // Rama de git del directorio de trabajo.
  useEffect(() => {
    dispatch({ kind: "branch", branch: workspace.branch ?? null });
    let alive = true;
    void (async () => {
      try {
        const response = await client.vcs.get({
          location: { directory: workspace.projectPath },
        });
        if (!alive) return;
        dispatch({ kind: "branch", branch: response.data.branch.current ?? null });
      } catch {
        // El directorio puede no ser un repositorio git.
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, workspace.projectPath, workspace.branch]);

  const applySelection = useCallback(
    async (id: string) => {
      if (selectedModel) {
        const signature = `${id}|${selectedModel.key}|${effectiveVariant}`;
        if (stream.appliedModel !== signature) {
          await client.session.switchModel({
            sessionID: id,
            model: {
              id: selectedModel.id,
              providerID: selectedModel.providerID,
              ...(effectiveVariant ? { variant: effectiveVariant } : {}),
            },
          });
          dispatch({ kind: "applied", model: signature });
        }
      }
      if (agentChoice) {
        const signature = `${id}|${agentChoice}`;
        if (stream.appliedAgent !== signature) {
          await client.session.switchAgent({ sessionID: id, agent: agentChoice });
          dispatch({ kind: "applied", agent: signature });
        }
      }
    },
    [
      agentChoice,
      client,
      effectiveVariant,
      selectedModel,
      stream.appliedModel,
      stream.appliedAgent,
    ],
  );

  useEffect(() => {
    if (!sessionId) return;
    applySelection(sessionId).catch((err) => dispatch({ kind: "error", error: errorTextOr(err) }));
  }, [applySelection, sessionId]);
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
    [root, workspace.id, workspace.name, sessionId],
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
    [client, sessionId, decisionModel, commitGoal, notifyGoal],
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
    if (busy || permissions.length > 0 || forms.length > 0) return;
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
    permissions.length,
    forms.length,
    decisionModel,
    client,
    commitGoal,
    notifyGoal,
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

  useEffect(() => {
    let alive = true;
    const abort = new AbortController();
    (async () => {
      try {
        for await (const event of client.event.subscribe({
          signal: abort.signal,
        })) {
          if (!alive) break;
          // Aviso nativo y marca del sidebar: se evalúa con el foco actual.
          const now = Date.now();
          const focused = typeof document === "undefined" ? true : document.hasFocus();
          const eventSession = eventSessionId(event);
          const sessionTitle = eventSession
            ? (sessionsRef.current.find((item) => item.id === eventSession)?.title ?? null)
            : null;
          const context = {
            workspace: { id: workspace.id, name: workspace.name },
            sessionTitle,
          };
          const activity = describeNotification(event, context);
          if (activity && !focused) onWorkspaceActivity?.(workspace.id);
          const payload = decideNotification(event, context, {
            enabled: notificationsEnabled(root.preferences.get(prefKeys.notifications)),
            focused,
            now,
            lastNotifiedAt: activity ? (lastNotifiedAt.current[activity.sessionId] ?? null) : null,
          });
          const duplicate = Boolean(
            payload?.requestId && notifiedRequests.current.has(payload.requestId),
          );
          if (payload && !duplicate) {
            if (payload.requestId) notifiedRequests.current.add(payload.requestId);
            if (isThrottledKind(payload.kind)) {
              lastNotifiedAt.current[payload.sessionId] = now;
            }
            void root.notifications.notify({
              title: payload.title,
              body: payload.body,
              workspaceId: payload.workspaceId,
            });
          }
          const permission = event.permission;
          if (permission && permission.sessionID === sessionId) {
            setPermissions((prev) => upsertPermissionRequest(prev, permission));
          }
          const permissionReply = event.permissionReply;
          if (permissionReply) notifiedRequests.current.delete(permissionReply.requestID);
          if (permissionReply && permissionReply.sessionID === sessionId) {
            setPermissions((prev) => removePermissionRequest(prev, permissionReply.requestID));
          }
          const form = event.form;
          if (form && form.sessionID === sessionId) {
            setForms((prev) => upsertAgentForm(prev, form));
          }
          const formSettled = event.formSettled;
          if (formSettled) notifiedRequests.current.delete(formSettled.formID);
          if (formSettled && formSettled.sessionID === sessionId) {
            setForms((prev) => removeAgentForm(prev, formSettled.formID));
          }
          dispatch({ kind: "event", event, sessionId });
          if (eventRequestsReload(event, sessionId)) {
            void reload().finally(() => {
              dispatch({ kind: "streamCleared" });
              turnSeqRef.current += 1;
              setTurnEnd({
                seq: turnSeqRef.current,
                failed: event.type === "session.execution.failed",
              });
            });
          }
          if (eventTouchesSessionList(event)) {
            void refreshSessions();
          }
        }
      } catch (err) {
        if (alive && !abort.signal.aborted) {
          dispatch({ kind: "error", error: errorTextOr(err) });
        }
      }
    })();
    return () => {
      alive = false;
      abort.abort();
    };
  }, [
    client,
    sessionId,
    reload,
    refreshSessions,
    root,
    workspace.id,
    workspace.name,
    onWorkspaceActivity,
  ]);

  const chooseModel = useCallback(
    (key: string) => {
      const next = models.find((model) => model.key === key);
      dispatch({ kind: "modelChosen", key, model: next });
    },
    [models],
  );

  const chooseVariant = useCallback((value: string) => {
    dispatch({ kind: "choices", variant: value });
  }, []);

  const chooseAgent = useCallback((id: string) => {
    dispatch({ kind: "choices", agentChoice: id });
  }, []);

  const chooseCommand = useCallback((next: ChatCommand) => {
    setCommand(next);
  }, []);

  const clearCommand = useCallback(() => setCommand(null), []);

  const chooseSkill = useCallback((skill: ChatSkill) => {
    setSelectedSkills((prev) =>
      prev.some((item) => item.id === skill.id) ? prev : [...prev, skill],
    );
  }, []);

  const removeSkill = useCallback((id: string) => {
    setSelectedSkills((prev) => prev.filter((item) => item.id !== id));
  }, []);

  async function send() {
    const text = input.trim();
    const invocation = resolveCommandInvocation({ text, selected: command, commands });
    if ((!text && !invocation) || sending || busy || !sessionId) return;
    setSending(true);
    dispatch({ kind: "error", error: null });
    const attachedSkills = selectedSkills.map((skill) => ({ id: skill.id }));
    const bubbleText = invocation
      ? `/${invocation.command.name}${invocation.args ? ` ${invocation.args}` : ""}`
      : text;
    setInput("");
    setCommand(null);
    setSelectedSkills([]);
    try {
      const id = sessionId;
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: "user",
          text: bubbleText,
          reasoning: "",
          tools: [],
          created: Date.now(),
        },
      ]);
      dispatch({ kind: "executionStarted" });
      try {
        await applySelection(id);
      } catch (err) {
        dispatch({ kind: "error", error: errorTextOr(err) });
      }
      if (invocation) {
        await client.session.command({
          sessionID: id,
          name: invocation.command.name,
          text: invocation.args,
          ...(attachedSkills.length > 0 ? { skills: attachedSkills } : {}),
        });
      } else {
        await client.session.prompt({
          sessionID: id,
          text,
          ...(attachedSkills.length > 0 ? { skills: attachedSkills } : {}),
        });
      }
    } catch (err) {
      dispatch({ kind: "error", error: errorTextOr(err) });
      dispatch({ kind: "busy", busy: false });
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!sessionId) return;
    const current = goalRef.current;
    if (current?.status === "active") {
      pendingResumeRef.current = false;
      commitGoal(pauseGoal(current, Date.now()));
    }
    try {
      await client.session.interrupt({ sessionID: sessionId });
    } catch (err) {
      dispatch({ kind: "error", error: errorTextOr(err) });
    } finally {
      dispatch({ kind: "executionStopped" });
    }
  }

  function newConversation() {
    root.preferences.remove(storageKey);
    setSessionId(null);
    setMessages([]);
    setSessionsNotice(null);
    dispatch({ kind: "reset" });
  }

  const replyPermission = useCallback(
    async (request: PermissionRequest, decision: PermissionDecision) => {
      setRequestBusy(request.id);
      try {
        await client.permission.reply({
          sessionID: request.sessionID,
          requestID: request.id,
          decision,
        });
        setPermissions((prev) => removePermissionRequest(prev, request.id));
        setRequestError(null);
      } catch (err) {
        setRequestError(errorTextOr(err));
        void loadPendingRequests(request.sessionID);
      } finally {
        setRequestBusy(null);
      }
    },
    [client, loadPendingRequests],
  );

  const replyForm = useCallback(
    async (form: AgentForm, answer: FormAnswer) => {
      setRequestBusy(form.id);
      try {
        await client.form.reply({
          sessionID: form.sessionID,
          formID: form.id,
          answer,
        });
        setForms((prev) => removeAgentForm(prev, form.id));
        setRequestError(null);
      } catch (err) {
        setRequestError(errorTextOr(err));
        void loadPendingRequests(form.sessionID);
      } finally {
        setRequestBusy(null);
      }
    },
    [client, loadPendingRequests],
  );

  const cancelForm = useCallback(
    async (form: AgentForm) => {
      setRequestBusy(form.id);
      try {
        await client.form.cancel({ sessionID: form.sessionID, formID: form.id });
        setForms((prev) => removeAgentForm(prev, form.id));
        setRequestError(null);
      } catch (err) {
        setRequestError(errorTextOr(err));
        void loadPendingRequests(form.sessionID);
      } finally {
        setRequestBusy(null);
      }
    },
    [client, loadPendingRequests],
  );

  return {
    sessionId,
    messages,
    sessions,
    sessionsError,
    sessionsNotice,
    permissions,
    forms,
    requestError,
    requestBusy,
    goal,
    goalError,
    decisionModel,
    goalSessionIds,
    input,
    setInput,
    sending,
    models,
    catalogLoading,
    agents,
    commands,
    skills,
    command,
    selectedSkills,
    streaming,
    busy,
    liveTools,
    branch,
    modelChoice,
    agentChoice,
    effectiveVariant,
    error,
    selectedModel,
    modelGroups,
    modelName,
    agentName,
    canSend: Boolean((input.trim() || command) && sessionId && !sending && !busy),
    chooseModel,
    chooseVariant,
    chooseAgent,
    chooseCommand,
    clearCommand,
    chooseSkill,
    removeSkill,
    send,
    stop,
    newConversation,
    selectSession,
    renameSession,
    deleteSession,
    exportSession,
    importSession,
    forkSession,
    replyPermission,
    replyForm,
    cancelForm,
    saveGoal,
    pauseGoal: pauseGoalAction,
    resumeGoal: resumeGoalAction,
    removeGoal: removeGoalAction,
  };
}
