import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inspector } from "../Inspector";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import type { ResourceUsage, ServerInfo, Workspace } from "../../../types";
import { makeWorkspace } from "../../../tests/fakes";

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

function fakeClient(): ChatServer {
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
      list: vi.fn(async () => ({ data: [{ name: "mcp-a", status: "connected" }] })),
      add: vi.fn(),
      remove: vi.fn(),
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
      create: vi.fn(),
      prompt: vi.fn(),
      interrupt: vi.fn(),
      switchModel: vi.fn(),
      switchAgent: vi.fn(),
    },
    location: { reload: vi.fn(async () => undefined) },
    event: { subscribe: vi.fn() },
  };
  return client as unknown as ChatServer;
}

function setup(workspace: Workspace = makeWorkspace(), sessionId: string | null = "s1") {
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
  });
  const onUpdated = vi.fn();
  const client = fakeClient();
  render(
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
  return { client, setDisabled, onUpdated };
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
