// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  toCatalogAgents,
  toCatalogModels,
  toSessionMessages,
  toUsageLimits,
} from "../data/opencodePayloads";
import { toModelOptions, toAgentOptions } from "../domain/chat/selection";
import { toChatMessages } from "../domain/chat/messages";
import { toSessionUsage } from "../domain/chat/usage";

// Caracterización del estrechado de payloads en la frontera con opencode:
// el adaptador es el único que conoce la forma del servidor.

describe("toCatalogModels", () => {
  test("mapea el catálogo y conserva modelo, variantes y límite de contexto", () => {
    const models = toCatalogModels([
      {
        providerID: "anthropic",
        id: "claude",
        modelID: "claude-sonnet",
        name: "Claude",
        enabled: true,
        type: "chat",
        variants: [{ id: "high" }, { id: "low" }],
        limit: { context: 200_000 },
      },
    ]);

    expect(models).toEqual([
      {
        providerID: "anthropic",
        id: "claude",
        modelID: "claude-sonnet",
        name: "Claude",
        enabled: true,
        type: "chat",
        variants: [{ id: "high" }, { id: "low" }],
        limit: { context: 200_000 },
      },
    ]);
    expect(toModelOptions(models)[0]).toMatchObject({ key: "anthropic/claude", name: "Claude" });
  });

  test("descarta entradas inválidas y usa el id como nombre de reserva", () => {
    const models = toCatalogModels([
      null,
      { id: "sin-proveedor" },
      { providerID: "openai", id: "gpt" },
      { providerID: "openai", id: "roto", variants: "no-es-lista" },
    ]);

    expect(models.map((model) => `${model.providerID}/${model.id}`)).toEqual([
      "openai/gpt",
      "openai/roto",
    ]);
    expect(models[0]?.name).toBe("gpt");
    expect(models[1]?.variants).toEqual([]);
    expect(toCatalogModels(undefined)).toEqual([]);
  });
});

describe("toCatalogAgents", () => {
  test("mapea agentes y normaliza campos opcionales", () => {
    expect(
      toCatalogAgents([
        { id: "build", name: "Build", mode: "primary", hidden: false },
        { id: "plan", name: "Plan", mode: "subagent" },
      ]),
    ).toEqual([
      { id: "build", name: "Build", mode: "primary", hidden: false },
      { id: "plan", name: "Plan", mode: "subagent", hidden: undefined },
    ]);
    expect(
      toAgentOptions(toCatalogAgents([{ id: "build", name: "Build", mode: "primary" }])),
    ).toEqual([{ id: "build", name: "Build" }]);
  });

  test("descarta agentes sin id o sin nombre", () => {
    expect(toCatalogAgents([null, { id: "x" }, { name: "Y" }, { id: "z", name: "Z" }])).toEqual([
      { id: "z", name: "Z", hidden: undefined, mode: undefined },
    ]);
  });
});

describe("toSessionMessages", () => {
  test("mapea mensajes de usuario y asistente con contenido, modelo y consumo", () => {
    const messages = toSessionMessages([
      { type: "user", id: "u1", text: "hola", time: { created: 1 } },
      {
        type: "assistant",
        id: "a1",
        time: { created: 2, completed: 30 },
        model: { providerID: "anthropic", id: "claude" },
        agent: "build",
        cost: 0.02,
        tokens: { input: 10, output: 5, cache: { read: 3, write: 2 } },
        content: [
          { type: "text", text: "respuesta" },
          {
            type: "tool",
            id: "t1",
            name: "bash",
            state: { status: "completed", input: { command: "ls" } },
          },
        ],
      },
    ]);

    expect(messages[0]).toMatchObject({
      type: "user",
      id: "u1",
      text: "hola",
      time: { created: 1, completed: undefined },
    });
    expect(messages[1]).toMatchObject({
      type: "assistant",
      id: "a1",
      model: { providerID: "anthropic", id: "claude" },
      agent: "build",
      cost: 0.02,
      tokens: { input: 10, output: 5, cache: { read: 3, write: 2 } },
    });
    expect(messages[1]?.content?.[1]?.state?.input).toEqual({ command: "ls" });

    // El mapeo de dominio produce el mismo resultado que antes del estrechado.
    expect(toChatMessages(messages)).toMatchObject([
      { id: "u1", role: "user", text: "hola", created: 1 },
      {
        id: "a1",
        role: "assistant",
        text: "respuesta",
        model: { providerID: "anthropic", id: "claude" },
        agent: "build",
        completed: 30,
      },
    ]);
    expect(toSessionUsage(messages, { cost: 0.5 })).toMatchObject({
      cost: 0.5,
      input: 10,
      output: 5,
      cacheRead: 3,
      cacheWrite: 2,
    });
  });

  test("descarta mensajes sin id y tolera contenido incompleto", () => {
    expect(toSessionMessages([null, { type: "user" }, { id: "a1", content: "texto" }])).toEqual([
      expect.objectContaining({ id: "a1", content: [] }),
    ]);
    expect(toSessionMessages(undefined)).toEqual([]);
  });
});

describe("toUsageLimits", () => {
  test("mapea ventanas go y presupuestos", () => {
    expect(
      toUsageLimits({
        go: {
          rolling: { percent: 12.5, resetsAt: 100 },
          weekly: { percent: 40, resetsAt: 200 },
          monthly: { percent: 80, resetsAt: 300 },
        },
        budgets: [{ id: "plan", limit: 1000, spent: 250, resetsAt: 400 }],
      }),
    ).toEqual({
      go: {
        rolling: { percent: 12.5, resetsAt: 100 },
        weekly: { percent: 40, resetsAt: 200 },
        monthly: { percent: 80, resetsAt: 300 },
      },
      budgets: [{ id: "plan", limit: 1000, spent: 250, resetsAt: 400 }],
    });
  });

  test("sin payload devuelve null y descarta medidores o presupuestos inválidos", () => {
    expect(toUsageLimits(null)).toBeNull();
    expect(toUsageLimits(undefined)).toBeNull();
    expect(
      toUsageLimits({ go: { rolling: { percent: 1 } }, budgets: [{ id: "sin-datos" }] }),
    ).toEqual({ go: { rolling: null, weekly: null, monthly: null }, budgets: [] });
  });
});
