import { describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  INSPECTOR_POLL_FAST_MS,
  INSPECTOR_POLL_FAST_WINDOW_MS,
  INSPECTOR_POLL_SLOW_MS,
  useInspectorData,
} from "../useInspectorData";
import { CompositionRoot } from "../../../CompositionRoot";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import { prefKeys } from "../../../domain/repositories/Preferences";
import type { McpServerStatus } from "../../../domain/chat/mcp";
import type { WorkspaceStats } from "../../../domain/chat/usage";
import type { ResourceUsage, ServerInfo } from "../../../types";
import { makeFakeClient, makeWorkspace, type FakeClientOptions } from "../../../tests/fakes";

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
  tokens: { input: 6710, output: 8, reasoning: 53, cache: { read: 4096, write: 10 } },
  cost: 12.345,
  activeDays: 2,
  streak: 2,
  activity: [],
  models: [],
};

const assistantMessage = {
  id: "a1",
  type: "assistant",
  cost: 0.1,
  model: { providerID: "anthropic", id: "claude" },
  tokens: { input: 100_000, output: 500, cache: { read: 40_000, write: 10_000 } },
};

function setup({
  client: clientOptions = {},
  usage = async () => resources,
  configure,
}: {
  client?: FakeClientOptions;
  usage?: () => Promise<ResourceUsage>;
  configure?: (client: ChatServer) => void;
} = {}) {
  const { client, hub } = makeFakeClient(clientOptions);
  configure?.(client as unknown as ChatServer);
  const root = new CompositionRoot({
    preferences: {
      get: (key) => (key === prefKeys.budget("w1") ? "10" : null),
      set: vi.fn(),
      remove: vi.fn(),
    },
    resources: { usage: vi.fn(usage) } as never,
  });
  const view = renderHook(() =>
    useInspectorData({
      client: client as unknown as ChatServer,
      root,
      workspace: makeWorkspace(),
      server,
      sessionId: "s1",
      usageRange: "30d",
      active: true,
    }),
  );
  return { client, hub, ...view };
}

describe("useInspectorData", () => {
  test("carga proyecto, sesión, uso, modelos, MCPs, consumo y recursos", async () => {
    const { result } = setup({
      client: {
        branch: "main",
        vcsStatus: [
          { additions: 5, deletions: 3 },
          { additions: 1, deletions: 0 },
        ],
        messages: [assistantMessage],
        sessionCost: 0.5,
        mcpServers: [{ name: "mcp-a", state: "connected" }],
        usageLimits: {
          go: {
            rolling: { percent: 42, resetsAt: Date.now() + 3_600_000 },
            weekly: null,
            monthly: null,
          },
          budgets: [{ id: "plan", limit: 1000, spent: 250, resetsAt: Date.now() + 86_400_000 }],
        },
        stats,
      },
    });

    await waitFor(() => expect(result.current.stats).not.toBeNull());

    expect(result.current.project).toEqual({
      branch: "main",
      files: 2,
      additions: 6,
      deletions: 3,
    });
    expect(result.current.session).toMatchObject({ input: 100_000, output: 500, cost: 0.5 });
    expect(result.current.usage?.go?.rolling?.percent).toBe(42);
    expect(result.current.models.some((model) => model.name === "Claude")).toBe(true);
    expect(result.current.statuses["mcp-a"]?.state).toBe("connected");
    expect(result.current.stats?.cost).toBe(12.345);
    expect(result.current.statsError).toBeNull();
    expect(result.current.monthlyBudget).toBe(10);
    expect(result.current.resources?.system.memoryTotalBytes).toBe(16 * 1024 ** 3);
  });

  test("tolera que una fuente falle y mantiene el resto", async () => {
    const { result } = setup({
      client: { branch: "main", stats, mcpServers: [{ name: "mcp-a", state: "connected" }] },
      usage: async () => {
        throw new Error("recursos no disponibles");
      },
      configure: (client) => {
        vi.mocked(client.vcs.status).mockRejectedValue(new Error("vcs no disponible"));
      },
    });

    await waitFor(() => expect(result.current.stats?.cost).toBe(12.345));
    await waitFor(() => expect(result.current.project?.branch).toBe("main"));

    expect(result.current.project).toEqual({
      branch: "main",
      files: 0,
      additions: 0,
      deletions: 0,
    });
    expect(result.current.statuses["mcp-a"]?.state).toBe("connected");
    expect(result.current.resources).toBeNull();
  });

  test("mcp.status.changed relee el estado sin esperar al sondeo", async () => {
    const servers: McpServerStatus[] = [{ name: "mcp-a", state: "connected" }];
    const { result, hub, client } = setup({ client: { mcpServers: servers } });

    await waitFor(() => expect(result.current.statuses["mcp-a"]?.state).toBe("connected"));

    servers[0] = { name: "mcp-a", state: "failed", error: "boom" };
    act(() => {
      hub.push({ type: "mcp.status.changed", data: { server: "mcp-a" } });
    });

    await waitFor(() => expect(result.current.statuses["mcp-a"]?.state).toBe("failed"));
    expect(result.current.statuses["mcp-a"]?.error).toBe("boom");
    expect(client.mcp.list).toHaveBeenCalledTimes(2);
  });
});

