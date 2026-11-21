/**
 * Reducer puro del streaming de chat: traduce los eventos del servidor opencode
 * a transiciones de estado. Sin React ni cliente HTTP; testeable con secuencias.
 *
 * El estado que devuelve es inmutable: si el evento no aplica, se devuelve la
 * misma referencia. `reload` indica que la UI debe recargar los mensajes y
 * limpiar el streaming al terminar (efecto secundario, fuera del dominio).
 */
import {
  effectiveVariant,
  modelKey,
  resolveAgentChoice,
  resolveModelChoice,
  type AgentOption,
  type ModelOption,
} from "./selection";

export type StreamPart = {
  id: string;
  text: string;
  reasoning: string;
};

export type ChatStreamState = {
  streaming: StreamPart[];
  busy: boolean;
  liveTools: number;
  branch: string | null;
  modelChoice: string;
  agentChoice: string;
  variant: string;
  appliedModel: string;
  appliedAgent: string;
  error: string | null;
};

export type ChatEvent = {
  type: string;
  data?: unknown;
};

export function initialChatStreamState(init: {
  branch: string | null;
  modelChoice: string;
  agentChoice: string;
  variant: string;
}): ChatStreamState {
  return {
    streaming: [],
    busy: false,
    liveTools: 0,
    branch: init.branch,
    modelChoice: init.modelChoice,
    agentChoice: init.agentChoice,
    variant: init.variant,
    appliedModel: "",
    appliedAgent: "",
    error: null,
  };
}

function appendDelta(
  streaming: StreamPart[],
  id: string,
  delta: string,
  kind: "text" | "reasoning",
): StreamPart[] {
  const index = streaming.findIndex((part) => part.id === id);
  if (index === -1) {
    return [
      ...streaming,
      { id, text: kind === "text" ? delta : "", reasoning: kind === "reasoning" ? delta : "" },
    ];
  }
  const next = streaming.slice();
  const part = next[index];
  next[index] =
    kind === "text"
      ? { ...part, text: part.text + delta }
      : { ...part, reasoning: part.reasoning + delta };
  return next;
}

/** Tipos de evento que terminan la ejecución y piden recargar mensajes. */
const RELOAD_EVENT_TYPES = new Set([
  "session.idle",
  "session.execution.succeeded",
  "session.execution.interrupted",
  "session.execution.failed",
]);

/** ¿El evento pide recargar mensajes para esta sesión? (mismo filtro que applyChatEvent) */
export function eventRequestsReload(event: ChatEvent, sessionId: string | null): boolean {
  if (!RELOAD_EVENT_TYPES.has(event.type)) return false;
  const data = (event.data ?? {}) as Record<string, unknown>;
  return Boolean(sessionId) && data.sessionID === sessionId;
}

export function applyChatEvent(
  state: ChatStreamState,
  event: ChatEvent,
  sessionId: string | null,
): { state: ChatStreamState; reload: boolean } {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const unchanged = { state, reload: false };

  // La rama git se actualiza aunque no haya sesión activa o sea de otra sesión.
  if (event.type === "vcs.branch.updated") {
    if (typeof data.branch === "string") {
      return { state: { ...state, branch: data.branch }, reload: false };
    }
    return unchanged;
  }

  if (!sessionId || data.sessionID !== sessionId) return unchanged;

  switch (event.type) {
    case "session.text.started": {
      const id = (data.assistantMessageID as string | undefined) ?? "stream";
      if (state.streaming.some((part) => part.id === id)) return unchanged;
      return {
        state: { ...state, streaming: [...state.streaming, { id, text: "", reasoning: "" }] },
        reload: false,
      };
    }
    case "session.model.selected": {
      const model = data.model as
        | { providerID?: unknown; id?: unknown; variant?: unknown }
        | null
        | undefined;
      if (model && typeof model.providerID === "string" && typeof model.id === "string") {
        const key = modelKey({ providerID: model.providerID, id: model.id });
        return {
          state: {
            ...state,
            modelChoice: key,
            variant: typeof model.variant === "string" ? model.variant : "",
            appliedModel: `${sessionId}|${key}|${model.variant ?? ""}`,
          },
          reload: false,
        };
      }
      return unchanged;
    }
    case "session.agent.selected": {
      if (typeof data.agent === "string") {
        return {
          state: {
            ...state,
            agentChoice: data.agent,
            appliedAgent: `${sessionId}|${data.agent}`,
          },
          reload: false,
        };
      }
      return unchanged;
    }
    case "session.text.delta":
    case "session.reasoning.delta": {
      const id = (data.assistantMessageID as string | undefined) ?? "stream";
      const delta = (data.delta as string | undefined) ?? "";
      const kind = event.type === "session.text.delta" ? "text" : "reasoning";
      return {
        state: { ...state, streaming: appendDelta(state.streaming, id, delta, kind) },
        reload: false,
      };
    }
    case "session.tool.called":
      return { state: { ...state, liveTools: state.liveTools + 1 }, reload: false };
    case "session.execution.started":
      return { state: { ...state, busy: true, liveTools: 0 }, reload: false };
    case "session.idle":
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return { state: { ...state, busy: false, liveTools: 0 }, reload: true };
    case "session.execution.failed": {
      const error = data.error as { message?: string; name?: string } | undefined;
      const message = error?.message ?? error?.name ?? "La ejecución falló";
      return { state: { ...state, busy: false, liveTools: 0, error: message }, reload: true };
    }
    default:
      return unchanged;
  }
}

