/**
 * Exportar, importar y duplicar sesiones: formato del fichero, validación y
 * saneado. Lógica pura, sin React, Tauri ni HTTP.
 *
 * El fichero es un sobre con versión propia alrededor del `{info, messages}`
 * que devuelve y acepta `session.export/import` de opencode. La versión permite
 * rechazar ficheros de otra generación con un mensaje claro antes de enviar
 * mensajes rotos al servidor.
 *
 * El saneado es propio (no el `sanitize` del servidor): el servidor sustituye
 * el título, la ruta y **todos** los textos por `[redacted:...]`, así que la
 * sesión exportada deja de ser legible y de servir para compartir.
 */
import { errorText } from "../shared";

/** Marca que identifica un fichero de sesión de OpenTemplates. */
export const SESSION_FILE_FORMAT = "opentemplates.session";
/** Versión del formato que entiende esta build. */
export const SESSION_FILE_VERSION = 1;
/** Sustituto de una ruta absoluta del usuario en un export saneado. */
export const REDACTED_PATH = "<ruta>";
/** Sustituto de una credencial en un export saneado. */
export const REDACTED_SECRET = "<credencial>";
/** Título de reserva cuando el original no es utilizable. */
export const IMPORTED_TITLE = "Sesión importada";

/** `info` de la sesión tal como viaja en el fichero (forma del servidor). */
export type SessionTransferInfo = {
  id: string;
  title?: string;
  location?: { directory?: string } | null;
  [key: string]: unknown;
};

/** Mensaje de la sesión; el resto de campos lo decide opencode. */
export type SessionTransferMessage = {
  id: string;
  type: string;
  [key: string]: unknown;
};

/** Transferencia de sesión: la misma forma para exportar e importar. */
export type SessionTransfer = {
  info: SessionTransferInfo;
  messages: SessionTransferMessage[];
};

/** Fichero en disco: sobre versionado alrededor de la transferencia. */
export type SessionFile = {
  format: typeof SESSION_FILE_FORMAT;
  version: number;
  exportedAt: string;
  sanitized: boolean;
  session: SessionTransfer;
};

/** Payload listo para `session.import`. */
export type ImportPayload = {
  info: SessionTransferInfo;
  messages: SessionTransferMessage[];
  location: { directory: string };
};

export type ParseSessionFileResult = { ok: true; file: SessionFile } | { ok: false; error: string };

/** Patrones de credenciales frecuentes que no deben salir del equipo. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /\b(?:Bearer|Basic)\s+(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]{8,}/g,
];

/** Claves cuyo valor es una credencial completa. */
const SECRET_KEYS =
  /^(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|client[-_]?secret)$/i;

/** Rutas absolutas de un directorio personal (`/home/ana/...`, `C:\Users\...`). */
const USER_PATH =
  /(?:\/home\/[^\s"'`<>),;]+|\/Users\/[^\s"'`<>),;]+|\/root(?:\/[^\s"'`<>),;]*)?|[A-Za-z]:\\Users\\[^\s"'`<>),;]+)/g;

/** Título que el sanitize del servidor sustituye por un marcador. */
const SERVER_REDACTED_TITLE = /^\[redacted:session-title:/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function scrubText(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, REDACTED_SECRET);
  return result.replace(USER_PATH, REDACTED_PATH);
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  const object = record(value);
  if (!object) return value;
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(object)) {
    result[key] = SECRET_KEYS.test(key) ? REDACTED_SECRET : scrubValue(inner);
  }
  return result;
}

/**
 * Copia la transferencia sustituyendo rutas personales y credenciales por
 * marcadores. La ruta del workspace se sustituye siempre, aunque no sea del
 * home: el import la reemplaza por la del workspace de destino.
 */
export function sanitizeTransfer(transfer: SessionTransfer): SessionTransfer {
  const info = scrubValue({ ...transfer.info, location: { directory: REDACTED_PATH } });
  return {
    info: info as SessionTransferInfo,
    messages: transfer.messages.map((message) => scrubValue(message) as SessionTransferMessage),
  };
}

/** Sobre versionado listo para serializar; no toca la transferencia recibida. */
export function createSessionFile(
  transfer: SessionTransfer,
  options: { sanitized: boolean; now?: number },
): SessionFile {
  return {
    format: SESSION_FILE_FORMAT,
    version: SESSION_FILE_VERSION,
    exportedAt: new Date(options.now ?? Date.now()).toISOString(),
    sanitized: options.sanitized,
    session: transfer,
  };
}

