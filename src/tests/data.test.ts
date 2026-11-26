// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import {
  TauriBootstrapGateway,
  TauriLibraryGateway,
  TauriRepoGateway,
  TauriResourcesGateway,
  TauriSettingsGateway,
  TauriProfileGateway,
  TauriWorkspaceGateway,
} from "../data/TauriGateways";
import { LocalStoragePreferences } from "../data/LocalStoragePreferences";
import { CompositionRoot } from "../CompositionRoot";
import { makeWorkspace } from "../tests/fakes";

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
});

// Contrato de los adaptadores: se conservan los tests de mapeo de argumentos camelCase
// y de normalización de errores porque son comportamiento propio del adaptador, no una
// delegación 1:1. Los tests de simple reenvío (p. ej. WindowConfirmDialog → window.confirm)
// se retiraron: se rompen con cualquier refactor sin detectar un fallo real.
describe("TauriGateways — mapeo de comandos y argumentos", () => {
  test("mapea llamadas del workspace a los comandos con args camelCase", async () => {
    invoke.mockResolvedValue(undefined);
    const gateway = new TauriWorkspaceGateway();
    await gateway.delete("w1", { removeWorktree: true, force: true });
    expect(invoke).toHaveBeenCalledWith("delete_workspace", {
      id: "w1",
      removeWorktree: true,
      force: true,
      deleteDb: undefined,
    });
    await gateway.start("w1");
    expect(invoke).toHaveBeenCalledWith("start_workspace", { id: "w1" });
    await gateway.log("w1");
    expect(invoke).toHaveBeenCalledWith("workspace_log", { id: "w1", lines: 200 });
  });

  test("repo/perfil/settings/library/resources/bootstrap", async () => {
    invoke.mockResolvedValue(null);
    await new TauriRepoGateway().add("/repo");
    expect(invoke).toHaveBeenCalledWith("add_repo", { path: "/repo" });
    await new TauriProfileGateway().saveAgentsMd("t1", "contenido");
    expect(invoke).toHaveBeenCalledWith("save_profile_agents_md", {
      id: "t1",
      content: "contenido",
    });
    await new TauriSettingsGateway().get();
    expect(invoke).toHaveBeenCalledWith("get_settings");
    await new TauriLibraryGateway().skills("/p");
    expect(invoke).toHaveBeenCalledWith("list_skills", { projectPath: "/p" });
    await new TauriResourcesGateway().usage(42);
    expect(invoke).toHaveBeenCalledWith("resources", { pid: 42 });
    await new TauriBootstrapGateway().bootstrap();
    expect(invoke).toHaveBeenCalledWith("bootstrap");
  });

  test("errores de transporte se normalizan a Error con mensaje legible", async () => {
    invoke.mockRejectedValue("comando roto");
    await expect(new TauriWorkspaceGateway().start("w1")).rejects.toThrow("comando roto");
    invoke.mockRejectedValue({ code: 500 });
    await expect(new TauriRepoGateway().list()).rejects.toThrow('{"code":500}');
  });
});

describe("LocalStoragePreferences", () => {
  test("get/set/remove sobre localStorage", () => {
    const preferences = new LocalStoragePreferences();
    expect(preferences.get("opentemplates:selected")).toBeNull();
    preferences.set("opentemplates:selected", "w1");
    expect(localStorage.getItem("opentemplates:selected")).toBe("w1");
    expect(preferences.get("opentemplates:selected")).toBe("w1");
    preferences.remove("opentemplates:selected");
    expect(preferences.get("opentemplates:selected")).toBeNull();
  });
});

describe("CompositionRoot", () => {
  // La política (confirmar y borrar) la cubre DeleteWorkspace en el dominio; aquí solo se
  // comprueba que el Composition Root inyecta los puertos sobrescritos y no otros.
  test("provideDeleteWorkspace cablea gateway y confirmación (sobrescribibles en tests)", async () => {
    const deleted: string[] = [];
    const root = new CompositionRoot({
      workspaces: {
        delete: async (id: string) => {
          deleted.push(id);
        },
      } as never,
      confirm: { confirm: () => true },
    });
    const result = await root.provideDeleteWorkspace().execute(makeWorkspace());
    expect(result.deleted).toBe(true);
    expect(deleted).toEqual(["w1"]);
  });
});
