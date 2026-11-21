import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "../SettingsPanel";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../CompositionRoot";
import type { ChatGateway } from "../../domain/repositories/ChatGateway";
import type { McpInfo, Workspace } from "../../types";
import { makeWorkspace } from "../../tests/fakes";

const mcpA: McpInfo = { name: "a", config: { url: "http://a" }, source: "global" };
const mcpB: McpInfo = { name: "b", config: { command: ["b"] }, source: "global" };

function fakeServer() {
  return {
    mcp: {
      list: vi.fn(async () => ({ data: [] })),
      add: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
    location: { reload: vi.fn(async () => undefined) },
  };
}

function setup(workspace: Workspace, server: ReturnType<typeof fakeServer> | null) {
  const update = vi.fn(
    async (input: { mcpNames: string[]; skills: unknown[]; model: string | null }) => ({
      workspace: { ...workspace, mcpNames: input.mcpNames, model: input.model },
      configPath: "/cfg",
      agentsPath: "/agents",
      warnings: [],
    }),
  );
  const reapplyTemplate = vi.fn(async () => ({
    workspace: { ...workspace, mcpNames: ["a", "b"] },
    configPath: "/cfg",
    agentsPath: "/agents",
    warnings: ["reaplicado"],
  }));
  const root = new CompositionRoot({
    workspaces: { update, reapplyTemplate } as never,
    library: {
      mcps: async () => [mcpA, mcpB],
      skills: async () => [],
    } as never,
  });
  const onUpdated = vi.fn();
  render(
    <AppProvider root={root}>
      <SettingsPanel
        workspace={workspace}
        client={server as unknown as ChatGateway | null}
        onUpdated={onUpdated}
        onClose={vi.fn()}
      />
    </AppProvider>,
  );
  return { update, reapplyTemplate, onUpdated };
}

describe("SettingsPanel — aplicar", () => {
  test("sin cambios persiste la config y no toca el servidor", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    const workspace = makeWorkspace({ mcpNames: ["a"], skills: [], model: null });
    const { update, onUpdated } = setup(workspace, server);

    await screen.findByRole("checkbox", { name: /^a/ });
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(update).toHaveBeenCalledWith({ id: "w1", mcpNames: ["a"], skills: [], model: null });
    expect(server.mcp.add).not.toHaveBeenCalled();
    expect(server.mcp.remove).not.toHaveBeenCalled();
    expect(server.location.reload).not.toHaveBeenCalled();
    expect(onUpdated).toHaveBeenCalled();
  });

  test("añadir MCP y cambiar modelo sincroniza en caliente y recarga", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    const workspace = makeWorkspace({ mcpNames: ["a"], skills: [], model: null });
    const { update } = setup(workspace, server);

    await screen.findByRole("checkbox", { name: /^b/ });
    await user.click(screen.getByRole("checkbox", { name: /^b/ }));
    await user.type(
      screen.getByPlaceholderText("provider/modelo (vacío = el de la config global)"),
      "openai/gpt",
    );
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ mcpNames: ["a", "b"], model: "openai/gpt" }),
    );
    expect(server.mcp.add).toHaveBeenCalledWith({
      server: "b",
      config: { command: ["b"], disabled: false },
      location: { directory: "/tmp/demo" },
    });
    expect(server.location.reload).toHaveBeenCalled();
  });

  test("quitar un MCP llama a remove en el servidor", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    const workspace = makeWorkspace({ mcpNames: ["a"], skills: [], model: null });
    setup(workspace, server);

    const checkbox = await screen.findByRole("checkbox", { name: /^a/ });
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(server.mcp.remove).toHaveBeenCalledWith({
      server: "a",
      location: { directory: "/tmp/demo" },
    });
  });

  test("sin servidor solo persiste", async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({ mcpNames: ["a"], skills: [], model: null });
    const { update } = setup(workspace, null);

    await screen.findByRole("checkbox", { name: /^a/ });
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(update).toHaveBeenCalled();
  });
});

describe("SettingsPanel — reaplicar template", () => {
  test("delega en el gateway y notifica el workspace actualizado", async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      mcpNames: ["a"],
      skills: [],
      model: null,
      templateId: "plantilla",
      templateVersion: 1,
    });
    const { reapplyTemplate, onUpdated } = setup(workspace, null);

    await screen.findByRole("checkbox", { name: /^a/ });
    await user.click(screen.getByRole("button", { name: "Reaplicar template" }));

    expect(reapplyTemplate).toHaveBeenCalledWith("w1");
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ mcpNames: ["a", "b"] }), [
      "reaplicado",
    ]);
  });
});