/** JSON legible (dos espacios) con salto final, el formato que se escribe. */
export function serializeSessionFile(file: SessionFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function corruptMessage(position: number): ParseSessionFileResult {
  return {
    ok: false,
    error: `El archivo contiene un mensaje corrupto en la posición ${position}.`,
  };
}

/** Valida y normaliza un fichero de sesión leído de disco. */
export function parseSessionFile(contents: string): ParseSessionFileResult {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    return { ok: false, error: "El archivo no es JSON válido." };
  }
  const root = record(value);
  if (!root || root.format !== SESSION_FILE_FORMAT) {
    return { ok: false, error: "El archivo no es una sesión de OpenTemplates." };
  }
  const version = root.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { ok: false, error: "El archivo no indica una versión válida." };
  }
  if (version !== SESSION_FILE_VERSION) {
    return {
      ok: false,
      error: `La versión del archivo (${version}) no es compatible; esta app admite la ${SESSION_FILE_VERSION}.`,
    };
  }
  const exportedAt = text(root.exportedAt);
  const sanitized = typeof root.sanitized === "boolean" ? root.sanitized : false;
  if (!exportedAt) return { ok: false, error: "El archivo no indica cuándo se exportó." };

  const session = record(root.session);
  const info = session ? record(session.info) : null;
  const id = info ? text(info.id)?.trim() : null;
  if (!info || !id) {
    return { ok: false, error: "La sesión del archivo no tiene identificador." };
  }
  if (info.title !== undefined && typeof info.title !== "string") {
    return { ok: false, error: "El título de la sesión del archivo no es válido." };
  }
  if (!Array.isArray(session?.messages)) {
    return { ok: false, error: "El archivo no contiene la lista de mensajes de la sesión." };
  }
  const messages: SessionTransferMessage[] = [];
  for (const [index, item] of session.messages.entries()) {
    const message = record(item);
    if (!message || !text(message.id) || !text(message.type)) {
      return corruptMessage(index + 1);
    }
    messages.push(message as SessionTransferMessage);
  }

  return {
    ok: true,
    file: {
      format: SESSION_FILE_FORMAT,
      version,
      exportedAt,
      sanitized,
      session: { info: { ...info, id, title: text(info.title) ?? undefined }, messages },
    },
  };
}

/** Título a usar al importar: el del fichero, salvo que falte o esté redactado. */
export function resolveImportTitle(raw: string | undefined, fallback: string): string {
  const title = raw?.trim();
  if (!title || SERVER_REDACTED_TITLE.test(title)) return fallback;
  return title;
}

/**
 * Adapta la transferencia al workspace de destino: la sesión queda en su
 * carpeta y con un título utilizable, sin tocar ids ni mensajes.
 */
export function prepareImport(
  file: SessionFile,
  options: { directory: string; title?: string },
): ImportPayload {
  const title = resolveImportTitle(file.session.info.title, options.title ?? IMPORTED_TITLE);
  return {
    info: { ...file.session.info, title, location: { directory: options.directory } },
    messages: file.session.messages,
    location: { directory: options.directory },
  };
}

/**
 * Mensaje de la UI para un import fallido. El servidor responde `409` si el id
 * ya existe y `500` si los mensajes ya están en su base; los dos casos se
 * explican en vez de mostrar el texto crudo del transporte.
 */
export function importErrorMessage(error: unknown, sessionId: string): string {
  const raw = errorText(error);
  if (/already exists|conflict/i.test(raw)) {
    return `Ya existe una sesión con el identificador ${sessionId} en este workspace. Bórrala o importa el archivo en otro workspace.`;
  }
  if (/unexpectedstatus: 500|internal server error/i.test(raw)) {
    return "El workspace rechazó la importación: probablemente ya contiene esta sesión o sus mensajes. Borra la copia anterior e inténtalo de nuevo.";
  }
  return raw;
}

/** Nombre de fichero sugerido a partir del título y la fecha del export. */
export function suggestedSessionFileName(title: string, now: number = Date.now()): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const date = new Date(now);
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  return `${slug ? `sesion-${slug}` : "sesion"}-${stamp}.json`;
}
