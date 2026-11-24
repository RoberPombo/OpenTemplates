/**
 * Modelo puro del panel de cambios y ficheros: estados de git, resumen por
 * fichero, parseo de parches unificados y árbol de ficheros. Sin React ni HTTP.
 */

/** Estado de un fichero respecto a la referencia (`git diff --name-status`). */
export type FileChangeStatus = "added" | "deleted" | "modified";

/** Fila del listado: lo que da `vcs.status` y la cabecera de un parche. */
export type FileChangeSummary = {
  file: string;
  additions: number;
  deletions: number;
  status: FileChangeStatus;
};

/** Fichero con su parche unificado (`vcs.diff` o `session.diff`). */
export type FileChange = FileChangeSummary & {
  patch: string;
  /** El servidor dejó de listar o comprobar entradas (carpeta incompleta). */
  more?: boolean;
};

/** Contadores agregados que pinta la cabecera del panel. */
export type ChangesSummary = {
  files: number;
  additions: number;
  deletions: number;
  added: number;
  modified: number;
  deleted: number;
};

export function summarizeChanges(files: readonly FileChangeSummary[]): ChangesSummary {
  const summary: ChangesSummary = {
    files: files.length,
    additions: 0,
    deletions: 0,
    added: 0,
    modified: 0,
    deleted: 0,
  };
  for (const file of files) {
    summary.additions += file.additions;
    summary.deletions += file.deletions;
    summary[file.status] += 1;
  }
  return summary;
}

/** Etiqueta en español del estado, para el chip y los `title`. */
export function changeStatusLabel(status: FileChangeStatus): string {
  switch (status) {
    case "added":
      return "añadido";
    case "deleted":
      return "borrado";
    case "modified":
      return "modificado";
  }
}

/** Inicial que usa el chip compacto del listado. */
export function changeStatusCode(status: FileChangeStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

export function fileDisplayName(file: string): string {
  const parts = file.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? file;
}

export function fileDirectory(file: string): string {
  const parts = file.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

/** Una línea del visor: contexto, alta, baja o metadatos del parche. */
export type DiffLineKind = "context" | "add" | "delete" | "hunk" | "meta";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const META_PREFIXES = [
  "diff --git ",
  "index ",
  "new file mode ",
  "deleted file mode ",
  "old mode ",
  "new mode ",
  "similarity index ",
  "dissimilarity index ",
  "rename from ",
  "rename to ",
  "copy from ",
  "copy to ",
  "Binary files ",
  "GIT binary patch",
];

function isMetaLine(line: string) {
  return (
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("\\ No newline") ||
    META_PREFIXES.some((prefix) => line.startsWith(prefix))
  );
}

/**
 * Convierte un parche unificado en líneas con numeración de ambos lados.
 * Tolera parches truncados y entradas que no son un diff: lo que no reconoce
 * queda como metadato, nunca rompe el visor.
 */
export function parsePatch(patch: string): DiffLine[] {
  if (!patch) return [];
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      result.push({ kind: "hunk", text: line, oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      result.push({ kind: "meta", text: line, oldLine: null, newLine: null });
      continue;
    }
    if (!inHunk && isMetaLine(line)) {
      result.push({ kind: "meta", text: line, oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith("\\")) {
      result.push({ kind: "meta", text: line, oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith("+")) {
      result.push({ kind: "add", text: line.slice(1), oldLine: null, newLine: newLine++ });
      continue;
    }
    if (line.startsWith("-")) {
      result.push({ kind: "delete", text: line.slice(1), oldLine: oldLine++, newLine: null });
      continue;
    }
    if (inHunk && (line.startsWith(" ") || line === "")) {
      result.push({ kind: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
      continue;
    }
    result.push({ kind: "meta", text: line, oldLine: null, newLine: null });
  }
  return result;
}

/** Entrada del árbol de ficheros (`file.list`). */
export type FileEntryType = "file" | "directory";

export type FileTreeEntry = {
  path: string;
  type: FileEntryType;
};

/** Directorios antes que ficheros y orden alfabético dentro de cada grupo. */
export function sortFileEntries(entries: readonly FileTreeEntry[]): FileTreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return fileDisplayName(a.path).localeCompare(fileDisplayName(b.path), "es", {
      sensitivity: "base",
    });
  });
}

/** Contenido ya decodificado de `file.read`. */
export type FileContent = {
  kind: "text" | "binary";
  text: string;
  bytes: number;
  truncated: boolean;
};

/** Tope de visualización; el servidor no ofrece rangos, así que se corta aquí. */
export const FILE_CONTENT_LIMIT = 256 * 1024;

function bytesOf(payload: unknown): Uint8Array | null {
  if (typeof payload === "string") return new TextEncoder().encode(payload);
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  return null;
}

function looksBinary(bytes: Uint8Array) {
  const sample = Math.min(bytes.length, 8_000);
  for (let index = 0; index < sample; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

/**
 * Decodifica `file.read` como texto o marca binario. Corta en `limit` bytes y
 * avisa de que el fichero continúa, para no bloquear la UI con ficheros grandes.
 */
export function decodeFileContent(payload: unknown, limit = FILE_CONTENT_LIMIT): FileContent {
  const bytes = bytesOf(payload);
  if (!bytes) return { kind: "binary", text: "", bytes: 0, truncated: false };
  if (looksBinary(bytes)) {
    return { kind: "binary", text: "", bytes: bytes.length, truncated: false };
  }
  const visible = bytes.subarray(0, Math.max(0, limit));
  return {
    kind: "text",
    text: new TextDecoder().decode(visible),
    bytes: bytes.length,
    truncated: bytes.length > visible.length,
  };
}

/** Eventos del servidor que indican fin de turno y, por tanto, cambios nuevos. */
const TURN_END_EVENTS = new Set([
  "session.idle",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
]);

export function isTurnEndEvent(event: { type: string }): boolean {
  return TURN_END_EVENTS.has(event.type);
}
