/**
 * Puerto del terminal por workspace. Modela PTYs y el canal de bytes ya
 * resuelto: el adaptador conoce el SDK, el ticket y el WebSocket; dominio y
 * presentación solo ven datos, cursores y cierres.
 */
import type { TerminalInfo } from "../terminal/terminals";

export type TerminalLocation = { directory: string };

export type TerminalSize = { cols: number; rows: number };

export type TerminalData = {
  /** Salida ya decodificada como texto UTF-8. */
  text: string;
  /** Bytes originales del frame (para el cursor de reconexión). */
  bytes: number;
};

export type TerminalClose = {
  code: number;
  reason: string;
};

export type TerminalHandlers = {
  onData(chunk: TerminalData): void;
  /** Cursor absoluto del flujo que confirma el servidor al conectar. */
  onCursor(offset: number): void;
  onClose(close: TerminalClose): void;
};

export type TerminalConnectInput = {
  location: TerminalLocation;
  ptyID: string;
  /** Offset desde el que continuar; `null` pide el buffer retenido completo. */
  cursor?: number | null;
  handlers: TerminalHandlers;
};

/** Canal de entrada de una conexión abierta. La salida llega por handlers. */
export type TerminalChannel = {
  send(data: string | Uint8Array): void;
  close(): void;
};

export interface TerminalGateway {
  list(location: TerminalLocation): Promise<TerminalInfo[]>;
  create(
    location: TerminalLocation,
    input: { cwd: string; title?: string; command?: string; args?: string[] },
  ): Promise<TerminalInfo>;
  remove(location: TerminalLocation, ptyID: string): Promise<void>;
  resize(location: TerminalLocation, ptyID: string, size: TerminalSize): Promise<void>;
  connect(input: TerminalConnectInput): Promise<TerminalChannel>;
}
