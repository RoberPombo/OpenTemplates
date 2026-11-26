import { describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import { useWizard } from "../useWizard";
import { makeWorkspace } from "../../../tests/fakes";
import type { ProfileManifest, Repo, Workspace } from "../../../types";

const repo: Repo = {
  id: "r1",
  name: "Repo",
  path: "/repo",
  remote: null,
  provider: "github",
  mainBranch: "main",
  createdAt: 0,
  updatedAt: 0,
};

const profile: ProfileManifest = {
  id: "plantilla",
  name: "Plantilla",
  description: "",
  version: 1,
  agents: [],
  skills: [],
  mcps: [],
  commands: [],
  plugins: [],
  models: [],
  model: null,
  permissions: [],
  createdAt: 0,
  updatedAt: 0,
};

function setup({
  workspaces = [],
  addRepoError,
}: {
  workspaces?: Workspace[];
  addRepoError?: Error;
} = {}) {
  const create = vi.fn(async (input: { name: string }) => ({
    workspace: makeWorkspace({ id: "nuevo", name: input.name }),
    configPath: "/cfg",
    agentsPath: "/agents",
    warnings: ["aviso"],
  }));
  const addRepo = vi.fn(async () => {
    if (addRepoError) throw addRepoError;
    return { ...repo, id: "r2", name: "Nuevo", path: "/nuevo" };
  });
  const saveProfile = vi.fn(async (manifest: ProfileManifest) => manifest);
  const root = new CompositionRoot({
    workspaces: { create } as never,
    repos: { add: addRepo } as never,
    profiles: { save: saveProfile } as never,
    folderPicker: { pickDirectory: vi.fn(async () => "/nuevo") },
  });
  const onRepoAdded = vi.fn();
  const onProfileSaved = vi.fn();
  const onCreated = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProvider root={root}>{children}</AppProvider>
  );
  const view = renderHook(
    () =>
      useWizard({
        repos: [repo],
        profiles: [profile],
        workspaces,
        worktreesRoot: "/wt",
        onRepoAdded,
        onProfileSaved,
        onCreated,
      }),
    { wrapper },
  );
  return { create, addRepo, saveProfile, onRepoAdded, onProfileSaved, onCreated, ...view };
}

describe("useWizard", () => {
  test("camino feliz: deriva slug, avanza pasos y crea con el input correcto", async () => {
    const { result, create, onCreated } = setup();

    expect(result.current.repo?.id).toBe("r1");
    expect(result.current.profile?.id).toBe("plantilla");
    expect(result.current.canContinue()).toBe(true);

    act(() => result.current.setName("Login Safari"));
    expect(result.current.slug).toBe("login-safari");
    expect(result.current.defaultBranch).toBe("login-safari");
    expect(result.current.defaultPath).toBe("/wt/repo/login-safari");

    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.step).toBe(2);
    expect(result.current.canContinue()).toBe(true);

    act(() => result.current.next());
    await act(async () => {
      await result.current.create();
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Login Safari",
        repoId: "r1",
        profileId: "plantilla",
        mode: "worktree",
        branch: null,
        base: null,
        worktreePath: null,
        mcpNames: [],
        skills: [],
        model: null,
      }),
    );
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "nuevo" }),
      ["aviso"],
      false,
    );
  });

  test("expone los conflictos de checkout principal y de ruta del repo", () => {
    const ocupado = makeWorkspace({
      id: "ocupado",
      name: "Ocupado",
      repoId: "r1",
      projectPath: "/repo",
      mode: "principal",
    });
    const { result } = setup({ workspaces: [ocupado] });

    expect(result.current.principalConflicts.map((workspace) => workspace.id)).toEqual(["ocupado"]);
    expect(result.current.pathConflicts.map((workspace) => workspace.id)).toEqual(["ocupado"]);
  });

  test("error al dar de alta el repo queda visible y no selecciona nada", async () => {
    const { result, addRepo, onRepoAdded } = setup({
      addRepoError: new Error("La carpeta no es un repositorio git."),
    });

    await act(async () => {
      await result.current.pickRepo();
    });

    expect(addRepo).toHaveBeenCalledWith("/nuevo");
    expect(result.current.error).toBe("La carpeta no es un repositorio git.");
    expect(onRepoAdded).not.toHaveBeenCalled();
    expect(result.current.repoId).toBe("r1");
  });
});
