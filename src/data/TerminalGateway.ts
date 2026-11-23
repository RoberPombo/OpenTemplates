/**
 * Adaptador del terminal del workspace: crea/listas PTYs con el SDK y abre el
 * WebSocket de conexión con un ticket efímero.
 *
 * Protocolo verificado contra opencode v2.3.0:
 * - `POST /api/pty/{id}/connect-token` con `x-opencode-ticket: 1` devuelve
 *   `{ticket, expires_in}` (60 s, un solo uso).
 * - WebSocket `ws://host/api/pty/{id}/connect?ticket=...&location[directory]=...`.
 * - Los frames de texto son salida UTF-8; los binarios que empiezan por `0x00`
 *   son control con JSON (`{"cursor":N}`), donde N es el offset absoluto del
 *   flujo y sirve para reanudar sin duplicar salida.
 * - La entrada se envía como frames de texto o binarios.
 */
import { OpenCode } from "@opencode/client";
import type {
  TerminalChannel,
  TerminalConnectInput,
  TerminalGateway,
  TerminalSize,
} from "../domain/repositories/TerminalGateway";
import type { TerminalInfo } from "../domain/terminal/terminals";
import type { ServerInfo } from "../types";
import { toTerminalInfo, toTerminalInfos, toTerminalTicket } from "./opencodePayloads";

export type TerminalFrame =
  | { kind: "data"; text: string; bytes: number }
  | { kind: "cursor"; cursor: number }
  | null;

const decoder = new TextDecoder();

function toBytes(data: unknown): Promise<Uint8Array | null> {
  if (Object.prototype.toString.call(data) === "[object ArrayBuffer]") {
    return Promise.resolve(new Uint8Array(data as ArrayBuffer));
  }
  if (ArrayBuffer.isView(data)) {
    return Promise.resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return Promise.resolve(null);
}

/** Decodifica un frame del WebSocket del PTY. */
export async function decodeTerminalFrame(data: unknown): Promise<TerminalFrame> {
  if (typeof data === "string") {
    return data.length > 0
      ? { kind: "data", text: data, bytes: new TextEncoder().encode(data).length }
      : null;
  }
  const bytes = await toBytes(data);
  if (!bytes || bytes.length === 0) return null;
  if (bytes[0] === 0) {
    try {
      const payload = JSON.parse(decoder.decode(bytes.subarray(1))) as { cursor?: unknown };
      return typeof payload.cursor === "number" && Number.isFinite(payload.cursor)
        ? { kind: "cursor", cursor: payload.cursor }
        : null;
    } catch {
      return null;
    }
  }
  return {
    kind: "data",
    text: decoder.decode(bytes),
    bytes: bytes.length,
  };
}

/** Ruta y query del WebSocket de un PTY; el ticket sustituye a la auth básica. */
export function terminalSocketUrl(
  baseUrl: string,
  input: { ptyID: string; directory: string; ticket: string; cursor?: number | null },
): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/pty/${encodeURIComponent(input.ptyID)}/connect`;
  url.search = "";
  url.searchParams.set("location[directory]", input.directory);
  url.searchParams.set("ticket", input.ticket);
  if (input.cursor !== undefined && input.cursor !== null) {
    url.searchParams.set("cursor", String(input.cursor));
  }
  return url.toString();
}

export function createTerminalGateway(server: ServerInfo): TerminalGateway {
  const token = btoa(`opencode:${server.password}`);
  const sdk = OpenCode.make({
    baseUrl: server.baseUrl,
    headers: { authorization: `Basic ${token}` },
  });

  async function connect(input: TerminalConnectInput): Promise<TerminalChannel> {
    const response = await sdk.pty.connect.token({
      location: input.location,
      ptyID: input.ptyID,
      "x-opencode-ticket": "1",
    });
    const ticket = toTerminalTicket(response);
    if (!ticket) throw new Error("El servidor no devolvió un ticket para el terminal");

    const url = terminalSocketUrl(server.baseUrl, {
      ptyID: input.ptyID,
      directory: input.location.directory,
      ticket: ticket.ticket,
      cursor: input.cursor ?? null,
    });

    return await new Promise<TerminalChannel>((resolve, reject) => {
      let opened = false;
      let closed = false;
      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      const timeout = globalThis.setTimeout(() => {
        if (opened) return;
        socket.close();
        reject(new Error("La conexión del terminal tardó demasiado"));
      }, 10_000);

      socket.addEventListener("open", () => {
        opened = true;
        globalThis.clearTimeout(timeout);
        resolve({
          send(data) {
            if (socket.readyState !== WebSocket.OPEN) return;
            if (typeof data === "string") socket.send(data);
            else socket.send(data.slice().buffer as ArrayBuffer);
          },
          close() {
            socket.close();
          },
        });
      });
      socket.addEventListener("message", (event) => {
        void decodeTerminalFrame(event.data).then((frame) => {
          if (!frame) return;
          if (frame.kind === "data")
            input.handlers.onData({ text: frame.text, bytes: frame.bytes });
          else input.handlers.onCursor(frame.cursor);
        });
      });
      socket.addEventListener("close", (event) => {
        globalThis.clearTimeout(timeout);
        if (closed) return;
        closed = true;
        input.handlers.onClose({ code: event.code, reason: event.reason });
        if (!opened) reject(new Error(event.reason || "No se pudo abrir el terminal"));
      });
      socket.addEventListener("error", () => {
        if (!opened) {
          globalThis.clearTimeout(timeout);
          reject(new Error("No se pudo abrir el terminal"));
        }
      });
    });
  }

  return {
    async list(location) {
      return toTerminalInfos(await sdk.pty.list({ location }));
    },
    async create(location, input) {
      const response = await sdk.pty.create({
        location,
        cwd: input.cwd,
        title: input.title,
        command: input.command,
        args: input.args,
      });
      const info = toTerminalInfo(response);
      if (!info) throw new Error("El servidor no devolvió el terminal creado");
      return info;
    },
    async remove(location, ptyID) {
      await sdk.pty.remove({ location, ptyID });
    },
    async resize(location, ptyID, size: TerminalSize) {
      await sdk.pty.update({ location, ptyID, size });
    },
    connect,
  };
}

export type { TerminalInfo };
