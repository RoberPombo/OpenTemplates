// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { decodeTerminalFrame, terminalSocketUrl } from "../data/TerminalGateway";

function control(cursor: number) {
  const body = new TextEncoder().encode(JSON.stringify({ cursor }));
  const frame = new Uint8Array(body.length + 1);
  frame[0] = 0;
  frame.set(body, 1);
  return frame;
}

describe("frames del WebSocket del PTY", () => {
  test("los frames de texto son salida y cuentan sus bytes UTF-8", async () => {
    expect(await decodeTerminalFrame("hola\n")).toEqual({
      kind: "data",
      text: "hola\n",
      bytes: 5,
    });
    expect(await decodeTerminalFrame("ñ")).toEqual({ kind: "data", text: "ñ", bytes: 2 });
    expect(await decodeTerminalFrame("")).toBeNull();
  });

  test("el frame binario con 0x00 delante es el cursor de reconexión", async () => {
    expect(await decodeTerminalFrame(control(251).buffer)).toEqual({
      kind: "cursor",
      cursor: 251,
    });
    expect(await decodeTerminalFrame(control(0))).toEqual({ kind: "cursor", cursor: 0 });
  });

  test("los binarios sin cabecera de control son salida", async () => {
    const bytes = new TextEncoder().encode("salida");
    expect(await decodeTerminalFrame(bytes.buffer)).toEqual({
      kind: "data",
      text: "salida",
      bytes: 6,
    });
  });

  test("un control malformado no rompe la conexión", async () => {
    const frame = new Uint8Array([0, 0x7b, 0x7b]);
    expect(await decodeTerminalFrame(frame)).toBeNull();
  });
});

describe("URL del WebSocket del PTY", () => {
  test("usa /api/pty/{id}/connect con ticket y location en la query", () => {
    const url = new URL(
      terminalSocketUrl("http://127.0.0.1:4627", {
        ptyID: "pty_1",
        directory: "/tmp/demo",
        ticket: "abc 123",
        cursor: 42,
      }),
    );
    expect(url.protocol).toBe("ws:");
    expect(url.pathname).toBe("/api/pty/pty_1/connect");
    expect(url.searchParams.get("ticket")).toBe("abc 123");
    expect(url.searchParams.get("location[directory]")).toBe("/tmp/demo");
    expect(url.searchParams.get("cursor")).toBe("42");
  });

  test("omite el cursor cuando no hay offset confirmado y respeta https", () => {
    const url = new URL(
      terminalSocketUrl("https://localhost:1", {
        ptyID: "pty_9",
        directory: "/tmp/x",
        ticket: "t",
        cursor: null,
      }),
    );
    expect(url.protocol).toBe("wss:");
    expect(url.searchParams.get("cursor")).toBeNull();
  });
});
