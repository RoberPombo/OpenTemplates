/**
 * Comportamiento del chat de un workspace: sesión, catálogo de modelos/agentes,
 * streaming, envío y parada. La vista solo pinta el estado que devuelve este hook.
 *
 * El reducer de eventos es dominio (`domain/chat/stream`); aquí quedan los
 * efectos secundarios (I/O, preferencias y ciclo de vida de React).
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { prefKeys } from "../../domain/repositories/Preferences";
import type { Workspace } from "../../types";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import { errorText as baseErrorText } from "../../domain/shared";
import { toChatMessages, type ChatMessage } from "../../domain/chat/messages";
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

type UseChatInput = {
  client: ChatServer;
  workspace: Workspace;
  onSessionChange?: (sessionId: string | null) => void;
};

function errorText(error: unknown): string {
  if (!error) return "Error desconocido";
  return baseErrorText(error);
}

export function useChat({ client, workspace, onSessionChange }: UseChatInput) {
  const root = useAppContext();
  const storageKey = prefKeys.session(workspace.id);
  const modelStorageKey = prefKeys.model(workspace.id);
  const agentStorageKey = prefKeys.agent(workspace.id);
  const variantStorageKey = prefKeys.variant(workspace.id);

  const [sessionId, setSessionId] = useState<string | null>(() => root.preferences.get(storageKey));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);

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

  useEffect(() => {
    setSessionId(root.preferences.get(storageKey));
    setMessages([]);
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
      } catch (err) {
        if (alive) dispatch({ kind: "error", error: errorText(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, sessionId, storageKey, workspace.name, workspace.projectPath, root]);

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
          dispatch({ kind: "event", event, sessionId });
          if (eventRequestsReload(event, sessionId)) {
            void reload().finally(() => dispatch({ kind: "streamCleared" }));
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
  }, [client, sessionId, reload]);

  function chooseModel(key: string) {
    const next = models.find((model) => model.key === key);
    dispatch({ kind: "modelChosen", key, model: next });
  }

  function chooseVariant(value: string) {
    dispatch({ kind: "choices", variant: value });
  }

  function chooseAgent(id: string) {
    dispatch({ kind: "choices", agentChoice: id });
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || busy || !sessionId) return;
    setSending(true);
    dispatch({ kind: "error", error: null });
    setInput("");
    try {
      const id = sessionId;
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: "user",
          text,
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
      await client.session.prompt({ sessionID: id, text });
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

  return {
    sessionId,
    messages,
    input,
    setInput,
    sending,
    models,
    agents,
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
    canSend: Boolean(input.trim() && sessionId && !sending && !busy),
    chooseModel,
    chooseVariant,
    chooseAgent,
    send,
    stop,
    newConversation,
  };
}
