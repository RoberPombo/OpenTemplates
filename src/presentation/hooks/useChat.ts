/**
 * Chat de un workspace como composición: sesión, historial y lista
 * (`useChatSessions`), catálogo y streaming, solicitudes del agente
 * (`useChatRequests`), objetivos (`useChatGoal`) y transferencia. Los efectos
 * secundarios viven en los hooks; aquí solo se encadenan.
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
import {
  agentLabel,
  effectiveVariant as supportedVariant,
  groupModelsByProvider,
  modelLabel,
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
import { eventTouchesSessionList } from "../../domain/chat/sessions";
import {
  createSessionFile,
  importErrorMessage,
  parseSessionFile,
  prepareImport,
  serializeSessionFile,
  suggestedSessionFileName,
} from "../../domain/chat/transfer";
import { useChatGoal } from "./useChatGoal";
import { useChatRequests } from "./useChatRequests";
import { useChatSessions } from "./useChatSessions";

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
  const modelStorageKey = prefKeys.model(workspace.id, scope);
  const agentStorageKey = prefKeys.agent(workspace.id, scope);
  const variantStorageKey = prefKeys.variant(workspace.id, scope);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [commands, setCommands] = useState<ChatCommand[]>([]);
  const [skillCatalog, setSkillCatalog] = useState<ChatSkill[]>([]);
  const [command, setCommand] = useState<ChatCommand | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<ChatSkill[]>([]);
  // Avisos: último turno avisado por sesión y permisos ya avisados (sin repetir).
  const lastNotifiedAt = useRef<Record<string, number>>({});
  const notifiedRequests = useRef<Set<string>>(new Set());

  const [stream, dispatch] = useReducer(chatStreamReducer, undefined, () =>
    initialChatStreamState({
      branch: workspace.branch ?? null,
      modelChoice: root.preferences.get(modelStorageKey) ?? "",
      agentChoice: root.preferences.get(agentStorageKey) ?? "",
      variant: root.preferences.get(variantStorageKey) ?? "",
    }),
  );
  const { streaming, busy, liveTools, branch, modelChoice, agentChoice, variant, error } = stream;

  const reportSessionError = useCallback((message: string) => {
    dispatch({ kind: "error", error: message });
  }, []);
  const resetSessionState = useCallback(() => {
    dispatch({ kind: "reset" });
  }, []);

  // Sesión activa, historial y lista: toda la persistencia de sesión.
  const {
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
  } = useChatSessions({
    client,
    workspace,
    root,
    scope,
    openSessionId,
    onSessionOpened,
    onSessionChange,
    initialSessionId,
    onError: reportSessionError,
    onSessionReset: resetSessionState,
  });

  const selectedModel = useMemo(
    () => models.find((model) => model.key === modelChoice) ?? null,
    [models, modelChoice],
  );
  const modelGroups = useMemo(() => groupModelsByProvider(models), [models]);
  const effectiveVariant = supportedVariant(variant, selectedModel);
  const skills = useMemo(
    () => selectWorkspaceSkills(skillCatalog, workspace.skills, workspace.disabledSkills),
    [skillCatalog, workspace.skills, workspace.disabledSkills],
  );

  // Solicitudes del agente (permisos y formularios): carga, respuestas y
  // operaciones estrechas para el bucle SSE.
  const {
    permissions,
    forms,
    requestError,
    requestBusy,
    replyPermission,
    replyForm,
    cancelForm,
    upsertPermission,
    removePermission,
    upsertForm,
    removeForm,
  } = useChatRequests({ client, sessionId });

  // Objetivo de la sesión: estado, evaluación al cerrar turno y acciones.
  const { onTurnEnd, pauseGoalIfActive, ...goalApi } = useChatGoal({
    client,
    sessionId,
    workspace,
    root,
    sessions,
    messages,
    sessionsRef,
    loadedSession,
    busy,
    permissionsCount: permissions.length,
    formsCount: forms.length,
    dispatch,
  });

  const modelName = useCallback(
    (model: { providerID: string; id: string } | undefined) => modelLabel(models, model),
    [models],
  );
  const agentName = useCallback((id: string | undefined) => agentLabel(agents, id), [agents]);

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
    [client, root, sessionsRef, setSessionsError, setSessionsNotice],
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
  }, [
    client,
    root,
    refreshSessions,
    selectSession,
    setSessionsError,
    setSessionsNotice,
    workspace.name,
    workspace.projectPath,
  ]);

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
    [busy, client, refreshSessions, selectSession, setSessionsError, setSessionsNotice],
  );

  useEffect(() => {
    // Los ids avisados son de la sesión anterior; se liberan al cambiarla.
    notifiedRequests.current.clear();
  }, [sessionId]);

  useEffect(() => {
    setCommand(null);
    setSelectedSkills([]);
    dispatch({
      kind: "workspaceChanged",
      modelChoice: root.preferences.get(modelStorageKey) ?? "",
      agentChoice: root.preferences.get(agentStorageKey) ?? "",
      variant: root.preferences.get(variantStorageKey) ?? "",
    });
  }, [modelStorageKey, agentStorageKey, variantStorageKey, initialSessionId, root]);

  // Catálogo de modelos y agentes del workspace.
  useEffect(() => {
    let alive = true;
    (async () => {
      // Al arrancar el servidor tarda: reintentamos para no dejar "Cargando…".
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
        const [catalog, agentResponse, defaultResponse] = await Promise.all([
          loadCatalog(),
          client.agent.list({ location: { directory: workspace.projectPath } }),
          client.model
            .default({ location: { directory: workspace.projectPath } })
            .catch(() => null),
        ]);
        if (!alive || !catalog) return;

        const nextModels = selectWorkspaceModels(catalog, workspace.models);
        const nextAgents = toAgentOptions(agentResponse.data);
        setModels(nextModels);
        setAgents(nextAgents);
        setCatalogLoading(false);

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

  // Comandos y skills del servidor; si fallan, el composer sigue funcionando.
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
    if (agentChoice) root.preferences.set(agentStorageKey, agentChoice);
    if (effectiveVariant) root.preferences.set(variantStorageKey, effectiveVariant);
    else root.preferences.remove(variantStorageKey);
  }, [
    modelChoice,
    agentChoice,
    effectiveVariant,
    modelStorageKey,
    agentStorageKey,
    variantStorageKey,
    root,
  ]);

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
            upsertPermission(permission);
          }
          const permissionReply = event.permissionReply;
          if (permissionReply) notifiedRequests.current.delete(permissionReply.requestID);
          if (permissionReply && permissionReply.sessionID === sessionId) {
            removePermission(permissionReply.requestID);
          }
          const form = event.form;
          if (form && form.sessionID === sessionId) {
            upsertForm(form);
          }
          const formSettled = event.formSettled;
          if (formSettled) notifiedRequests.current.delete(formSettled.formID);
          if (formSettled && formSettled.sessionID === sessionId) {
            removeForm(formSettled.formID);
          }
          dispatch({ kind: "event", event, sessionId });
          if (eventRequestsReload(event, sessionId)) {
            void reload().finally(() => {
              dispatch({ kind: "streamCleared" });
              onTurnEnd(event.type === "session.execution.failed");
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
    sessionsRef,
    root,
    workspace.id,
    workspace.name,
    onWorkspaceActivity,
    onTurnEnd,
    upsertPermission,
    removePermission,
    upsertForm,
    removeForm,
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
    pauseGoalIfActive();
    try {
      await client.session.interrupt({ sessionID: sessionId });
    } catch (err) {
      dispatch({ kind: "error", error: errorTextOr(err) });
    } finally {
      dispatch({ kind: "executionStopped" });
    }
  }

  return {
    ...goalApi,
    sessionId,
    messages,
    sessions,
    sessionsError,
    sessionsNotice,
    permissions,
    forms,
    requestError,
    requestBusy,
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
  };
}
