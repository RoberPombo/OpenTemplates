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
import { errorText as baseErrorText } from "../../domain/shared";
import {
  resolveCommandInvocation,
  selectWorkspaceSkills,
  type ChatCommand,
  type ChatSkill,
} from "../../domain/chat/commands";
import { toChatMessages, type ChatMessage } from "../../domain/chat/messages";
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

type UseChatInput = {
  client: ChatServer;
  workspace: Workspace;
  onSessionChange?: (sessionId: string | null) => void;
  /** Marca actividad de este workspace terminada sin foco (aviso en el sidebar). */
  onWorkspaceActivity?: (workspaceId: string) => void;
};

function errorText(error: unknown): string {
  if (!error) return "Error desconocido";
  return baseErrorText(error);
}

export function useChat({ client, workspace, onSessionChange, onWorkspaceActivity }: UseChatInput) {
  const root = useAppContext();
  const storageKey = prefKeys.session(workspace.id);
  const modelStorageKey = prefKeys.model(workspace.id);
  const agentStorageKey = prefKeys.agent(workspace.id);
  const variantStorageKey = prefKeys.variant(workspace.id);

  const [sessionId, setSessionId] = useState<string | null>(() => root.preferences.get(storageKey));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [commands, setCommands] = useState<ChatCommand[]>([]);
  const [skillCatalog, setSkillCatalog] = useState<ChatSkill[]>([]);
  const [command, setCommand] = useState<ChatCommand | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<ChatSkill[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [forms, setForms] = useState<AgentForm[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  // Avisos: último turno avisado por sesión y permisos ya avisados (sin repetir).
  const lastNotifiedAt = useRef<Record<string, number>>({});
  const notifiedRequests = useRef<Set<string>>(new Set());
  const sessionsRef = useRef<SessionSummary[]>([]);

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
    } catch (err) {
      root.preferences.remove(storageKey);
      setSessionId(null);
      setMessages([]);
      dispatch({ kind: "error", error: errorText(err) });
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
      setSessionsError(errorText(err));
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
      root.preferences.set(storageKey, id);
      setSessionId(id);
      setMessages([]);
      dispatch({ kind: "reset" });
    },
    [sessionId, storageKey, root],
  );

  const renameSession = useCallback(
    async (id: string, title: string) => {
      const next = title.trim();
      if (!next) return;
      try {
        await client.session.update({ sessionID: id, title: next });
        await refreshSessions();
      } catch (err) {
        setSessionsError(errorText(err));
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
        setSessionsError(errorText(err));
      }
    },
    [client, sessionId, storageKey, root, refreshSessions],
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
        setRequestError(errorText(err));
      }
    },
    [client],
  );

  useEffect(() => {
    setPermissions([]);
    setForms([]);
    setRequestError(null);
    setRequestBusy(null);
    if (!sessionId) return;
    void loadPendingRequests(sessionId);
  }, [sessionId, loadPendingRequests]);

  useEffect(() => {
    setSessionId(root.preferences.get(storageKey));
    setMessages([]);
    setCommand(null);
    setSelectedSkills([]);
    dispatch({
      kind: "workspaceChanged",
      modelChoice: root.preferences.get(modelStorageKey) ?? "",
      agentChoice: root.preferences.get(agentStorageKey) ?? "",
      variant: root.preferences.get(variantStorageKey) ?? "",
    });
  }, [storageKey, modelStorageKey, agentStorageKey, variantStorageKey, root]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    void reload();
  }, [sessionId, reload]);

  useEffect(() => {
    if (sessionId) return;
    let alive = true;
    (async () => {
      try {
        const session = await client.session.create({
          location: { directory: workspace.projectPath },
          title: `Chat · ${workspace.name}`,
        });
        if (!alive) return;
        setSessionId(session.id);
        root.preferences.set(storageKey, session.id);
        void refreshSessions();
      } catch (err) {
        if (alive) dispatch({ kind: "error", error: errorText(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, sessionId, storageKey, workspace.name, workspace.projectPath, root, refreshSessions]);

  // Catálogo de modelos y agentes del workspace.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [modelResponse, agentResponse, defaultResponse] = await Promise.all([
          client.model.list({ location: { directory: workspace.projectPath } }),
          client.agent.list({ location: { directory: workspace.projectPath } }),
          client.model
            .default({ location: { directory: workspace.projectPath } })
            .catch(() => null),
        ]);
        if (!alive) return;

        const allowedModels = new Set(workspace.models ?? []);
        const nextModels = toModelOptions(modelResponse.data).filter(
          (model) => allowedModels.size === 0 || allowedModels.has(model.key),
        );
        const nextAgents = toAgentOptions(agentResponse.data);
        setModels(nextModels);
        setAgents(nextAgents);

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
        if (alive) dispatch({ kind: "error", error: errorText(err) });
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
    applySelection(sessionId).catch((err) => dispatch({ kind: "error", error: errorText(err) }));
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
            void reload().finally(() => dispatch({ kind: "streamCleared" }));
          }
          if (eventTouchesSessionList(event)) {
            void refreshSessions();
          }
        }
      } catch (err) {
        if (alive && !abort.signal.aborted) {
          dispatch({ kind: "error", error: errorText(err) });
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
        dispatch({ kind: "error", error: errorText(err) });
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
      dispatch({ kind: "error", error: errorText(err) });
      dispatch({ kind: "busy", busy: false });
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!sessionId) return;
    try {
      await client.session.interrupt({ sessionID: sessionId });
    } catch (err) {
      dispatch({ kind: "error", error: errorText(err) });
    } finally {
      dispatch({ kind: "executionStopped" });
    }
  }

  function newConversation() {
    root.preferences.remove(storageKey);
    setSessionId(null);
    setMessages([]);
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
        setRequestError(errorText(err));
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
        setRequestError(errorText(err));
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
        setRequestError(errorText(err));
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
    permissions,
    forms,
    requestError,
    requestBusy,
    input,
    setInput,
    sending,
    models,
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
    replyPermission,
    replyForm,
    cancelForm,
  };
}
