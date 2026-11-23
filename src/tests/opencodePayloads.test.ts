// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  toAgentForm,
  toAgentForms,
  toCatalogAgents,
  toCatalogModels,
  toPermissionRequest,
  toPermissionRequests,
  toServerEvent,
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

    expect(models[0]).toMatchObject({
      providerID: "anthropic",
      id: "claude",
      modelID: "claude-sonnet",
      name: "Claude",
      enabled: true,
      type: "chat",
      variants: [{ id: "high" }, { id: "low" }],
      limit: { context: 200_000 },
      details: { key: "anthropic/claude", name: "Claude" },
    });
    expect(toModelOptions(models)[0]).toMatchObject({ key: "anthropic/claude", name: "Claude" });
  });

  test("construye la ficha con coste, modalidades, límites y fecha", () => {
    const [model] = toCatalogModels([
      {
        providerID: "openai",
        id: "gpt",
        name: "GPT",
        family: "gpt",
        status: "active",
        capabilities: {
          tools: true,
          input: ["text", "image"],
          output: ["text"],
          temperature: false,
        },
        cost: [{ input: 1.5, output: 6, cache: { read: 0.1, write: 0.2 } }],
        limit: { context: 128_000, input: 120_000, output: 8_000 },
        time: { released: 1_700_000_000_000 },
      },
    ]);

    expect(model?.details).toMatchObject({
      key: "openai/gpt",
      providerID: "openai",
      id: "gpt",
      name: "GPT",
      family: "gpt",
      status: "active",
      tools: true,
      temperature: false,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      cost: { input: 1.5, output: 6, cacheRead: 0.1, cacheWrite: 0.2 },
      limit: { context: 128_000, input: 120_000, output: 8_000 },
      releaseDate: "2023-11-14",
    });
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

describe("permisos", () => {
  test("mapea una petición real con recursos, metadata y origen", () => {
    const request = toPermissionRequest({
      id: "per_1",
      sessionID: "ses_1",
      action: "read",
      resources: ["config.env"],
      save: ["config.env"],
      message: "Leer variables de entorno",
      metadata: { filepath: "/tmp/config.env", parentDir: "/tmp" },
      source: { type: "tool", messageID: "msg_1", id: "tool_1" },
    });

    expect(request).toEqual({
      id: "per_1",
      sessionID: "ses_1",
      action: "read",
      resources: ["config.env"],
      save: ["config.env"],
      message: "Leer variables de entorno",
      metadata: { filepath: "/tmp/config.env", parentDir: "/tmp" },
      source: { type: "tool", messageID: "msg_1", id: "tool_1" },
    });
    expect(toPermissionRequests([{ id: "sin-sesion" }, null])).toEqual([]);
  });

  test("evento permission.asked trae la petición ya estrechada", () => {
    const event = toServerEvent({
      type: "permission.asked",
      data: {
        id: "per_2",
        sessionID: "ses_1",
        action: "bash",
        resources: ["rm -rf dist"],
      },
    });
    expect(event.permission).toMatchObject({
      id: "per_2",
      sessionID: "ses_1",
      action: "bash",
      resources: ["rm -rf dist"],
    });
  });

  test("evento permission.replied identifica la petición resuelta", () => {
    const event = toServerEvent({
      type: "permission.replied",
      data: { sessionID: "ses_1", requestID: "per_2", reply: "once" },
    });
    expect(event.permissionReply).toEqual({ sessionID: "ses_1", requestID: "per_2" });
    expect(toServerEvent({ type: "permission.replied", data: {} }).permissionReply).toBeUndefined();
  });
});

describe("formularios", () => {
  test("mapea campos, opciones, condiciones y defaults del servidor", () => {
    const [form] = toAgentForms([
      {
        id: "frm_1",
        sessionID: "ses_1",
        title: "¿Qué entorno?",
        metadata: { origen: "prueba" },
        fields: [
          {
            key: "entorno",
            type: "string",
            title: "Entorno",
            required: true,
            options: [
              { value: "dev", label: "Desarrollo" },
              { value: "prod", label: "Producción", description: "Cuidado" },
            ],
            default: "dev",
          },
          {
            key: "incluir",
            type: "multiselect",
            options: [{ value: "tests", label: "Tests" }],
            default: ["tests"],
          },
          { key: "otro", type: "string", when: [{ key: "entorno", op: "neq", value: "dev" }] },
          { key: "roto", type: "desconocido" },
        ],
      },
    ]);

    expect(form).toMatchObject({
      id: "frm_1",
      sessionID: "ses_1",
      title: "¿Qué entorno?",
      metadata: { origen: "prueba" },
    });
    expect(form?.fields.map((field) => field.key)).toEqual(["entorno", "incluir", "otro"]);
    expect(form?.fields[0]).toMatchObject({
      type: "string",
      options: [
        { value: "dev", label: "Desarrollo" },
        { value: "prod", label: "Producción", description: "Cuidado" },
      ],
      default: "dev",
      required: true,
    });
    expect(form?.fields[1]).toMatchObject({ type: "multiselect", default: ["tests"] });
    expect(form?.fields[2]).toMatchObject({
      type: "string",
      when: [{ key: "entorno", op: "neq", value: "dev" }],
    });
  });

  test("descarta formularios sin id o sesión", () => {
    expect(toAgentForms([null, { id: "x" }, { sessionID: "s" }])).toEqual([]);
    expect(toAgentForm({ id: "frm", sessionID: "s", fields: [] })).toMatchObject({
      title: "Pregunta del agente",
    });
  });

  test("eventos form.created, form.replied y form.cancelled", () => {
    const created = toServerEvent({
      type: "form.created",
      data: {
        form: {
          id: "frm_2",
          sessionID: "ses_1",
          title: "Elige",
          fields: [{ key: "x", type: "boolean", default: true }],
        },
      },
    });
    expect(created.form).toMatchObject({ id: "frm_2", title: "Elige" });

    expect(
      toServerEvent({ type: "form.replied", data: { id: "frm_2", sessionID: "ses_1" } })
        .formSettled,
    ).toEqual({ sessionID: "ses_1", formID: "frm_2" });
    expect(
      toServerEvent({ type: "form.cancelled", data: { id: "frm_2", sessionID: "ses_1" } })
        .formSettled,
    ).toEqual({ sessionID: "ses_1", formID: "frm_2" });
  });
});
