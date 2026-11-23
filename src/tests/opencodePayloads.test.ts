// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  toAgentForm,
  toAgentForms,
  toCatalogAgents,
  toCatalogModels,
  toChatCommands,
  toChatSkills,
  toFileChangeSummaries,
  toFileChanges,
  toFileContent,
  toFileTreeEntries,
  toMcpServerStatuses,
  toPermissionRequest,
  toPermissionRequests,
  toServerEvent,
  toSessionMessages,
  toSessionTransfer,
  toTerminalInfo,
  toTerminalInfos,
  toTerminalTicket,
  toUsageLimits,
  toWorkspaceStats,
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
describe("toFileChanges", () => {
  test("mapea la forma real de session.diff y vcs.diff", () => {
    const payload = [
      {
        file: "notas.txt",
        patch: "diff --git a/notas.txt b/notas.txt\n@@ -1 +1 @@\n-dos\n+dos cambiado\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
      {
        file: "nuevo.txt",
        patch: "diff --git a/nuevo.txt b/nuevo.txt\n@@ -0,0 +1 @@\n+nuevo\n",
        additions: 1,
        deletions: 0,
        status: "added",
        more: true,
      },
    ];
    expect(toFileChanges(payload)).toEqual([
      {
        file: "notas.txt",
        patch: "diff --git a/notas.txt b/notas.txt\n@@ -1 +1 @@\n-dos\n+dos cambiado\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
      {
        file: "nuevo.txt",
        patch: "diff --git a/nuevo.txt b/nuevo.txt\n@@ -0,0 +1 @@\n+nuevo\n",
        additions: 1,
        deletions: 0,
        status: "added",
        more: true,
      },
    ]);
  });
  test("descarta entradas sin fichero o con estado desconocido y rellena huecos", () => {
    expect(
      toFileChanges([
        null,
        { status: "added" },
        { file: "raro.txt", status: "renamed" },
        { file: "sin-contadores.txt", status: "deleted", patch: 4 },
      ]),
    ).toEqual([
      {
        file: "sin-contadores.txt",
        additions: 0,
        deletions: 0,
        status: "deleted",
        patch: "",
      },
    ]);
    expect(toFileChanges(undefined)).toEqual([]);
  });
  test("vcs.status comparte estado pero no arrastra el parche", () => {
    expect(
      toFileChangeSummaries([
        { file: "a.ts", additions: 2, deletions: 1, status: "modified" },
        { file: "b.ts", additions: 0, deletions: 3, status: "deleted" },
      ]),
    ).toEqual([
      { file: "a.ts", additions: 2, deletions: 1, status: "modified" },
      { file: "b.ts", additions: 0, deletions: 3, status: "deleted" },
    ]);
  });
});
describe("comandos y skills", () => {
  test("estrecha command.list y descarta entradas sin nombre", () => {
    expect(
      toChatCommands([
        { name: "review", description: "Revisa cambios" },
        { name: "init" },
        { description: "sin nombre" },
        null,
      ]),
    ).toEqual([{ name: "review", description: "Revisa cambios" }, { name: "init" }]);
    expect(toChatCommands(undefined)).toEqual([]);
  });

  test("estrecha skill.list, usa el id como nombre y deduplica por id", () => {
    expect(
      toChatSkills([
        { id: "testing", name: "Testing", description: "Diseña pruebas" },
        { id: "testing", name: "Testing repetida" },
        { id: "sin-nombre" },
        { name: "sin id" },
      ]),
    ).toEqual([
      { id: "testing", name: "Testing", description: "Diseña pruebas" },
      { id: "sin-nombre", name: "sin-nombre" },
    ]);
    expect(toChatSkills(null)).toEqual([]);
  });
});

describe("ficheros", () => {
  test("mapea los hijos de una carpeta y descarta entradas inválidas", () => {
    expect(
      toFileTreeEntries([
        { path: "src/", type: "directory" },
        { path: "README.md", type: "file" },
        null,
        { path: "raro", type: "socket" },
      ]),
    ).toEqual([
      { path: "src/", type: "directory" },
      { path: "README.md", type: "file" },
    ]);
  });
  test("decodifica el contenido de file.read", () => {
    const content = toFileContent(new TextEncoder().encode("hola\n"));
    expect(content).toMatchObject({ kind: "text", text: "hola\n", truncated: false });
    expect(toFileContent(new Uint8Array([0, 1]))).toMatchObject({
      kind: "binary",
      text: "",
    });
  });
});

describe("toWorkspaceStats", () => {
  const payload = {
    range: { from: 100, to: 200 },
    sessions: 3,
    subagents: 1,
    prompts: 9,
    steps: 12,
    tokens: {
      input: 6710,
      output: 8,
      reasoning: 53,
      cache: { read: 4096, write: 10 },
    },
    cost: 0.42,
    tools: { mode: "none" },
    activeDays: 2,
    streak: 2,
    activity: [
      { date: "2026-11-22", steps: 4 },
      { date: "2026-11-23", steps: 8 },
      { date: "", steps: 1 },
      { date: "2026-11-24" },
    ],
    models: [
      {
        model: { id: "claude", providerID: "anthropic", variant: "high" },
        steps: 10,
        tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 1, write: 0 } },
        cost: 0.4,
      },
      { model: { id: "sin-proveedor" }, cost: 1 },
      { model: { id: "gpt", providerID: "openai" }, steps: 2, cost: 0.02 },
    ],
  };

  test("mapea el consumo acumulado y descarta actividad y modelos inválidos", () => {
    expect(toWorkspaceStats(payload)).toEqual({
      range: { from: 100, to: 200 },
      sessions: 3,
      subagents: 1,
      prompts: 9,
      steps: 12,
      tokens: {
        input: 6710,
        output: 8,
        reasoning: 53,
        cache: { read: 4096, write: 10 },
      },
      cost: 0.42,
      activeDays: 2,
      streak: 2,
      activity: [
        { date: "2026-11-22", steps: 4 },
        { date: "2026-11-23", steps: 8 },
      ],
      models: [
        {
          model: { id: "claude", providerID: "anthropic", variant: "high" },
          steps: 10,
          tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 1, write: 0 } },
          cost: 0.4,
        },
        {
          model: { id: "gpt", providerID: "openai" },
          steps: 2,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.02,
        },
      ],
    });
  });

  test("normaliza contadores ausentes a cero", () => {
    expect(toWorkspaceStats({ range: { from: 1, to: 2 } })).toEqual({
      range: { from: 1, to: 2 },
      sessions: 0,
      subagents: 0,
      prompts: 0,
      steps: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
      activeDays: 0,
      streak: 0,
      activity: [],
      models: [],
    });
  });

  test("sin rango válido devuelve null", () => {
    expect(toWorkspaceStats(undefined)).toBeNull();
    expect(toWorkspaceStats(null)).toBeNull();
    expect(toWorkspaceStats([])).toBeNull();
    expect(toWorkspaceStats({})).toBeNull();
    expect(toWorkspaceStats({ range: { from: 1 } })).toBeNull();
    expect(toWorkspaceStats({ range: { from: "1", to: 2 } })).toBeNull();
  });
});

