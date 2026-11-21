/**
 * Mapeo de mensajes del servidor opencode al modelo de chat de la UI.
 * Contrato estructural en la frontera: el payload crudo se tipa aquí, sin `any`.
 */

export type ToolActivity = {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  detail: string;
};

export type ChatMessage = {
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

export type RawToolState = {
  status?: string;
  input?: Record<string, unknown>;
};

export type RawPart = {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  state?: RawToolState;
};

export type RawMessage = {
  type?: string;
  id: string;
  text?: string;
  content?: RawPart[];
  model?: { providerID: string; id: string };
  agent?: unknown;
  time?: { created?: number; completed?: number };
};

/**
 * Mensaje crudo del servidor con los campos de consumo que lee el inspector.
 * El adaptador entrega esta forma ya estrechada; el mapeo de chat solo usa
 * el subconjunto de `RawMessage`.
 */
export type RawSessionMessage = RawMessage & {
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    cache: { read: number; write: number };
  };
};

export function toolDetail(state: RawToolState | undefined): string {
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

export function toToolActivity(part: RawPart, index: number): ToolActivity {
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

export function toChatMessages(raw: RawMessage[]): ChatMessage[] {
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

    const content = item.content ?? [];
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
