import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import { useWorkspaceSettingsForm } from "../useWorkspaceSettingsForm";
import type { ChatGateway } from "../../../domain/repositories/ChatGateway";
import type { McpInfo, SkillInfo, Workspace } from "../../../types";
import { makeWorkspace } from "../../../tests/fakes";

const mcpA: McpInfo = { name: "a", config: { url: "http://a" }, source: "global" };
const mcpB: McpInfo = { name: "b", config: { command: ["b"] }, source: "global" };
const skillA: SkillInfo = {
  id: "s1",
  name: "Skill",
  description: "Skill global",
  path: "/s1",
  source: "global",
};

function fakeClient({ addError }: { addError?: Error } = {}) {
  return {
    mcp: {
      list: vi.fn(async () => ({ data: [{ name: "a", state: "connected" }] })),
      add: vi.fn(async () => {
        if (addError) throw addError;
      }),
      remove: vi.fn(async () => undefined),
    },
    location: { reload: vi.fn(async () => undefined) },
  } as unknown as ChatGateway;
}

function setup(workspace: Workspace, client: ChatGateway | null = fakeClient()) {
  const update = vi.fn(
    async (input: { mcpNames: string[]; skills: unknown[]; model: string | null }) => ({
      workspace: { ...workspace, mcpNames: input.mcpNames, model: input.model },
      configPath: "/cfg",
      agentsPath: "/agents",
      warnings: [],
    }),
  );
  const reapplyProfile = vi.fn(async () => ({
    workspace: { ...workspace, mcpNames: ["a", "b"], model: "openai/reapply" },
    configPath: "/cfg",
    agentsPath: "/agents",
    warnings: ["reaplicado"],
  }));
  const root = new CompositionRoot({
    workspaces: { update, reapplyProfile } as never,
    library: {
      mcps: async () => [mcpA, mcpB],
      skills: async () => [skillA],
    } as never,
  });
  const onWorkspaceUpdated = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProvider root={root}>{children}</AppProvider>
  );
  const view = renderHook(
    ({ current }: { current: Workspace }) =>
      useWorkspaceSettingsForm({ workspace: current, client, onWorkspaceUpdated }),
    { initialProps: { current: workspace }, wrapper },
  );
  return { update, reapplyProfile, onWorkspaceUpdated, client, ...view };
}

beforeEach(() => {
  localStorage.clear();
});

describe("useWorkspaceSettingsForm — aplicar", () => {
  test("persiste la selección y el modelo, sincroniza el servidor y marca aplicado", async () => {
    const workspace = makeWorkspace({ mcpNames: ["a"], skills: [], model: null });
    const { result, update, client, onWorkspaceUpdated } = setup(workspace);

    await waitFor(() => expect(result.current.mcps).toHaveLength(2));
    act(() => result.current.toggleMcp("b"));
    act(() => result.current.changeModel("openai/gpt"));

    await act(async () => {
      await result.current.apply();
    });

    expect(update).toHaveBeenCalledWith({
      id: "w1",
      mcpNames: ["a", "b"],
      skills: [],
      model: "openai/gpt",
    });
    expect(client?.mcp.add).toHaveBeenCalledWith({
      server: "b",
      config: { command: ["b"], disabled: false },
      location: { directory: "/tmp/demo" },
    });
    expect(onWorkspaceUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ mcpNames: ["a", "b"] }),
      [],
    );
    expect(result.current.applied).toBe(true);
    expect(result.current.error).toBeNull();
  });

  test("un MCP que falla al añadirse expone el error de aplicación", async () => {
    const client = fakeClient({ addError: new Error("mcp caído") });
    const workspace = makeWorkspace({ mcpNames: [], skills: [], model: null });
    const { result } = setup(workspace, client);

    await waitFor(() => expect(result.current.mcps).toHaveLength(2));
    act(() => result.current.toggleMcp("a"));

    await act(async () => {
      await result.current.apply();
    });

    expect(result.current.error).toBe("mcp caído");
    expect(result.current.applied).toBe(true);
  });
});

describe("useWorkspaceSettingsForm — reaplicar perfil", () => {
  test("sustituye la selección con el resultado del perfil y propaga los avisos", async () => {
    const workspace = makeWorkspace({
      mcpNames: ["a"],
      skills: [],
      model: "global/viejo",
      profileId: "plantilla",
      profileVersion: 1,
    });
    const { result, reapplyProfile, onWorkspaceUpdated } = setup(workspace);

    await act(async () => {
      await result.current.reapply();
    });

    expect(reapplyProfile).toHaveBeenCalledWith("w1");
    expect([...result.current.selectedMcps]).toEqual(["a", "b"]);
    expect(result.current.model).toBe("openai/reapply");
    expect(result.current.warnings).toEqual(["reaplicado"]);
    expect(result.current.applied).toBe(true);
    expect(onWorkspaceUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ mcpNames: ["a", "b"] }),
      ["reaplicado"],
    );
  });
});

describe("useWorkspaceSettingsForm — reinicio por workspace", () => {
  test("no reinicia al aplicar y sí al cambiar workspace.id", async () => {
    const first = makeWorkspace({ id: "w1", mcpNames: ["a"], skills: [], model: "global/m1" });
    const second = makeWorkspace({ id: "w2", mcpNames: ["b"], skills: [], model: "global/m2" });
    const { result, rerender } = setup(first);

    await waitFor(() => expect(result.current.mcps).toHaveLength(2));
    act(() => {
      result.current.toggleMcp("b");
      result.current.changeModel("local/m1");
    });

    await act(async () => {
      await result.current.apply();
    });

    expect([...result.current.selectedMcps].sort()).toEqual(["a", "b"]);
    expect(result.current.model).toBe("local/m1");
    expect(result.current.applied).toBe(true);

    localStorage.setItem("opentemplates:budget:w2", "42");
    rerender({ current: second });

    await waitFor(() => expect(result.current.model).toBe("global/m2"));
    expect([...result.current.selectedMcps]).toEqual(["b"]);
    expect(result.current.budgetText).toBe("42");
    expect(result.current.applied).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.warnings).toEqual([]);
  });
});
