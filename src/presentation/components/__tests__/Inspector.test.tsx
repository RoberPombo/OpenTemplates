import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inspector } from "../Inspector";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import { prefKeys } from "../../../domain/repositories/Preferences";
import type { WorkspaceStats } from "../../../domain/chat/usage";
import type { McpServerStatus } from "../../../domain/chat/mcp";
import type { ResourceUsage, ServerInfo, Workspace } from "../../../types";
import { makeEventHub, makeNotificationGateway, makeWorkspace } from "../../../tests/fakes";

// Caracterización del Inspector con el puerto opencode y los puertos del
// CompositionRoot inyectados como fakes: sesión, proyecto, uso y toggles.

const server: ServerInfo = {
  workspaceId: "w1",
  baseUrl: "http://127.0.0.1:4096",
  password: "secreto",
  port: 4096,
  pid: 42,
};

const resources: ResourceUsage = {
  app: { pid: 1, memoryBytes: 100 * 1024 ** 2, cpuPercent: 2 },
  workspace: { pid: 42, memoryBytes: 50 * 1024 ** 2, cpuPercent: 1 },
  system: {
    cores: 8,
    cpuPercent: 10,
    memoryTotalBytes: 16 * 1024 ** 3,
    memoryUsedBytes: 8 * 1024 ** 3,
  },
};

const stats: WorkspaceStats = {
  range: { from: 1_700_000_000_000, to: 1_700_086_400_000 },
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
  cost: 12.345,
  activeDays: 2,
  streak: 2,
  activity: [
    { date: "2026-11-22", steps: 4 },
    { date: "2026-11-23", steps: 8 },
  ],
  models: [
    {
      model: { providerID: "openai", id: "gpt" },
      steps: 2,
      tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 2.345,
    },
    {
      model: { providerID: "anthropic", id: "claude" },
      steps: 10,
      tokens: { input: 5000, output: 6, reasoning: 53, cache: { read: 100, write: 10 } },
      cost: 10,
    },
  ],
};

function fakeClient(
  sessionStats: WorkspaceStats | null = null,
  mcpServers: McpServerStatus[] = [{ name: "mcp-a", state: "connected" }],
  hub = makeEventHub(),
): ChatServer {
  const client = {
    model: {
      list: vi.fn(async () => ({
        data: [
          {
            providerID: "anthropic",
            id: "claude",
            modelID: "claude",
            name: "Claude",
            enabled: true,
            type: "chat",
            variants: [{ id: "high" }],
            limit: { context: 200_000 },
          },
        ],
      })),
      default: vi.fn(async () => ({ data: null })),
    },
    vcs: {
      status: vi.fn(async () => ({
        data: [
          { additions: 5, deletions: 3 },
          { additions: 1, deletions: 0 },
        ],
      })),
      get: vi.fn(async () => ({ data: { branch: { current: "main" } } })),
    },
    usage: {
      limits: vi.fn(async () => ({
        data: {
          go: {
            rolling: { percent: 42, resetsAt: Date.now() + 3_600_000 },
            weekly: null,
            monthly: null,
          },
          budgets: [{ id: "plan", limit: 1000, spent: 250, resetsAt: Date.now() + 86_400_000 }],
        },
      })),
    },
    mcp: {
      list: vi.fn(async () => ({ data: mcpServers })),
      add: vi.fn(),
      remove: vi.fn(),
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    },
    message: {
      list: vi.fn(async () => ({
        data: [
          {
            id: "a1",
            type: "assistant",
            cost: 0.1,
            model: { providerID: "anthropic", id: "claude" },
            tokens: { input: 100_000, output: 500, cache: { read: 40_000, write: 10_000 } },
          },
        ],
      })),
    },
    session: {
      get: vi.fn(async () => ({ cost: 0.5 })),
      stats: vi.fn(async () => ({ data: sessionStats })),
      create: vi.fn(),
      prompt: vi.fn(),
      interrupt: vi.fn(),
      switchModel: vi.fn(),
      switchAgent: vi.fn(),
    },
    location: { reload: vi.fn(async () => undefined) },
    event: { subscribe: vi.fn((opts?: { signal?: AbortSignal }) => hub.subscribe(opts)) },
  };
  return client as unknown as ChatServer;
}

