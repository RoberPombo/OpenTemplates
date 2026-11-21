/**
 * Uso de la sesión de chat: mapeo desde los mensajes del servidor y ratios
 * de contexto/caché para el inspector.
 */

export type SessionUsage = {
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  model: { providerID: string; id: string } | null;
};

export type RawAssistantMessage = {
  type?: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    cache: { read: number; write: number };
  };
  model?: { providerID: string; id: string };
};

/** Primer asistente con tokens (la lista llega en orden descendente). */
export function toSessionUsage(
  messages: RawAssistantMessage[],
  info: { cost?: number } | null,
): SessionUsage | null {
  const assistant = messages.find((item) => item.type === "assistant" && item.tokens);
  if (!assistant?.tokens) return null;
  return {
    cost: info?.cost ?? assistant.cost ?? 0,
    input: assistant.tokens.input,
    output: assistant.tokens.output,
    cacheRead: assistant.tokens.cache.read,
    cacheWrite: assistant.tokens.cache.write,
    model: assistant.model ?? null,
  };
}

export function contextRatio(
  session: SessionUsage | null,
  contextLimit: number | null | undefined,
): number | null {
  if (!session || !contextLimit) return null;
  const used = session.input + session.cacheRead + session.cacheWrite;
  return used / contextLimit;
}

export function cacheRatio(session: SessionUsage | null): number | null {
  if (!session) return null;
  const total = session.input + session.cacheRead;
  return total > 0 ? session.cacheRead / total : null;
}

/** Medidor de consumo de una ventana (rolling/semanal/mensual). */
export type UsageMeter = { percent: number; resetsAt: number };

/** Presupuesto de gasto con su ventana de reinicio. */
export type UsageBudget = { id: string; limit: number; spent: number; resetsAt: number };

/** Límites de uso del proveedor que pinta el inspector. */
export type UsageLimits = {
  go?: {
    rolling?: UsageMeter | null;
    weekly?: UsageMeter | null;
    monthly?: UsageMeter | null;
  } | null;
  budgets?: UsageBudget[] | null;
};
