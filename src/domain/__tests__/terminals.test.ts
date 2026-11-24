// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  acknowledgeCursor,
  addTab,
  appendOutput,
  emptyBuffer,
  establishCursor,
  mergeTerminalList,
  nextTerminalTitle,
  patchTab,
  prepareReconnect,
  removeTab,
  resumeOffset,
  type TerminalInfo,
  type TerminalTab,
} from "../terminal/terminals";

function tab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return { id: "pty_1", title: "Terminal 1", state: "connected", ...overrides };
}

function info(overrides: Partial<TerminalInfo> = {}): TerminalInfo {
  return {
    id: "pty_1",
    title: "Terminal 1",
    status: "running",
    cwd: "/tmp/demo",
    pid: 11,
    ...overrides,
  };
}

describe("buffer de reconexión", () => {
  test("acumula salida y bytes desde el último cursor", () => {
    let buffer = emptyBuffer();
    buffer = appendOutput(buffer, "hola\n", 5);
    buffer = appendOutput(buffer, "mundo", 5);
    expect(buffer.text).toBe("hola\nmundo");
    expect(buffer.cursor).toBeNull();
    expect(buffer.bytesSinceCursor).toBe(10);
    expect(resumeOffset(buffer)).toBeNull();

    buffer = acknowledgeCursor(buffer, 120);
    expect(buffer.cursor).toBe(120);
    expect(buffer.bytesSinceCursor).toBe(0);
    expect(resumeOffset(buffer)).toBe(120);

    buffer = appendOutput(buffer, "más\n", 4);
    expect(resumeOffset(buffer)).toBe(124);
  });

  test("sin cursor confirmado la reconexión descarta el texto local", () => {
    let buffer = appendOutput(emptyBuffer(), "viejo\n", 6);
    expect(prepareReconnect(buffer)).toEqual({ cursor: null, text: "" });

    buffer = acknowledgeCursor(buffer, 40);
    buffer = appendOutput(buffer, "nuevo\n", 6);
    expect(prepareReconnect(buffer)).toEqual({ cursor: 46, text: "viejo\nnuevo\n" });
  });

  test("el cursor inicial conserva los bytes ya recibidos en la conexión", () => {
    let buffer = appendOutput(emptyBuffer(), "prompt$ ", 8);
    buffer = establishCursor(buffer, 0);
    expect(buffer.cursor).toBe(0);
    expect(buffer.bytesSinceCursor).toBe(8);
    expect(resumeOffset(buffer)).toBe(8);

    buffer = acknowledgeCursor(buffer, 120);
    expect(resumeOffset(buffer)).toBe(120);
  });

  test("recorta por el límite buscando un salto de línea", () => {
    let buffer = emptyBuffer();
    buffer = appendOutput(buffer, "linea uno\nlinea dos\nlinea tres\n", 33, 24);
    expect(buffer.text.startsWith("linea uno")).toBe(false);
    expect(buffer.text.endsWith("linea tres\n")).toBe(true);
    expect(buffer.text.startsWith("linea dos")).toBe(true);
  });

  test("ignora cursores inválidos", () => {
    const buffer = acknowledgeCursor(emptyBuffer(), Number.NaN);
    expect(buffer.cursor).toBeNull();
    expect(acknowledgeCursor(emptyBuffer(), -3).cursor).toBeNull();
  });
});

describe("pestañas de terminal", () => {
  test("alta, cambio de estado y cierre conservan el orden", () => {
    let tabs = addTab([], tab({ id: "a" }));
    tabs = addTab(tabs, tab({ id: "b", title: "Terminal 2" }));
    tabs = addTab(tabs, tab({ id: "a", title: "Duplicada" }));
    expect(tabs.map((item) => item.id)).toEqual(["a", "b"]);

    tabs = patchTab(tabs, "b", { state: "dropped", error: "caída" });
    expect(tabs[1]).toMatchObject({ state: "dropped", error: "caída" });
    expect(removeTab(tabs, "a").map((item) => item.id)).toEqual(["b"]);
  });

  test("reconcilia con pty.list sin duplicar ni perder las que están creándose", () => {
    const tabs = [
      tab({ id: "a", state: "connected" }),
      tab({ id: "b", state: "exited", exitCode: 1 }),
      tab({ id: "c", title: "Terminal 3", state: "creating" }),
    ];
    const merged = mergeTerminalList(tabs, [
      info({ id: "a", title: "Terminal 1 renombrada" }),
      info({ id: "b", status: "exited", exitCode: 2 }),
      info({ id: "d", title: "Terminal 4" }),
    ]);
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "d", "c"]);
    expect(merged[0]).toMatchObject({ state: "connected", title: "Terminal 1 renombrada" });
    expect(merged[1]).toMatchObject({ state: "exited", exitCode: 2 });
    expect(merged[2]).toMatchObject({ state: "dropped", title: "Terminal 4" });
  });

  test("numera la siguiente terminal a partir de los títulos existentes", () => {
    expect(nextTerminalTitle([])).toBe("Terminal 1");
    expect(nextTerminalTitle([tab({ title: "Terminal 2" }), tab({ title: "bash" })])).toBe(
      "Terminal 3",
    );
  });
});