function setup(
  workspace: Workspace = makeWorkspace(),
  sessionId: string | null = "s1",
  options: {
    stats?: WorkspaceStats | null;
    notifications?: ReturnType<typeof makeNotificationGateway>;
    mcpServers?: McpServerStatus[];
  } = {},
) {
  const setDisabled = vi.fn(
    async (input: { id: string; disabledMcps: string[]; disabledSkills: string[] }) => ({
      workspace: {
        ...workspace,
        disabledMcps: input.disabledMcps,
        disabledSkills: input.disabledSkills,
      },
      configPath: "/cfg",
      agentsPath: "/agents",
      warnings: [],
    }),
  );
  const root = new CompositionRoot({
    workspaces: { setDisabled } as never,
    resources: { usage: vi.fn(async () => resources) } as never,
    notifications: options.notifications,
  });
  const onUpdated = vi.fn();
  const hub = makeEventHub();
  const client = fakeClient(options.stats ?? null, options.mcpServers, hub);
  const view = render(
    <AppProvider root={root}>
      <Inspector
        workspace={workspace}
        client={client}
        server={server}
        sessionId={sessionId}
        onUpdated={onUpdated}
        onClose={vi.fn()}
      />
    </AppProvider>,
  );
  return { client, setDisabled, onUpdated, hub, unmount: view.unmount };
}

function workspaceWithSources() {
  return makeWorkspace({
    mcpNames: ["mcp-a"],
    skills: [{ id: "s1", path: "/skills/s1" }],
    agents: [{ id: "build", path: "/agents/build.md", source: "global" }],
    plugins: [{ id: "p1", path: "/plugins/p1", source: "global" }],
  });
}

describe("Inspector — datos", () => {
  test("pinta sesión, proyecto, uso, fuentes y recursos", async () => {
    setup(workspaceWithSources());

    expect(await screen.findByText("100.0k in · 500 out")).toBeInTheDocument();
    expect(screen.getByText("$0.500")).toBeInTheDocument();
    expect(screen.getByText("75.0%")).toBeInTheDocument();
    expect(screen.getByText("28.6%")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();

    expect(screen.getByText("2 archivos modificados")).toBeInTheDocument();
    expect(screen.getByText("+6")).toBeInTheDocument();
    expect(screen.getByText("−3")).toBeInTheDocument();
    expect(screen.getByText("⎇ main")).toBeInTheDocument();

    expect(screen.getByText("42.0%")).toBeInTheDocument();
    expect(screen.getByText("$750.00")).toBeInTheDocument();
    expect(screen.getByText("Servidores MCP")).toBeInTheDocument();
    expect(screen.getAllByText("1/1").length).toBeGreaterThan(0);

    expect(screen.getByText("Recursos")).toBeInTheDocument();
    expect(screen.getByText("10.0%")).toBeInTheDocument();
  });

  test("sin sesión muestra el estado vacío y no pide mensajes", async () => {
    const { client } = setup(workspaceWithSources(), null);

    expect(await screen.findByText("Sin actividad todavía.")).toBeInTheDocument();
    expect(client.message.list).not.toHaveBeenCalled();
  });
});

describe("Inspector — toggles", () => {
  test("desactivar un MCP persiste, notifica y recarga el servidor", async () => {
    const user = userEvent.setup();
    const { client, setDisabled, onUpdated } = setup(workspaceWithSources());

    await user.click(await screen.findByRole("switch", { name: "Desactivar mcp-a" }));

    await waitFor(() =>
      expect(setDisabled).toHaveBeenCalledWith({
        id: "w1",
        disabledMcps: ["mcp-a"],
        disabledSkills: [],
      }),
    );
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ disabledMcps: ["mcp-a"] }),
      [],
    );
    expect(client.location.reload).toHaveBeenCalled();
  });

  test("desactivar una skill conserva los MCPs desactivados", async () => {
    const user = userEvent.setup();
    const { setDisabled } = setup(
      makeWorkspace({
        mcpNames: ["mcp-a"],
        disabledMcps: ["otro-mcp"],
        skills: [{ id: "s1", path: "/skills/s1" }],
      }),
    );

    await user.click(await screen.findByRole("switch", { name: "Desactivar s1" }));

    await waitFor(() =>
      expect(setDisabled).toHaveBeenCalledWith({
        id: "w1",
        disabledMcps: ["otro-mcp"],
        disabledSkills: ["s1"],
      }),
    );
  });
});

