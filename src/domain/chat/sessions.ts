/**
 * Lista de sesiones de un workspace: modelo de la UI y funciones puras de
 * orden, búsqueda y detección de eventos que la invalidan. Sin React ni HTTP.
 */

/** Sesión tal como la consume el panel: título ya resuelto y uso acumulado. */
export type SessionSummary = {
  id: string;
  title: string;
  created: number;
  updated: number;
  cost: number;
  tokens: { input: number; output: number };
};

/** Payload del servidor ya estrechado en la frontera (`data/opencodePayloads`). */
export type RawSessionSummary = {
  id: string;
  title?: string;
  cost?: number;
  tokens?: { input?: number; output?: number };
  time?: { created?: number; updated?: number };
};

export const UNTITLED_SESSION = "Sesión sin título";

export function toSessionSummaries(raw: RawSessionSummary[]): SessionSummary[] {
  return raw.map((item) => ({
    id: item.id,
    title: item.title?.trim() || UNTITLED_SESSION,
    created: item.time?.created ?? 0,
    updated: item.time?.updated ?? item.time?.created ?? 0,
    cost: item.cost ?? 0,
    tokens: { input: item.tokens?.input ?? 0, output: item.tokens?.output ?? 0 },
  }));
}

/** Más reciente primero; las sesiones sin fecha quedan al final. */
export function sortSessionsByRecent(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => b.updated - a.updated);
}

/** Filtro por título, sin distinguir mayúsculas ni espacios sobrantes. */
export function filterSessions(sessions: SessionSummary[], query: string): SessionSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) => session.title.toLowerCase().includes(needle));
}

/** Eventos del servidor que pueden cambiar la lista (alta, baja, título o uso). */
const SESSION_LIST_EVENTS = new Set([
  "session.created",
  "session.deleted",
  "session.renamed",
  "session.moved",
  "session.forked",
  "session.archived",
  "session.metadata.updated",
]);

/** Eventos de fin de turno: el coste de la sesión ya cambió. */
const SESSION_USAGE_EVENTS = new Set([
  "session.idle",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
]);

export function eventTouchesSessionList(event: { type: string }): boolean {
  return SESSION_LIST_EVENTS.has(event.type) || SESSION_USAGE_EVENTS.has(event.type);
}
