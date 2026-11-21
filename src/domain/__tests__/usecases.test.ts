// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { DeleteWorkspace } from "../usecases/DeleteWorkspace";
import { ApplyWorkspaceSettings } from "../usecases/ApplyWorkspaceSettings";
import { CreateWorkspace } from "../usecases/CreateWorkspace";
import type { WorkspaceGateway } from "../repositories/WorkspaceGateway";
import type { ConfirmDialog } from "../repositories/Dialogs";
import type { ChatGateway } from "../repositories/ChatGateway";
import type { ConfigOutcome, McpInfo, Workspace } from "../../types";
import { makeWorkspace } from "../../tests/fakes";

function fakeGateway(overrides: Partial<WorkspaceGateway> = {}): WorkspaceGateway {
  const notImplemented = () => {
    throw new Error("no implementado en el fake");
  };
  return {
    create: vi.fn(notImplemented),
    update: vi.fn(notImplemented),
    setDisabled: vi.fn(notImplemented),
    reapplyTemplate: vi.fn(notImplemented),
    delete: vi.fn(async () => undefined),
    start: vi.fn(notImplemented),
    stop: vi.fn(notImplemented),
    status: vi.fn(notImplemented),
    worktreeStatus: vi.fn(async () => ({ exists: true, dirty: false, branch: "dev", path: "/wt" })),
    log: vi.fn(notImplemented),
    ...overrides,
  } as WorkspaceGateway;
}

function fakeConfirm(answers: boolean[]): ConfirmDialog & { messages: string[] } {
  const messages: string[] = [];
  let index = 0;
  return {
    messages,
    confirm(message: string) {
      messages.push(message);
      return answers[index++] ?? false;
    },
  };
}

const outcome = (workspace: Workspace): ConfigOutcome => ({
  workspace,
  configPath: "/cfg",
  agentsPath: "/agents",
  warnings: [],
});

describe("DeleteWorkspace — política de confirmación", () => {
  test("adhoc: una confirmación y delete sin worktree", async () => {
    const workspace = makeWorkspace({ mode: "adhoc", name: "Demo" });
    const gateway = fakeGateway();
    const confirm = fakeConfirm([true]);
    const result = await new DeleteWorkspace(gateway, confirm).execute(workspace);
    expect(result).toEqual({ deleted: true });
    expect(confirm.messages).toEqual([
      "¿Eliminar el workspace «Demo»? Se parará el servidor y se quitará de la lista. La carpeta del proyecto no se toca.",
    ]);
    expect(gateway.delete).toHaveBeenCalledWith("w1", { removeWorktree: false, force: false });
    expect(gateway.worktreeStatus).not.toHaveBeenCalled();
  });

  test("adhoc cancelado no borra", async () => {
    const gateway = fakeGateway();
    const result = await new DeleteWorkspace(gateway, fakeConfirm([false])).execute(
      makeWorkspace(),
    );
    expect(result).toEqual({ deleted: false });
    expect(gateway.delete).not.toHaveBeenCalled();
  });

  test("worktree limpio: consulta estado, confirma con la rama y borra sin force", async () => {
    const workspace = makeWorkspace({ mode: "worktree", branch: null, name: "WT" });
    const gateway = fakeGateway();
    const confirm = fakeConfirm([true]);
    const result = await new DeleteWorkspace(gateway, confirm).execute(workspace);
    expect(result).toEqual({ deleted: true });
    expect(gateway.worktreeStatus).toHaveBeenCalledWith("w1");
    expect(confirm.messages[0]).toContain("La rama «dev» se conserva.");
    expect(gateway.delete).toHaveBeenCalledWith("w1", { removeWorktree: true, force: false });
  });

  test("worktree sucio: segunda confirmación acepta → force", async () => {
    const workspace = makeWorkspace({ mode: "worktree", branch: "mia" });
    const gateway = fakeGateway({
      worktreeStatus: vi.fn(async () => ({
        exists: true,
        dirty: true,
        branch: "dev",
        path: "/wt",
      })),
    });
    const confirm = fakeConfirm([true, true]);
    const result = await new DeleteWorkspace(gateway, confirm).execute(workspace);
    expect(result).toEqual({ deleted: true });
    expect(confirm.messages).toHaveLength(2);
    expect(confirm.messages[0]).toContain("La rama «mia» se conserva.");
    expect(confirm.messages[1]).toBe(
      "El worktree tiene cambios sin commitear. ¿Eliminarlo igualmente? La rama se conservará.",
    );
    expect(gateway.delete).toHaveBeenCalledWith("w1", { removeWorktree: true, force: true });
  });

  test("worktree sucio: segunda confirmación rechaza → no borra", async () => {
    const gateway = fakeGateway({
      worktreeStatus: vi.fn(async () => ({ exists: true, dirty: true, branch: null, path: "/wt" })),
    });
    const confirm = fakeConfirm([true, false]);
    const result = await new DeleteWorkspace(gateway, confirm).execute(
      makeWorkspace({ mode: "worktree", branch: null }),
    );
    expect(result).toEqual({ deleted: false });
    expect(confirm.messages[0]).toContain("La rama «de trabajo» se conserva.");
    expect(gateway.delete).not.toHaveBeenCalled();
  });

  test("primera confirmación rechaza en worktree → no borra ni consulta dirty", async () => {
    const gateway = fakeGateway();
    const result = await new DeleteWorkspace(gateway, fakeConfirm([false])).execute(
      makeWorkspace({ mode: "worktree" }),
    );
    expect(result).toEqual({ deleted: false });
    expect(gateway.delete).not.toHaveBeenCalled();
  });

  test("error al consultar el worktree se propaga (la UI lo muestra como notice)", async () => {
    const gateway = fakeGateway({
      worktreeStatus: vi.fn(async () => {
        throw new Error("git roto");
      }),
    });
    await expect(
      new DeleteWorkspace(gateway, fakeConfirm([true])).execute(
        makeWorkspace({ mode: "worktree" }),
      ),
    ).rejects.toThrow("git roto");
    expect(gateway.delete).not.toHaveBeenCalled();
  });
});

