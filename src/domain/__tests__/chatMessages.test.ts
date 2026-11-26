// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  mergeChatMessages,
  toChatMessages,
  toToolActivity,
  toolDetail,
  type RawMessage,
} from "../chat/messages";

describe("toolDetail", () => {
  test("prioridad: command > description > filePath > path > pattern > query > url", () => {
    expect(toolDetail({ input: { command: "ls", description: "d" } })).toBe("ls");
    expect(toolDetail({ input: { description: "d", filePath: "f" } })).toBe("d");
    expect(toolDetail({ input: { filePath: "f", path: "p" } })).toBe("f");
    expect(toolDetail({ input: { path: "p", pattern: "x" } })).toBe("p");
    expect(toolDetail({ input: { pattern: "x", query: "q" } })).toBe("x");
    expect(toolDetail({ input: { query: "q", url: "u" } })).toBe("q");
    expect(toolDetail({ input: { url: "u" } })).toBe("u");
  });

  test("solo la primera línea, máximo 160 caracteres", () => {
    expect(toolDetail({ input: { command: "echo hola\necho adios" } })).toBe("echo hola");
    const long = "a".repeat(200);
    expect(toolDetail({ input: { command: long } })).toBe("a".repeat(160));
  });

  test("input no string o ausente devuelve vacío", () => {
    expect(toolDetail({ input: { command: 42 } })).toBe("");
    expect(toolDetail({ input: {} })).toBe("");
    expect(toolDetail({})).toBe("");
    expect(toolDetail(undefined)).toBe("");
  });
});

describe("toToolActivity", () => {
  test("estados: error, running/streaming → running, resto completed", () => {
    expect(toToolActivity({ state: { status: "error" } }, 0).status).toBe("error");
    expect(toToolActivity({ state: { status: "running" } }, 0).status).toBe("running");
    expect(toToolActivity({ state: { status: "streaming" } }, 0).status).toBe("running");
    expect(toToolActivity({ state: { status: "completed" } }, 0).status).toBe("completed");
    expect(toToolActivity({ state: {} }, 0).status).toBe("completed");
    expect(toToolActivity({}, 0).status).toBe("completed");
  });

  test("id y name con fallbacks", () => {
    expect(toToolActivity({ id: "t1", name: "bash" }, 0)).toMatchObject({ id: "t1", name: "bash" });
    expect(toToolActivity({ name: "bash" }, 3)).toMatchObject({ id: "bash-3", name: "bash" });
    expect(toToolActivity({}, 3)).toMatchObject({ id: "tool-3", name: "tool" });
  });

  test("detail sale del state.input", () => {
    expect(toToolActivity({ state: { input: { command: "pnpm test" } } }, 0).detail).toBe(
      "pnpm test",
    );
  });
});

describe("toChatMessages", () => {
  const user: RawMessage = {
    type: "user",
    id: "u1",
    text: "hola",
    time: { created: 100 },
  };

  const assistant: RawMessage = {
    type: "assistant",
    id: "a1",
    content: [
      { type: "text", text: "respuesta" },
      { type: "reasoning", text: "pensando" },
      {
        type: "tool",
        id: "t1",
        name: "bash",
        state: { status: "completed", input: { command: "ls" } },
      },
    ],
    model: { providerID: "anthropic", id: "claude" },
    agent: "build",
    time: { created: 200, completed: 900 },
  };

  test("mapea usuario y asistente con text, reasoning, tools, model y agent", () => {
    const messages = toChatMessages([assistant, user]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      id: "u1",
      role: "user",
      text: "hola",
      reasoning: "",
      tools: [],
      created: 100,
    });
    expect(messages[1]).toEqual({
      id: "a1",
      role: "assistant",
      text: "respuesta",
      reasoning: "pensando",
      tools: [{ id: "t1", name: "bash", status: "completed", detail: "ls" }],
      model: { providerID: "anthropic", id: "claude" },
      agent: "build",
      created: 200,
      completed: 900,
    });
  });

  test("ordena por created ascendente", () => {
    const late: RawMessage = { type: "user", id: "u2", text: "tarde", time: { created: 300 } };
    expect(toChatMessages([late, assistant, user]).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  test("varios parts de text/reasoning se unen con doble salto y trim", () => {
    const multi: RawMessage = {
      type: "assistant",
      id: "a2",
      content: [
        { type: "text", text: " uno " },
        { type: "text", text: "dos " },
        { type: "reasoning", text: " r1 " },
        { type: "reasoning", text: "r2 " },
      ],
    };
    const [message] = toChatMessages([multi]);
    expect(message.text).toBe("uno \n\ndos");
    expect(message.reasoning).toBe("r1 \n\nr2");
  });

  test("asistente vacío (sin text, reasoning ni tools) se descarta", () => {
    const empty: RawMessage = { type: "assistant", id: "a3", content: [] };
    const onlySpaces: RawMessage = {
      type: "assistant",
      id: "a4",
      content: [{ type: "text", text: "   " }],
    };
    expect(toChatMessages([empty, onlySpaces])).toHaveLength(0);
  });

  test("tipos desconocidos se ignoran", () => {
    expect(toChatMessages([{ type: "system", id: "s1" } as RawMessage])).toHaveLength(0);
  });

  test("defaults: text vacío, created 0, agent no string → undefined, model ausente", () => {
    const bare: RawMessage = { type: "user", id: "u3" };
    const [message] = toChatMessages([bare]);
    expect(message).toEqual({
      id: "u3",
      role: "user",
      text: "",
      reasoning: "",
      tools: [],
      created: 0,
    });

    const oddAgent: RawMessage = {
      type: "assistant",
      id: "a5",
      content: [{ type: "text", text: "x" }],
      agent: 42,
    };
    const [mapped] = toChatMessages([oddAgent]);
    expect(mapped.agent).toBeUndefined();
    expect(mapped.model).toBeUndefined();
    expect(mapped.completed).toBeUndefined();
  });
});

describe("mergeChatMessages", () => {
  const message = (id: string, created: number, text = id) => ({
    id,
    role: "user" as const,
    text,
    reasoning: "",
    tools: [],
    created,
  });

  test("añade los nuevos al final conservando el orden por created", () => {
    const current = [message("u1", 100), message("a1", 200)];
    const merged = mergeChatMessages(current, [message("u2", 300)]);
    expect(merged.map((item) => item.id)).toEqual(["u1", "a1", "u2"]);
  });

  test("conserva las referencias de los mensajes ya presentes", () => {
    const current = [message("u1", 100)];
    const merged = mergeChatMessages(current, [message("u2", 200)]);
    expect(merged[0]).toBe(current[0]);
  });

  test("sustituye por id si el servidor reenvía un mensaje actualizado", () => {
    const current = [message("a1", 200, "parcial")];
    const merged = mergeChatMessages(current, [message("a1", 200, "final")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("final");
  });

  test("sin mensajes nuevos devuelve el mismo array", () => {
    const current = [message("u1", 100)];
    expect(mergeChatMessages(current, [])).toBe(current);
  });
});