/** Acciones de UI que también mutan el estado del stream (además de los eventos). */
export type ChatStreamAction =
  | { kind: "event"; event: ChatEvent; sessionId: string | null }
  | { kind: "reset" }
  | { kind: "workspaceChanged"; modelChoice: string; agentChoice: string; variant: string }
  | { kind: "modelChosen"; key: string; model: ModelOption | undefined }
  | { kind: "choices"; modelChoice?: string; agentChoice?: string; variant?: string }
  | {
      kind: "catalogResolved";
      models: ModelOption[];
      agents: AgentOption[];
      savedModel: string | null;
      savedAgent: string | null;
      workspaceModel: string | null | undefined;
      serverDefault: { providerID: string; id: string } | null;
    }
  | { kind: "executionStarted" }
  | { kind: "executionStopped" }
  | { kind: "busy"; busy: boolean }
  | { kind: "streamCleared" }
  | { kind: "error"; error: string | null }
  | { kind: "branch"; branch: string | null }
  | { kind: "applied"; model?: string; agent?: string };

export function chatStreamReducer(
  state: ChatStreamState,
  action: ChatStreamAction,
): ChatStreamState {
  switch (action.kind) {
    case "event":
      return applyChatEvent(state, action.event, action.sessionId).state;
    case "reset":
      return {
        ...state,
        streaming: [],
        busy: false,
        liveTools: 0,
        error: null,
        appliedModel: "",
        appliedAgent: "",
      };
    case "workspaceChanged":
      return {
        ...chatStreamReducer(state, { kind: "reset" }),
        modelChoice: action.modelChoice,
        agentChoice: action.agentChoice,
        variant: action.variant,
      };
    case "modelChosen":
      return {
        ...state,
        modelChoice: action.key,
        variant: effectiveVariant(state.variant, action.model),
      };
    case "choices":
      return {
        ...state,
        ...(action.modelChoice !== undefined ? { modelChoice: action.modelChoice } : {}),
        ...(action.agentChoice !== undefined ? { agentChoice: action.agentChoice } : {}),
        ...(action.variant !== undefined ? { variant: action.variant } : {}),
      };
    case "catalogResolved":
      return {
        ...state,
        modelChoice: resolveModelChoice({
          current: state.modelChoice,
          saved: action.savedModel,
          workspaceModel: action.workspaceModel,
          serverDefault: action.serverDefault,
          options: action.models,
        }),
        agentChoice: resolveAgentChoice({
          current: state.agentChoice,
          saved: action.savedAgent,
          options: action.agents,
        }),
      };
    case "executionStarted":
      return { ...state, busy: true, liveTools: 0 };
    case "executionStopped":
      return { ...state, busy: false, liveTools: 0 };
    case "busy":
      return state.busy === action.busy ? state : { ...state, busy: action.busy };
    case "streamCleared":
      return state.streaming.length === 0 ? state : { ...state, streaming: [] };
    case "error":
      return state.error === action.error ? state : { ...state, error: action.error };
    case "branch":
      return state.branch === action.branch ? state : { ...state, branch: action.branch };
    case "applied":
      return {
        ...state,
        appliedModel: action.model ?? state.appliedModel,
        appliedAgent: action.agent ?? state.appliedAgent,
      };
  }
}
