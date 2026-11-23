/**
 * Estado puro del dock de terminal: pestañas por PTY y buffer de reconexión.
 *
 * El protocolo del servidor identifica el flujo de salida con un cursor
 * absoluto en bytes (frame binario `0x00` + `{"cursor":N}`). El cliente guarda
 * el último cursor confirmado y los bytes recibidos desde entonces; al
 * reconectar pide `cursor = confirmado + recibidos`, de modo que el servidor
 * reenvía solo lo que falta y no se duplica el scroll. Si nunca hubo cursor se
 * pide el buffer completo y se descarta el local para no pintar dos veces.
 */
export type TerminalState = "creating" | "connecting" | "connected" | "dropped" | "exited";

export type TerminalInfo = {
  id: string;
  title: string;
  status: "running" | "exited";
  cwd: string;
  pid: number;
  exitCode?: number;
};

export type TerminalTab = {
  id: string;
  title: string;
  state: TerminalState;
  exitCode?: number;
  error?: string;
};

export type TerminalBuffer = {
  text: string;
  /** Último cursor confirmado por el servidor, en bytes del flujo. */
  cursor: number | null;
  /** Bytes recibidos después de ese cursor. */
  bytesSinceCursor: number;
};

export const TERMINAL_BUFFER_LIMIT = 200_000;

export function emptyBuffer(): TerminalBuffer {
  return { text: "", cursor: null, bytesSinceCursor: 0 };
}

/**
 * Añade salida al buffer y recorta por el principio cuando supera el límite.
 * El recorte busca un salto de línea para no partir una secuencia ANSI.
 */
export function appendOutput(
  buffer: TerminalBuffer,
  text: string,
  bytes: number,
  limit: number = TERMINAL_BUFFER_LIMIT,
): TerminalBuffer {
  if (text.length === 0 && bytes <= 0) return buffer;
  let next = buffer.text + text;
  if (next.length > limit) {
    const tail = next.slice(next.length - limit);
    const newline = tail.indexOf("\n");
    next = newline >= 0 && newline + 1 < tail.length ? tail.slice(newline + 1) : tail;
  }
  return {
    text: next,
    cursor: buffer.cursor,
    bytesSinceCursor: buffer.bytesSinceCursor + Math.max(0, bytes),
  };
}

/** El servidor confirmó el cursor absoluto del flujo. */
export function acknowledgeCursor(buffer: TerminalBuffer, cursor: number): TerminalBuffer {
  if (!Number.isFinite(cursor) || cursor < 0) return buffer;
  return { ...buffer, cursor, bytesSinceCursor: 0 };
}

/**
 * Cursor inicial de una conexión sin offset pedido: el servidor envía su
 * posición (normalmente 0) y los bytes ya recibidos en esta conexión cuentan
 * desde ahí. No se resetean, o la reconexión repetiría ese primer tramo.
 */
export function establishCursor(buffer: TerminalBuffer, cursor: number): TerminalBuffer {
  if (!Number.isFinite(cursor) || cursor < 0) return buffer;
  return { ...buffer, cursor };
}

/** Offset absoluto desde el que pedir la salida que falta. */
export function resumeOffset(buffer: TerminalBuffer): number | null {
  if (buffer.cursor === null) return null;
  return buffer.cursor + buffer.bytesSinceCursor;
}

/**
 * Prepara la reconexión: con cursor conocido se conserva el texto local y se
 * pide solo lo nuevo; sin cursor el servidor reenvía su buffer retenido y el
 * texto local se descarta para no duplicarlo.
 */
export function prepareReconnect(buffer: TerminalBuffer): {
  cursor: number | null;
  text: string;
} {
  const cursor = resumeOffset(buffer);
  return { cursor, text: cursor === null ? "" : buffer.text };
}

export function addTab(tabs: readonly TerminalTab[], tab: TerminalTab): TerminalTab[] {
  if (tabs.some((item) => item.id === tab.id)) return [...tabs];
  return [...tabs, tab];
}

export function removeTab(tabs: readonly TerminalTab[], id: string): TerminalTab[] {
  return tabs.filter((tab) => tab.id !== id);
}

export function patchTab(
  tabs: readonly TerminalTab[],
  id: string,
  patch: Partial<Omit<TerminalTab, "id">>,
): TerminalTab[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab));
}

/**
 * Reconcilia las pestañas con `pty.list`. Las pestañas en creación se
 * conservan aunque el servidor aún no las liste. Las que ya no existen en el
 * servidor se descartan.
 */
export function mergeTerminalList(
  tabs: readonly TerminalTab[],
  infos: readonly TerminalInfo[],
): TerminalTab[] {
  const local = new Map(tabs.map((tab) => [tab.id, tab]));
  const merged = infos.map((info) => {
    const previous = local.get(info.id);
    const exited = info.status === "exited";
    if (previous) {
      return {
        ...previous,
        title: info.title || previous.title,
        state: exited ? "exited" : previous.state,
        exitCode: info.exitCode ?? previous.exitCode,
      } satisfies TerminalTab;
    }
    return {
      id: info.id,
      title: info.title || "Terminal",
      state: exited ? "exited" : "dropped",
      exitCode: info.exitCode,
    } satisfies TerminalTab;
  });
  const creating = tabs.filter(
    (tab) => tab.state === "creating" && !merged.some((item) => item.id === tab.id),
  );
  return [...merged, ...creating];
}

/** Siguiente título libre a partir de los ya usados (`Terminal N`). */
export function nextTerminalTitle(tabs: readonly TerminalTab[]): string {
  let max = 0;
  for (const tab of tabs) {
    const match = /^Terminal (\d+)$/.exec(tab.title.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `Terminal ${max + 1}`;
}
