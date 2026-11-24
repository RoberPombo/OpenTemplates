/**
 * Avisos nativos del chat: qué evento merece una notificación, con qué texto y
 * cuándo no repetirla. Lógica pura, sin React, Tauri, preferencias ni relojes
 * propios: el llamador aporta el foco, la hora y el último aviso.
 */

/** Evento del servidor con los payloads ya estrechados que usan los avisos. */
export type NotificationEvent = {
  type: string;
  data?: unknown;
  permission?: { id?: string; sessionID?: string } | null;
  form?: { id?: string; sessionID?: string } | null;
};

/** Motivo del aviso; decide el cuerpo y si entra en el throttling. */
export type NotificationKind =
  | "turn-finished"
  | "turn-failed"
  | "turn-interrupted"
  | "approval"
  | "question";

/** Aviso listo para el gateway, con el workspace y la sesión que lo provocan. */
export type NotificationPayload = {
  kind: NotificationKind;
  workspaceId: string;
  sessionId: string;
  title: string;
  body: string;
  /** Permiso o formulario que lo provoca, para no avisar dos veces del mismo. */
  requestId?: string;
};

export type NotificationContext = {
  workspace: { id: string; name: string };
  /** Título legible de la sesión del evento, si el llamador ya lo conoce. */
  sessionTitle?: string | null;
};

export type NotificationState = {
  enabled: boolean;
  focused: boolean;
  now: number;
  /** Último aviso de turno de esa sesión, si lo hubo. */
  lastNotifiedAt?: number | null;
  throttleMs?: number;
};

/** Tiempo mínimo entre avisos de turno de la misma sesión. */
export const NOTIFICATION_THROTTLE_MS = 10_000;

/** Valor persistido que activa la preferencia. */
export const NOTIFICATIONS_ON = "1";

/** La preferencia solo está activa con el valor explícito; el resto es off. */
export function notificationsEnabled(value: string | null): boolean {
  return value === NOTIFICATIONS_ON;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Sesión a la que pertenece el evento. Permisos y formularios llegan anidados
 * en el evento estrechado; el resto trae `sessionID` en `data`.
 */
export function eventSessionId(event: NotificationEvent): string | null {
  return (
    text(event.permission?.sessionID) ??
    text(event.form?.sessionID) ??
    text(record(event.data)?.sessionID)
  );
}

function sessionLabel(sessionId: string, sessionTitle?: string | null): string {
  const title = sessionTitle?.trim();
  return title ? title : `Sesión ${sessionId.slice(0, 6)}`;
}

/** Solo los avisos de turno se agrupan; permisos y preguntas son bloqueantes. */
export function isThrottledKind(kind: NotificationKind): boolean {
  return kind === "turn-finished" || kind === "turn-failed" || kind === "turn-interrupted";
}

/**
 * Traduce un evento a un aviso, sin mirar preferencias ni foco. Devuelve null
 * para eventos que no cambian lo que el usuario tiene que mirar.
 */
export function describeNotification(
  event: NotificationEvent,
  context: NotificationContext,
): NotificationPayload | null {
  const sessionId = eventSessionId(event);
  if (!sessionId) return null;

  const base = {
    workspaceId: context.workspace.id,
    sessionId,
    title: `${context.workspace.name} · ${sessionLabel(sessionId, context.sessionTitle)}`,
  };

  const permission = event.permission;
  if (permission || event.type === "permission.asked") {
    return {
      ...base,
      kind: "approval",
      body: "Esperando tu aprobación",
      ...(permission?.id ? { requestId: permission.id } : {}),
    };
  }

  const form = event.form;
  if (form || event.type === "form.created") {
    return {
      ...base,
      kind: "question",
      body: "El agente espera tu respuesta",
      ...(form?.id ? { requestId: form.id } : {}),
    };
  }

  switch (event.type) {
    case "session.idle":
    case "session.execution.succeeded":
      return { ...base, kind: "turn-finished", body: "Turno terminado" };
    case "session.execution.failed": {
      const error = text(record(record(event.data)?.error)?.message);
      return {
        ...base,
        kind: "turn-failed",
        body: error ? `El turno falló: ${error}` : "El turno falló",
      };
    }
    case "session.execution.interrupted":
      return { ...base, kind: "turn-interrupted", body: "Turno interrumpido" };
    default:
      return null;
  }
}

/**
 * Decide si toca avisar: preferencia activa, ventana sin foco y, en turnos
 * encadenados, al menos `throttleMs` desde el último aviso de la sesión.
 */
export function decideNotification(
  event: NotificationEvent,
  context: NotificationContext,
  state: NotificationState,
): NotificationPayload | null {
  const payload = describeNotification(event, context);
  if (!payload) return null;
  if (!state.enabled || state.focused) return null;

  if (isThrottledKind(payload.kind)) {
    const throttle = state.throttleMs ?? NOTIFICATION_THROTTLE_MS;
    if (state.lastNotifiedAt != null && state.now - state.lastNotifiedAt < throttle) {
      return null;
    }
  }

  return payload;
}