describe("Inspector — estado runtime de MCP", () => {
  test("muestra el error legible y reconecta sin recargar la location", async () => {
    const user = userEvent.setup();
    const { client } = setup(workspaceWithSources(), "s1", {
      mcpServers: [
        {
          name: "mcp-a",
          state: "failed",
          error: "Connection closed:\nMCP server process exited with code 1",
        },
      ],
    });
    expect(await screen.findByText("fallando")).toBeInTheDocument();
    expect(
      screen.getByText("Connection closed: MCP server process exited with code 1"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(client.mcp.connect).toHaveBeenCalledWith({
        server: "mcp-a",
        location: { directory: "/tmp/demo" },
      }),
    );
    expect(client.location.reload).not.toHaveBeenCalled();
  });

  test("desconectar un MCP conectado no borra su configuración", async () => {
    const user = userEvent.setup();
    const { client, setDisabled } = setup(workspaceWithSources(), "s1", {
      mcpServers: [{ name: "mcp-a", state: "connected" }],
    });
    await user.click(await screen.findByRole("button", { name: "Desconectar" }));
    await waitFor(() =>
      expect(client.mcp.disconnect).toHaveBeenCalledWith({
        server: "mcp-a",
        location: { directory: "/tmp/demo" },
      }),
    );
    expect(setDisabled).not.toHaveBeenCalled();
  });

  test("mcp.status.changed relee el estado sin esperar al sondeo", async () => {
    const servers: McpServerStatus[] = [{ name: "mcp-a", state: "connected" }];
    const { client, hub } = setup(workspaceWithSources(), "s1", { mcpServers: servers });
    expect(await screen.findByText("conectado")).toBeInTheDocument();

    servers[0] = { name: "mcp-a", state: "failed", error: "boom" };
    hub.push({ type: "mcp.status.changed", data: { server: "mcp-a" } });

    expect(await screen.findByText("fallando")).toBeInTheDocument();
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(client.mcp.list).toHaveBeenCalledTimes(2);
  });
});

describe("Inspector — consumo del workspace", () => {
  beforeEach(() => localStorage.clear());

  test("pinta coste, tokens, actividad y modelos, y cambia de rango", async () => {
    const user = userEvent.setup();
    const { client } = setup(workspaceWithSources(), "s1", { stats });

    expect(await screen.findByText("$12.35")).toBeInTheDocument();
    expect(screen.getByText("6,710 in · 8 out")).toBeInTheDocument();
    expect(screen.getByText("4,096 lectura · 10 escritura")).toBeInTheDocument();
    expect(screen.getByText("3 sesiones · 9 prompts")).toBeInTheDocument();
    expect(screen.getByText("12 pasos · 1 subagentes")).toBeInTheDocument();
    expect(screen.getByText("22/11")).toBeInTheDocument();
    expect(screen.getByText("23/11")).toBeInTheDocument();
    expect(screen.getByText("openai/gpt")).toBeInTheDocument();

    const models = [
      ...document.querySelectorAll(".usage-model .inspector-line > span:first-child"),
    ].map((node) => node.textContent);
    expect(models).toEqual(["Claude", "openai/gpt"]);

    const thirty = screen.getByRole("button", { name: "30 días" });
    expect(thirty).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "7 días" }));
    await waitFor(() => {
      const calls = vi.mocked(client.session.stats).mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last?.from).toBeDefined();
      expect(last?.to).toBeDefined();
      expect(last?.tools).toBe("none");
    });

    await user.click(screen.getByRole("button", { name: "Total" }));
    await waitFor(() => {
      const calls = vi.mocked(client.session.stats).mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last?.from).toBeUndefined();
      expect(last?.to).toBeUndefined();
    });
  });

  test("avisa visiblemente cuando el coste supera el presupuesto", async () => {
    localStorage.setItem(prefKeys.budget("w1"), "10");
    setup(workspaceWithSources(), "s1", { stats });

    expect(await screen.findByText("Has superado el presupuesto mensual.")).toBeInTheDocument();
    expect(screen.getByText("$12.35 de $10.00")).toBeInTheDocument();
  });

  test("avisa al acercarse al presupuesto sin superarlo", async () => {
    localStorage.setItem(prefKeys.budget("w1"), "14");
    setup(workspaceWithSources(), "s1", { stats: { ...stats, cost: 12.345 } });

    expect(await screen.findByText("Te acercas al presupuesto mensual.")).toBeInTheDocument();
    expect(screen.queryByText("Has superado el presupuesto mensual.")).not.toBeInTheDocument();
  });

  test("notifica una vez por umbral y día, sin repetir al remontar", async () => {
    const notifications = makeNotificationGateway();
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    localStorage.setItem(prefKeys.notifications, "1");
    localStorage.setItem(prefKeys.budget("w1"), "10");
    try {
      const first = setup(workspaceWithSources(), "s1", { stats, notifications });
      await waitFor(() => expect(notifications.notify).toHaveBeenCalledTimes(1));
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "w1",
          body: "Presupuesto superado: $12.35 de $10.00.",
        }),
      );
      expect(localStorage.getItem(prefKeys.budgetAlert("w1", 1))).not.toBeNull();
      expect(localStorage.getItem(prefKeys.budgetAlert("w1", 0.8))).not.toBeNull();

      first.unmount();
      setup(workspaceWithSources(), "s1", { stats, notifications });
      expect(await screen.findByText("$12.35")).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    } finally {
      focus.mockRestore();
    }
  });
});
