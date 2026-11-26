import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDialog, type SettingsSectionId } from "../SettingsDialog";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import type { ChatGateway } from "../../../domain/repositories/ChatGateway";
import type { McpInfo, Workspace } from "../../../types";
import { makeNotificationGateway, makeWorkspace } from "../../../tests/fakes";

const mcpA: McpInfo = { name: "a", config: { url: "http://a" }, source: "global" };
const mcpB: McpInfo = { name: "b", config: { command: ["b"] }, source: "global" };
const emptyLibrary = { agents: [], commands: [], plugins: [], skills: [], mcps: [] };

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

function setup(
  workspace: Workspace,
  server: ReturnType<typeof fakeServer> | null,
  notifications = makeNotificationGateway(),
  initialSection: SettingsSectionId = "mcps",
) {
  const update = vi.fn(
    async (input: { mcpNames: string[]; skills: unknown[]; model: string | null }) => ({
      workspace: { ...workspace, mcpNames: input.mcpNames, model: input.model },
      configPath: "/cfg",
      agentsPath: "/agents",
      warnings: [],
    }),
  );
  const reapplyProfile = vi.fn(async () => ({
    workspace: { ...workspace, mcpNames: ["a", "b"] },
    configPath: "/cfg",
    agentsPath: "/agents",
    warnings: ["reaplicado"],
  }));
  const root = new CompositionRoot({
    workspaces: { update, reapplyProfile } as never,
    library: {
      mcps: async () => [mcpA, mcpB],
      skills: async () => [],
    } as never,
    notifications,
  });
  const onUpdated = vi.fn();
  render(
    <AppProvider root={root}>
      <SettingsDialog
        workspace={workspace}
        client={server as unknown as ChatGateway | null}
        onWorkspaceUpdated={onUpdated}
        repos={[]}
        profiles={[]}
        library={emptyLibrary}
        workspaces={[workspace]}
        worktreesRoot="/wt"
        defaultProfileId={null}
        onReposChanged={vi.fn()}
        onProfilesChanged={vi.fn()}
        onWorktreesRootChanged={vi.fn()}
        initialSection={initialSection}
        onClose={vi.fn()}
      />
    </AppProvider>,
  );
  return { update, reapplyProfile, onUpdated, notifications };
}

describe("SettingsDialog — aplicar", () => {
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
    await user.click(screen.getByRole("button", { name: "Modelo" }));
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

describe("SettingsDialog — notificaciones", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("activarlas pide permiso y persiste la preferencia", async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({ mcpNames: [], skills: [] });
    const { notifications } = setup(workspace, null, undefined, "notifications");

    const toggle = screen.getByRole("checkbox", { name: /Avisarme cuando el agente/ });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(localStorage.getItem("opentemplates:notifications")).toBe("1");
  });

  test("si el sistema deniega el permiso no se activa y avisa", async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({ mcpNames: [], skills: [] });
    const { notifications } = setup(
      workspace,
      null,
      makeNotificationGateway("denied"),
      "notifications",
    );

    const toggle = screen.getByRole("checkbox", { name: /Avisarme cuando el agente/ });
    await user.click(toggle);

    expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/denegó el permiso de notificaciones/)).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem("opentemplates:notifications")).toBeNull();
  });

  test("desactivarlas no vuelve a pedir permiso y persiste el apagado", async () => {
    localStorage.setItem("opentemplates:notifications", "1");
    const user = userEvent.setup();
    const workspace = makeWorkspace({ mcpNames: [], skills: [] });
    const { notifications } = setup(workspace, null, undefined, "notifications");

    const toggle = screen.getByRole("checkbox", { name: /Avisarme cuando el agente/ });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    expect(notifications.requestPermission).not.toHaveBeenCalled();
    expect(localStorage.getItem("opentemplates:notifications")).toBe("0");
  });
});

describe("SettingsDialog — reaplicar perfil", () => {
  test("delega en el gateway y notifica el workspace actualizado", async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      mcpNames: ["a"],
      skills: [],
      model: null,
      profileId: "plantilla",
      profileVersion: 1,
    });
    const { reapplyProfile, onUpdated } = setup(workspace, null, undefined, "workspace-profile");

    await user.click(screen.getByRole("button", { name: "Reaplicar perfil" }));

    expect(reapplyProfile).toHaveBeenCalledWith("w1");
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ mcpNames: ["a", "b"] }), [
      "reaplicado",
    ]);
  });
});

describe("SettingsDialog — presupuesto", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("guarda el presupuesto por workspace y lo borra al vaciar el campo", async () => {
    const user = userEvent.setup();
    setup(makeWorkspace({ mcpNames: [], skills: [] }), null, undefined, "budget");

    const input = screen.getByLabelText("Presupuesto mensual en dólares");
    await user.type(input, "12.5");
    expect(localStorage.getItem("opentemplates:budget:w1")).toBe("12.5");

    await user.clear(input);
    expect(localStorage.getItem("opentemplates:budget:w1")).toBeNull();
  });

  test("no persiste importes no positivos y muestra el error", async () => {
    const user = userEvent.setup();
    setup(makeWorkspace({ mcpNames: [], skills: [] }), null, undefined, "budget");

    await user.type(screen.getByLabelText("Presupuesto mensual en dólares"), "0");
    expect(
      await screen.findByText("Introduce un importe mayor que 0 o deja el campo vacío."),
    ).toBeInTheDocument();
    expect(localStorage.getItem("opentemplates:budget:w1")).toBeNull();
  });
});