/**
 * El sondeo se prueba con timers falsos: así el backoff y la pausa son
 * observables contando peticiones, sin esperas reales.
 */
describe("useInspectorData · sondeo", () => {
  type WindowState = { focused: boolean; visibility: DocumentVisibilityState };

  function stubWindow(initial: Partial<WindowState> = {}): WindowState {
    const state: WindowState = {
      focused: true,
      visibility: "visible",
      ...initial,
    };
    vi.spyOn(Document.prototype, "hasFocus").mockImplementation(() => state.focused);
    vi.spyOn(Document.prototype, "visibilityState", "get").mockImplementation(
      () => state.visibility,
    );
    return state;
  }

  const polls = (client: ChatServer) => vi.mocked(client.vcs.status).mock.calls.length;

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("primer tick inmediato, 5 s durante 2 minutos y 15 s después", async () => {
    stubWindow();
    const { client } = setup();

    // La primera carga no espera al intervalo.
    expect(polls(client as unknown as ChatServer)).toBe(1);

    await advance(INSPECTOR_POLL_FAST_MS);
    expect(polls(client as unknown as ChatServer)).toBe(2);

    // Del segundo 5 al 120 el ciclo sigue siendo rápido: 24 peticiones más.
    await advance(INSPECTOR_POLL_FAST_WINDOW_MS - INSPECTOR_POLL_FAST_MS);
    expect(polls(client as unknown as ChatServer)).toBe(25);

    // Pasada la ventana, el siguiente ciclo tarda 15 s, no 5.
    await advance(INSPECTOR_POLL_FAST_MS);
    expect(polls(client as unknown as ChatServer)).toBe(25);
    await advance(INSPECTOR_POLL_SLOW_MS - INSPECTOR_POLL_FAST_MS);
    expect(polls(client as unknown as ChatServer)).toBe(26);
  });

  test("sin foco no sondea y al recuperarlo refresca una sola vez de inmediato", async () => {
    const windowState = stubWindow({ focused: false });
    const { client } = setup();

    // El arranque siempre carga una vez, aunque la ventana no tenga foco.
    expect(polls(client as unknown as ChatServer)).toBe(1);

    await advance(INSPECTOR_POLL_FAST_WINDOW_MS);
    expect(polls(client as unknown as ChatServer)).toBe(1);

    windowState.focused = true;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(polls(client as unknown as ChatServer)).toBe(2);

    // Un focus con el temporizador ya armado no duplica el refresco.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(polls(client as unknown as ChatServer)).toBe(2);

    // El temporizador queda armado con la cadencia vigente (ya lenta por el tiempo sin foco).
    await advance(INSPECTOR_POLL_SLOW_MS);
    expect(polls(client as unknown as ChatServer)).toBe(3);
  });

  test("con la pestaña oculta no sondea y reanuda al volver", async () => {
    const windowState = stubWindow({ visibility: "hidden" });
    const { client } = setup();

    expect(polls(client as unknown as ChatServer)).toBe(1);
    await advance(INSPECTOR_POLL_FAST_WINDOW_MS);
    expect(polls(client as unknown as ChatServer)).toBe(1);

    windowState.visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(polls(client as unknown as ChatServer)).toBe(2);
  });

  test("un evento mcp.status.changed reinicia el backoff a 5 s", async () => {
    stubWindow();
    const { client, hub } = setup({
      client: { mcpServers: [{ name: "mcp-a", state: "connected" }] },
    });

    await advance(INSPECTOR_POLL_FAST_WINDOW_MS);
    expect(polls(client as unknown as ChatServer)).toBe(25);

    await act(async () => {
      hub.push({ type: "mcp.status.changed", data: { server: "mcp-a" } });
      await Promise.resolve();
    });

    // Ya en la ventana lenta, el evento devuelve la cadencia a 5 s.
    await advance(INSPECTOR_POLL_FAST_MS);
    expect(polls(client as unknown as ChatServer)).toBe(26);
  });

  test("el refresco manual reinicia el backoff y relee la instantánea", async () => {
    stubWindow();
    const { client, result } = setup();

    await advance(INSPECTOR_POLL_FAST_WINDOW_MS);
    expect(polls(client as unknown as ChatServer)).toBe(25);

    await act(async () => {
      await result.current.refresh();
    });
    expect(polls(client as unknown as ChatServer)).toBe(26);

    // Tras el refresco manual, el siguiente ciclo vuelve a ser rápido.
    await advance(INSPECTOR_POLL_FAST_MS);
    expect(polls(client as unknown as ChatServer)).toBe(27);
  });
});
