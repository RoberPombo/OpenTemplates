import { useEffect, useMemo, useRef } from "react";
import type { Workspace } from "../../types";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import { folderName, formatDuration } from "../../domain/shared";
import type { ToolActivity } from "../../domain/chat/messages";
import { useChat } from "../hooks/useChat";
import { Markdown } from "./Markdown";
import { ModelInfoCard } from "./ModelInfoCard";
import { RequestDock } from "./RequestDock";
import { AsyncSearchableSelect, Select } from "./ui";

type Props = {
  client: ChatServer;
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

function effortLabel(id: string) {
  return EFFORT_LABELS[id] ?? id;
}

export function Chat({ client, workspace, onSessionChange }: Props) {
  const {
    sessionId,
    messages,
    permissions,
    forms,
    requestError,
    requestBusy,
    input,
    setInput,
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
    canSend,
    chooseModel,
    chooseVariant,
    chooseAgent,
    send,
    stop,
    newConversation,
    replyPermission,
    replyForm,
    cancelForm,
  } = useChat({ client, workspace, onSessionChange });

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming, busy]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [input]);

  const folder = folderName(workspace.projectPath);
  const variants = selectedModel?.variants ?? [];
  const modelSelectOptions = useMemo(
    () =>
      modelGroups.map(([provider, list]) => ({
        label: provider,
        options: list.map((model) => ({
          value: model.key,
          label: model.name,
          description: `${model.providerID} · ${model.id}`,
          searchText: `${model.providerID} ${model.id}`,
          tooltip: model.details ? <ModelInfoCard details={model.details} /> : undefined,
        })),
      })),
    [modelGroups],
  );
  const variantSelectOptions = useMemo(
    () => (selectedModel?.variants ?? []).map((id) => ({ value: id, label: effortLabel(id) })),
    [selectedModel],
  );
  const agentSelectOptions = useMemo(
    () => agents.map((agent) => ({ value: agent.id, label: agent.name })),
    [agents],
  );

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

      <RequestDock
        permissions={permissions}
        forms={forms}
        busy={requestBusy}
        error={requestError}
        onPermission={(request, decision) => void replyPermission(request, decision)}
        onFormReply={(form, answer) => void replyForm(form, answer)}
        onFormCancel={(form) => void cancelForm(form)}
      />

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
              <div className="select-chip" title="Modelo">
                <SparkIcon />
                <AsyncSearchableSelect
                  aria-label="Modelo"
                  value={modelChoice}
                  placeholder={models.length === 0 ? "Cargando modelos…" : "Buscar modelo…"}
                  disabled={models.length === 0 || busy}
                  options={modelSelectOptions}
                  variant="chip"
                  onValueChange={chooseModel}
                />
              </div>

              {variants.length > 0 && (
                <div className="select-chip" title="Razonamiento">
                  <BrainIcon />
                  <Select
                    aria-label="Razonamiento"
                    value={effectiveVariant || ""}
                    placeholder="predeterminado"
                    disabled={busy}
                    options={variantSelectOptions}
                    variant="chip"
                    onValueChange={chooseVariant}
                  />
                </div>
              )}

              <div className="select-chip" title="Agente">
                <AgentIcon />
                <Select
                  aria-label="Agente"
                  value={agentChoice}
                  placeholder="Cargando agentes…"
                  disabled={agents.length === 0 || busy}
                  options={agentSelectOptions}
                  variant="chip"
                  onValueChange={chooseAgent}
                />
              </div>

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