describe("toSessionTransfer", () => {
  test("conserva info y mensajes con id y tipo", () => {
    expect(
      toSessionTransfer({
        info: { id: "ses_1", title: "Hola", location: { directory: "/tmp/demo" }, cost: 1 },
        messages: [
          { id: "msg_1", type: "user", text: "hola" },
          { id: "msg_2", type: "assistant", content: [] },
        ],
      }),
    ).toEqual({
      info: { id: "ses_1", title: "Hola", location: { directory: "/tmp/demo" }, cost: 1 },
      messages: [
        { id: "msg_1", type: "user", text: "hola" },
        { id: "msg_2", type: "assistant", content: [] },
      ],
    });
  });

  test("descarta mensajes sin id o tipo y tolera un payload vacío", () => {
    expect(
      toSessionTransfer({
        info: { id: "ses_1" },
        messages: [{ type: "user" }, { id: "msg_2" }, "basura"],
      }).messages,
    ).toEqual([]);
    expect(toSessionTransfer(null)).toEqual({
      info: { id: "", title: undefined, location: undefined },
      messages: [],
    });
  });
});

describe("payloads de terminal", () => {
  test("estrecha el PTY del SDK y la lista de pty.list", () => {
    expect(
      toTerminalInfo({
        location: { directory: "/tmp/demo" },
        data: {
          id: "pty_1",
          title: "Terminal 1",
          command: "/usr/bin/bash",
          args: ["-l"],
          cwd: "/tmp/demo",
          status: "running",
          pid: 22,
        },
      }),
    ).toEqual({
      id: "pty_1",
      title: "Terminal 1",
      status: "running",
      cwd: "/tmp/demo",
      pid: 22,
      exitCode: undefined,
    });
    expect(toTerminalInfo({ status: "running" })).toBeNull();
    expect(
      toTerminalInfos({
        data: [{ id: "pty_1", status: "running", cwd: "/tmp/demo", pid: 1 }, { status: "running" }],
      }),
    ).toHaveLength(1);
  });

  test("acepta el ticket dentro del wrapper del SDK", () => {
    expect(toTerminalTicket({ location: {}, data: { ticket: "abc", expires_in: 60 } })).toEqual({
      ticket: "abc",
      expiresIn: 60,
    });
    expect(toTerminalTicket({ data: { ticket: "", expires_in: 60 } })).toBeNull();
    expect(toTerminalTicket({ ticket: "suelto" })).toEqual({ ticket: "suelto", expiresIn: 0 });
  });
});

describe("payloads de MCP", () => {
  test("aplana estado y error de mcp.list", () => {
    expect(
      toMcpServerStatuses({
        data: [
          { name: "context7", status: { status: "connected" } },
          { name: "postgres", status: { status: "failed", error: "process exited" } },
          { name: "oauth", status: { status: "needs_auth", error: "login" } },
          { name: "apagado", status: { status: "disabled" } },
          { status: { status: "connected" } },
        ],
      }),
    ).toEqual([
      { name: "context7", state: "connected", error: undefined, title: undefined },
      { name: "postgres", state: "failed", error: "process exited", title: undefined },
      { name: "oauth", state: "needs_auth", error: "login", title: undefined },
      { name: "apagado", state: "disabled", error: undefined, title: undefined },
    ]);
    expect(toMcpServerStatuses({ data: [{ name: "x", status: "needsAuth" }] })).toEqual([
      { name: "x", state: "needs_auth", error: undefined, title: undefined },
    ]);
  });

  test("mcp.status.changed se estrecha con el nombre del servidor", () => {
    expect(toServerEvent({ type: "mcp.status.changed", data: { server: "postgres" } })).toEqual({
      type: "mcp.status.changed",
      data: { server: "postgres" },
      mcp: { server: "postgres" },
    });
    expect(toServerEvent({ type: "mcp.status.changed", data: {} }).mcp).toBeUndefined();
  });
});
