import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentInfo, ModelInfo } from "@opencode/client";
import type { Workspace } from "../types";
import type { WorkspaceClient } from "../opencode";
import { Markdown } from "./Markdown";

type ToolActivity = {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  detail: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning: string;
  tools: ToolActivity[];
  model?: { providerID: string; id: string };
  agent?: string;
  created: number;
  completed?: number;
};

type StreamPart = {
  id: string;
  text: string;
  reasoning: string;
};

type ModelOption = {
  key: string;
  providerID: string;
  id: string;
  name: string;
  variants: string[];
};

type AgentOption = {
  id: string;
  name: string;
};

type Props = {
  client: WorkspaceClient;
  workspace: Workspace;
  onSessionChange?: (sessionId: string | null) => void;
};

const EFFORT_LABELS: Record<string, string> = {
  none: "sin razonamiento",
  minimal: "mínimo",
  low: "bajo",
  medium: "medio",
  high: "alto",
  xhigh: "muy alto",
  max: "máximo",
};

function modelKey(model: { providerID: string; id: string }) {
  return `${model.providerID}/${model.id}`;
}

function effortLabel(id: string) {
  return EFFORT_LABELS[id] ?? id;
}

function toModelOptions(list: ModelInfo[]): ModelOption[] {
  return list
    .filter((model) => model.enabled !== false && (!model.type || model.type === "chat"))
    .map((model) => ({
      key: modelKey(model),
      providerID: model.providerID,
      id: model.id,
      name: model.name,
      variants: model.variants.map((variant) => variant.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toAgentOptions(list: AgentInfo[]): AgentOption[] {
  return list
    .filter((agent) => !agent.hidden && agent.mode !== "subagent")
    .map((agent) => ({ id: agent.id, name: agent.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toolDetail(state: any): string {
  const input = state?.input ?? {};
  const candidate =
    input.command ??
    input.description ??
    input.filePath ??
    input.path ??
    input.pattern ??
    input.query ??
    input.url ??
    "";
  if (typeof candidate !== "string") return "";
  return candidate.split("\n")[0]?.slice(0, 160) ?? "";
}

function toToolActivity(part: any, index: number): ToolActivity {
  const state = part.state ?? {};
  const status =
    state.status === "error"
      ? "error"
      : state.status === "running" || state.status === "streaming"
        ? "running"
        : "completed";
  return {
    id: part.id ?? `${part.name ?? "tool"}-${index}`,
    name: part.name ?? "tool",
    status,
    detail: toolDetail(state),
  };
}

function toChatMessages(raw: any[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (item.type === "user") {
      messages.push({
        id: item.id,
        role: "user",
        text: item.text ?? "",
        reasoning: "",
        tools: [],
        created: item.time?.created ?? 0,
      });
      continue;
    }
    if (item.type !== "assistant") continue;

    const content: any[] = item.content ?? [];
    const text = content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
      .trim();
    const reasoning = content
      .filter((part) => part.type === "reasoning")
      .map((part) => part.text)
      .join("\n\n")
      .trim();
    const tools = content
      .filter((part) => part.type === "tool")
      .map((part, index) => toToolActivity(part, index));

    if (!text && !reasoning && tools.length === 0) continue;

    messages.push({
      id: item.id,
      role: "assistant",
      text,
      reasoning,
      tools,
      model: item.model ? { providerID: item.model.providerID, id: item.model.id } : undefined,
      agent: typeof item.agent === "string" ? item.agent : undefined,
      created: item.time?.created ?? 0,
      completed: item.time?.completed,
    });
  }
  return messages.sort((a, b) => a.created - b.created);
}

function errorText(error: unknown): string {
  if (!error) return "Error desconocido";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function folderName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function Chat({ client, workspace, onSessionChange }: Props) {
  const storageKey = `openconf:session:${workspace.id}`;
  const modelStorageKey = `openconf:model:${workspace.id}`;
  const agentStorageKey = `openconf:agent:${workspace.id}`;
  const variantStorageKey = `openconf:variant:${workspace.id}`;

  const [sessionId, setSessionId] = useState<string | null>(() => localStorage.getItem(storageKey));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamPart[]>([]);
  const [busy, setBusy] = useState(false);
  const [liveTools, setLiveTools] = useState(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [modelChoice, setModelChoice] = useState<string>(
    () => localStorage.getItem(modelStorageKey) ?? "",
  );
  const [agentChoice, setAgentChoice] = useState<string>(
    () => localStorage.getItem(agentStorageKey) ?? "",
  );
  const [variant, setVariant] = useState<string>(
    () => localStorage.getItem(variantStorageKey) ?? "",
  );
  const [branch, setBranch] = useState<string | null>(workspace.branch ?? null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const appliedModel = useRef("");
  const appliedAgent = useRef("");

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
  const effectiveVariant = useMemo(() => {
    if (!variant) return "";
    return selectedModel?.variants.includes(variant) ? variant : "";
  }, [selectedModel, variant]);

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
      setMessages(toChatMessages(response.data as any[]));
    } catch (err) {
      localStorage.removeItem(storageKey);
      setSessionId(null);
      setMessages([]);
      setError(errorText(err));
    }
  }, [client, sessionId, storageKey]);

  useEffect(() => {
    setSessionId(localStorage.getItem(storageKey));
    setModelChoice(localStorage.getItem(modelStorageKey) ?? "");
    setAgentChoice(localStorage.getItem(agentStorageKey) ?? "");
    setVariant(localStorage.getItem(variantStorageKey) ?? "");
    setMessages([]);
    setStreaming([]);
    setError(null);
    setBusy(false);
    setLiveTools(0);
    appliedModel.current = "";
    appliedAgent.current = "";
  }, [storageKey, modelStorageKey, agentStorageKey, variantStorageKey]);

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
        localStorage.setItem(storageKey, session.id);
      } catch (err) {
        if (alive) setError(errorText(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, sessionId, storageKey, workspace.name, workspace.projectPath]);

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
        const nextModels = toModelOptions(modelResponse.data ?? []).filter(
          (model) => allowedModels.size === 0 || allowedModels.has(model.key),
        );
        const nextAgents = toAgentOptions(agentResponse.data ?? []);
        setModels(nextModels);
        setAgents(nextAgents);

        setModelChoice((current) => {
          const available = (key: string) => nextModels.some((model) => model.key === key);
          if (current && available(current)) return current;
          const saved = localStorage.getItem(modelStorageKey);
          if (saved && available(saved)) return saved;
          const fromWorkspace = workspace.model?.trim() || "";
          if (fromWorkspace && available(fromWorkspace)) return fromWorkspace;
          if (defaultResponse?.data) {
            const fallback = modelKey(defaultResponse.data);
            if (available(fallback)) return fallback;
          }
          return nextModels[0]?.key ?? "";
        });

        setAgentChoice((current) => {
          const available = (id: string) => nextAgents.some((agent) => agent.id === id);
          if (current && available(current)) return current;
          const saved = localStorage.getItem(agentStorageKey);
          if (saved && available(saved)) return saved;
          if (available("build")) return "build";
          return nextAgents[0]?.id ?? "";
        });
      } catch (err) {
        if (alive) setError(errorText(err));
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
  ]);

  useEffect(() => {
    if (modelChoice) localStorage.setItem(modelStorageKey, modelChoice);
  }, [modelChoice, modelStorageKey]);

  useEffect(() => {
    if (agentChoice) localStorage.setItem(agentStorageKey, agentChoice);
  }, [agentChoice, agentStorageKey]);

  useEffect(() => {
    if (effectiveVariant) localStorage.setItem(variantStorageKey, effectiveVariant);
    else localStorage.removeItem(variantStorageKey);
  }, [effectiveVariant, variantStorageKey]);

  // Rama de git del directorio de trabajo.
  useEffect(() => {
    setBranch(workspace.branch ?? null);
    let alive = true;
    void (async () => {
      try {
        const response = await client.vcs.get({
          location: { directory: workspace.projectPath },
        });
        if (!alive) return;
        setBranch(response.data.branch.current ?? null);
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
        if (appliedModel.current !== signature) {
          await client.session.switchModel({
            sessionID: id,
            model: {
              id: selectedModel.id,
              providerID: selectedModel.providerID,
              ...(effectiveVariant ? { variant: effectiveVariant } : {}),
            },
          });
          appliedModel.current = signature;
        }
      }
      if (agentChoice) {
        const signature = `${id}|${agentChoice}`;
        if (appliedAgent.current !== signature) {
          await client.session.switchAgent({ sessionID: id, agent: agentChoice });
          appliedAgent.current = signature;
        }
      }
    },
    [agentChoice, client, effectiveVariant, selectedModel],
  );

  useEffect(() => {
    if (!sessionId) return;
    applySelection(sessionId).catch((err) => setError(errorText(err)));
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
          const type = event.type;
          const data: any = (event as any).data ?? {};

          if (type === "vcs.branch.updated") {
            if (typeof data.branch === "string") setBranch(data.branch);
            continue;
          }
          if (!sessionId || data.sessionID !== sessionId) continue;

          if (type === "session.text.started") {
            const id = data.assistantMessageID ?? "stream";
            setStreaming((prev) =>
              prev.some((part) => part.id === id)
                ? prev
                : [...prev, { id, text: "", reasoning: "" }],
            );
          } else if (type === "session.model.selected") {
            const model = data.model;
            if (model && typeof model.providerID === "string" && typeof model.id === "string") {
              const key = modelKey(model);
              setModelChoice(key);
              setVariant(typeof model.variant === "string" ? model.variant : "");
              appliedModel.current = `${sessionId}|${key}|${model.variant ?? ""}`;
            }
          } else if (type === "session.agent.selected") {
            if (typeof data.agent === "string") {
              setAgentChoice(data.agent);
              appliedAgent.current = `${sessionId}|${data.agent}`;
            }
          } else if (type === "session.text.delta") {
            const id = data.assistantMessageID ?? "stream";
            const delta = data.delta ?? "";
            setStreaming((prev) => {
              const index = prev.findIndex((part) => part.id === id);
              if (index === -1) return [...prev, { id, text: delta, reasoning: "" }];
              const next = prev.slice();
              next[index] = { ...next[index], text: next[index].text + delta };
              return next;
            });
          } else if (type === "session.reasoning.delta") {
            const id = data.assistantMessageID ?? "stream";
            const delta = data.delta ?? "";
            setStreaming((prev) => {
              const index = prev.findIndex((part) => part.id === id);
              if (index === -1) return [...prev, { id, text: "", reasoning: delta }];
              const next = prev.slice();
              next[index] = { ...next[index], reasoning: next[index].reasoning + delta };
              return next;
            });
          } else if (type === "session.tool.called") {
            setLiveTools((count) => count + 1);
          } else if (type === "session.execution.started") {
            setBusy(true);
            setLiveTools(0);
          } else if (
            type === "session.idle" ||
            type === "session.execution.succeeded" ||
            type === "session.execution.interrupted"
          ) {
            setBusy(false);
            setLiveTools(0);
            void reload().finally(() => setStreaming([]));
          } else if (type === "session.execution.failed") {
            setBusy(false);
            setLiveTools(0);
            const message = data.error?.message ?? data.error?.name ?? "La ejecución falló";
            setError(message);
            void reload().finally(() => setStreaming([]));
          }
        }
      } catch (err) {
        if (alive && !abort.signal.aborted) {
          setError(errorText(err));
        }
      }
    })();
    return () => {
      alive = false;
      abort.abort();
    };
  }, [client, sessionId, reload]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming, busy]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [input]);

  function chooseModel(key: string) {
    setModelChoice(key);
    const next = models.find((model) => model.key === key);
    setVariant((current) => (next?.variants.includes(current) ? current : ""));
  }

  function chooseVariant(value: string) {
    setVariant(value);
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || busy || !sessionId) return;
    setSending(true);
    setError(null);
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
      setBusy(true);
      setLiveTools(0);
      try {
        await applySelection(id);
      } catch (err) {
        setError(errorText(err));
      }
      await client.session.prompt({ sessionID: id, text });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!sessionId) return;
    try {
      await client.session.interrupt({ sessionID: sessionId });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      setLiveTools(0);
    }
  }

  function newConversation() {
    localStorage.removeItem(storageKey);
    setSessionId(null);
    setMessages([]);
    setStreaming([]);
    setError(null);
    setBusy(false);
    setLiveTools(0);
    appliedModel.current = "";
    appliedAgent.current = "";
  }

  const folder = useMemo(() => folderName(workspace.projectPath), [workspace.projectPath]);
  const variants = selectedModel?.variants ?? [];
  const canSend = Boolean(input.trim() && sessionId && !sending && !busy);

  return (
    <section className="chat">
      <div className="messages">
        {messages.length === 0 && streaming.length === 0 && (
          <div className="empty-chat">
            <p>Pregunta, planifica o pide cambios en {workspace.name}.</p>
            <p className="muted small-text">
              {workspace.mcpNames.length} MCPs · {workspace.skills.length} skills ·{" "}
              {workspace.agents.length} agentes
            </p>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <article key={message.id} className="msg user">
              <div className="user-bubble">
                <Markdown text={message.text} />
              </div>
            </article>
          ) : (
            <article key={message.id} className="msg assistant">
              {message.tools.length > 0 && <Activity tools={message.tools} />}
              {message.reasoning && (
                <details className="reasoning">
                  <summary>Razonamiento</summary>
                  <Markdown text={message.reasoning} />
                </details>
              )}
              {message.text && <Markdown text={message.text} />}
              <MessageMeta
                model={modelName(message.model)}
                agent={agentName(message.agent)}
                duration={formatDuration((message.completed ?? 0) - message.created)}
              />
            </article>
          ),
        )}

        {streaming.map((part) => (
          <article key={`stream-${part.id}`} className="msg assistant streaming">
            {part.reasoning && (
              <details className="reasoning">
                <summary>Razonamiento</summary>
                <Markdown text={part.reasoning} />
              </details>
            )}
            {part.text ? <Markdown text={part.text} /> : null}
            <MessageMeta
              model={selectedModel?.name ?? ""}
              agent={agentName(agentChoice)}
              status={
                part.text
                  ? "escribiendo…"
                  : liveTools > 0
                    ? `ejecutando ${liveTools} comando${liveTools === 1 ? "" : "s"}…`
                    : "pensando…"
              }
            />
          </article>
        ))}

        {busy && streaming.length === 0 && (
          <article className="msg assistant streaming">
            <div className="thinking">
              {liveTools > 0
                ? `Ejecutando ${liveTools} comando${liveTools === 1 ? "" : "s"}…`
                : "Pensando…"}
            </div>
          </article>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="inline-error">{error}</div>}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="composer-card">
          <div className="composer-project">
            <span className="context-chip" title={`Proyecto: ${workspace.projectPath}`}>
              <FolderIcon />
              <span className="context-key">Proyecto</span>
              <span className="context-label">{folder}</span>
            </span>
            {branch && (
              <span className="context-chip branch" title={`Rama ${branch}`}>
                <BranchIcon />
                <span className="context-key">Rama</span>
                <span className="context-label">{branch}</span>
              </span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            placeholder={
              sessionId
                ? "Planifica, construye o pregunta. @ menciona archivos, / usa comandos"
                : "Preparando sesión…"
            }
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-bar">
            <div className="composer-context">
              <button
                type="button"
                className="composer-icon"
                title="Nueva conversación"
                aria-label="Nueva conversación"
                onClick={newConversation}
                disabled={busy}
              >
                <PlusIcon />
              </button>
            </div>

            <div className="composer-controls">
              <label className="select-chip" title="Modelo">
                <SparkIcon />
                <select
                  aria-label="Modelo"
                  value={modelChoice}
                  disabled={models.length === 0 || busy}
                  onChange={(event) => chooseModel(event.target.value)}
                >
                  {models.length === 0 && <option value="">Cargando modelos…</option>}
                  {modelGroups.map(([provider, list]) => (
                    <optgroup key={provider} label={provider}>
                      {list.map((model) => (
                        <option key={model.key} value={model.key}>
                          {model.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              {variants.length > 0 && (
                <label className="select-chip" title="Razonamiento">
                  <BrainIcon />
                  <select
                    aria-label="Razonamiento"
                    value={effectiveVariant}
                    disabled={busy}
                    onChange={(event) => chooseVariant(event.target.value)}
                  >
                    <option value="">predeterminado</option>
                    {variants.map((id) => (
                      <option key={id} value={id}>
                        {effortLabel(id)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="select-chip" title="Agente">
                <AgentIcon />
                <select
                  aria-label="Agente"
                  value={agentChoice}
                  disabled={agents.length === 0 || busy}
                  onChange={(event) => setAgentChoice(event.target.value)}
                >
                  {agents.length === 0 && <option value="">Cargando agentes…</option>}
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>

              {busy ? (
                <button
                  type="button"
                  className="send-button stop"
                  title="Parar"
                  aria-label="Parar"
                  onClick={() => void stop()}
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  title="Enviar"
                  aria-label="Enviar"
                  disabled={!canSend}
                >
                  <ArrowUpIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}

function Activity({ tools }: { tools: ToolActivity[] }) {
  const count = tools.length;
  return (
    <details className="activity">
      <summary>
        <span className="activity-chevron" aria-hidden="true">
          ›
        </span>
        Actividad
        <span className="muted">
          · {count} comando{count === 1 ? "" : "s"} ejecutado{count === 1 ? "" : "s"}
        </span>
      </summary>
      <ul>
        {tools.map((tool) => (
          <li key={tool.id}>
            <span className={`tool-status ${tool.status}`} aria-hidden="true" />
            <span className="tool-name">{tool.name}</span>
            {tool.detail && <code>{tool.detail}</code>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function MessageMeta({
  model,
  agent,
  duration,
  status,
}: {
  model: string;
  agent: string;
  duration?: string;
  status?: string;
}) {
  return (
    <div className="msg-meta">
      <TerminalIcon />
      {model && <span>{model}</span>}
      {agent && (
        <>
          {model && <span className="meta-dot">·</span>}
          <span>{agent}</span>
        </>
      )}
      {duration && (
        <>
          {(model || agent) && <span className="meta-dot">·</span>}
          <span>{duration}</span>
        </>
      )}
      {status && (
        <>
          {(model || agent) && <span className="meta-dot">·</span>}
          <span>{status}</span>
        </>
      )}
    </div>
  );
}

function iconProps() {
  return {
    width: 13,
    height: 13,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function FolderIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="6" cy="19" r="2.2" />
      <circle cx="18" cy="7" r="2.2" />
      <path d="M6 7.2v9.6M8.2 5H14a4 4 0 0 1 4 4v0" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg {...iconProps()}>
      <path d="m12 3 1.8 4.9L19 9.7l-4.2 3 1.3 5.1L12 15l-4.1 2.8 1.3-5.1L5 9.7l5.2-1.8Z" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M9.5 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.5A3 3 0 0 0 9 17a3 3 0 0 0 3-2.2V6.5A2.5 2.5 0 0 0 9.5 4Z" />
      <path d="M14.5 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.5A3 3 0 0 1 15 17a3 3 0 0 1-3-2.2V6.5A2.5 2.5 0 0 1 14.5 4Z" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M9 3v4M15 3v4M9 13h.01M15 13h.01" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
