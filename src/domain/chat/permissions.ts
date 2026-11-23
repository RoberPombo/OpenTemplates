/**
 * Permisos que pide el agente: modelo del dock y funciones puras para
 * mantenerlo al día con los eventos del servidor. Sin React ni HTTP.
 */

/** Respuesta posible a una petición de permiso (`permission.reply`). */
export type PermissionDecision = "once" | "always" | "reject";

/** Origen del permiso: la tool y el mensaje que lo provocaron. */
export type PermissionSource = {
  type: string;
  messageID: string;
  id: string;
};

/** Petición pendiente ya estrechada en la frontera (`data/opencodePayloads`). */
export type PermissionRequest = {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  message?: string;
  metadata?: Record<string, unknown>;
  source?: PermissionSource;
};

const ACTION_LABELS: Record<string, string> = {
  bash: "Ejecutar un comando",
  shell: "Ejecutar un comando",
  read: "Leer un archivo",
  edit: "Editar un archivo",
  write: "Escribir un archivo",
  patch: "Aplicar cambios",
  webfetch: "Consultar una URL",
  websearch: "Buscar en la web",
  external_directory: "Acceder a otra carpeta",
  task: "Delegar en un subagente",
  skill: "Cargar una skill",
  mcp: "Usar un MCP",
};

/** Título legible de la acción pedida; cae al identificador si es desconocida. */
export function permissionTitle(request: PermissionRequest): string {
  return ACTION_LABELS[request.action] ?? `Permiso para ${request.action}`;
}

/** Motivo del agente, sin espacios sobrantes; `undefined` si no lo dio. */
export function permissionMessage(request: PermissionRequest): string | undefined {
  const message = request.message?.trim();
  return message ? message : undefined;
}

/** Recursos que el agente quiere tocar, sin entradas vacías. */
export function permissionResources(request: PermissionRequest): string[] {
  return request.resources.map((resource) => resource.trim()).filter(Boolean);
}

/**
 * Añade o reemplaza una petición por su id. El servidor puede reenviar
 * `permission.asked` para una petición ya listada; no debe duplicarse.
 */
export function upsertPermissionRequest(
  requests: PermissionRequest[],
  request: PermissionRequest,
): PermissionRequest[] {
  const index = requests.findIndex((item) => item.id === request.id);
  if (index === -1) return [...requests, request];
  const next = requests.slice();
  next[index] = request;
  return next;
}

/** Quita una petición resuelta; devuelve la misma lista si no estaba. */
export function removePermissionRequest(
  requests: PermissionRequest[],
  requestID: string,
): PermissionRequest[] {
  if (!requests.some((item) => item.id === requestID)) return requests;
  return requests.filter((item) => item.id !== requestID);
}