describe("ApplyWorkspaceSettings", () => {
  const workspace = makeWorkspace({
    mcpNames: ["a", "b"],
    skills: [{ id: "s1", path: "/s1" }],
    model: "anthropic/claude",
  });
  const mcps: McpInfo[] = [
    { name: "a", config: { url: "http://a" }, source: "global" },
    { name: "c", config: { command: ["c"] }, source: "global" },
  ];

  function fakeServer() {
    return {
      mcp: {
        list: vi.fn(async () => ({ data: [] })),
        add: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
      location: { reload: vi.fn(async () => undefined) },
    } as unknown as ChatGateway;
  }

  test("actualiza config, quita MCPs sobrantes, añade nuevos y recarga si cambian skills/modelo", async () => {
    const updated = makeWorkspace({ mcpNames: ["b", "c"] });
    const gateway = fakeGateway({ update: vi.fn(async () => outcome(updated)) });
    const server = fakeServer();
    const useCase = new ApplyWorkspaceSettings(gateway, server);

    const result = await useCase.execute({
      workspace,
      mcpNames: ["b", "c"],
      skills: [{ id: "s2", path: "/s2" }],
      model: " anthropic/claude ",
      mcps,
    });

    expect(gateway.update).toHaveBeenCalledWith({
      id: "w1",
      mcpNames: ["b", "c"],
      skills: [{ id: "s2", path: "/s2" }],
      model: "anthropic/claude",
    });
    expect(server.mcp.remove).toHaveBeenCalledWith({
      server: "a",
      location: { directory: "/tmp/demo" },
    });
    expect(server.mcp.add).toHaveBeenCalledWith({
      server: "c",
      config: { command: ["c"], disabled: false },
      location: { directory: "/tmp/demo" },
    });
    expect(server.location.reload).toHaveBeenCalled();
    expect(result.outcome.workspace).toBe(updated);
    expect(result.mcpErrors).toEqual([]);
  });

  test("sin cambios de skills/modelo no recarga; modelo vacío → null", async () => {
    const sinModelo = { ...workspace, model: null };
    const gateway = fakeGateway({ update: vi.fn(async () => outcome(sinModelo)) });
    const server = fakeServer();
    await new ApplyWorkspaceSettings(gateway, server).execute({
      workspace: sinModelo,
      mcpNames: ["a", "b"],
      skills: [{ id: "s1", path: "/s1" }],
      model: "  ",
      mcps,
    });
    expect(gateway.update).toHaveBeenCalledWith(expect.objectContaining({ model: null }));
    expect(server.location.reload).not.toHaveBeenCalled();
    expect(server.mcp.add).not.toHaveBeenCalled();
    expect(server.mcp.remove).not.toHaveBeenCalled();
  });

  test("sin servidor solo actualiza la config", async () => {
    const gateway = fakeGateway({ update: vi.fn(async () => outcome(workspace)) });
    const result = await new ApplyWorkspaceSettings(gateway, null).execute({
      workspace,
      mcpNames: [],
      skills: [],
      model: "",
      mcps,
    });
    expect(result.outcome.workspace).toBe(workspace);
  });

  test("MCP nuevo sin info en la biblioteca se omite; error al añadir se recoge", async () => {
    const gateway = fakeGateway({ update: vi.fn(async () => outcome(workspace)) });
    const server = fakeServer();
    (server.mcp.add as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no conecta"));
    const result = await new ApplyWorkspaceSettings(gateway, server).execute({
      workspace,
      mcpNames: ["a", "b", "c", "desconocido"],
      skills: [{ id: "s1", path: "/s1" }],
      model: "anthropic/claude",
      mcps,
    });
    expect(server.mcp.add).toHaveBeenCalledTimes(1);
    expect(result.mcpErrors).toEqual(["no conecta"]);
  });

  test("error al quitar un MCP se ignora (como en el original)", async () => {
    const gateway = fakeGateway({ update: vi.fn(async () => outcome(workspace)) });
    const server = fakeServer();
    (server.mcp.remove as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ya no existe"));
    const result = await new ApplyWorkspaceSettings(gateway, server).execute({
      workspace,
      mcpNames: ["b"],
      skills: [{ id: "s1", path: "/s1" }],
      model: "anthropic/claude",
      mcps,
    });
    expect(result.mcpErrors).toEqual([]);
  });
});

describe("CreateWorkspace", () => {
  test("nombre vacío lanza con el mensaje de dominio", async () => {
    const gateway = fakeGateway();
    await expect(new CreateWorkspace(gateway).execute({ name: "   " })).rejects.toThrow(
      "Ponle un nombre al workspace.",
    );
    expect(gateway.create).not.toHaveBeenCalled();
  });

  test("nombre válido delega en el gateway", async () => {
    const workspace = makeWorkspace({ name: "Nuevo" });
    const gateway = fakeGateway({ create: vi.fn(async () => outcome(workspace)) });
    const result = await new CreateWorkspace(gateway).execute({ name: "Nuevo" });
    expect(result.workspace).toBe(workspace);
    expect(gateway.create).toHaveBeenCalledWith({ name: "Nuevo" });
  });
});
