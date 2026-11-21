import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateWorkspace } from "../CreateWorkspace";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../CompositionRoot";
import { makeWorkspace } from "../../tests/fakes";
import type { Library, Repo, TemplateManifest, Workspace } from "../../types";

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

const template: TemplateManifest = {
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

const library: Library = { agents: [], commands: [], plugins: [], skills: [], mcps: [] };

function setup(workspaces: Workspace[] = []) {
  const create = vi.fn(async (input: { name: string }) => ({
    workspace: makeWorkspace({ id: "nuevo", name: input.name }),
    configPath: "/cfg",
    agentsPath: "/agents",
    warnings: ["aviso"],
  }));
  const saveTemplate = vi.fn(async (manifest: TemplateManifest) => manifest);
  const root = new CompositionRoot({
    workspaces: { create } as never,
    templates: { save: saveTemplate } as never,
    folderPicker: { pickDirectory: vi.fn(async () => "/carpeta") },
  });
  const onCreated = vi.fn();
  render(
    <AppProvider root={root}>
      <CreateWorkspace
        repos={[repo]}
        templates={[template]}
        library={library}
        workspaces={workspaces}
        worktreesRoot="/wt"
        onClose={vi.fn()}
        onRepoAdded={vi.fn()}
        onTemplateSaved={vi.fn()}
        onCreated={onCreated}
      />
    </AppProvider>,
  );
  return { create, saveTemplate, onCreated };
}

async function goToNameStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Siguiente" }));
  await user.click(screen.getByRole("button", { name: "Siguiente" }));
}

describe("CreateWorkspace — wizard", () => {
  test("camino feliz: repo → template → nombre → crear con el input correcto", async () => {
    const user = userEvent.setup();
    const { create, onCreated } = setup();

    expect(screen.getByText("Repositorio")).toBeInTheDocument();
    await goToNameStep(user);

    const next = screen.getByRole("button", { name: "Siguiente" });
    expect(next).toBeDisabled();

    await user.type(screen.getByPlaceholderText("login-safari, revisión-api…"), "Login Safari");
    expect(screen.getByText("id de rama y carpeta: login-safari")).toBeInTheDocument();
    expect(next).toBeEnabled();

    await user.click(next);
    expect(screen.getByRole("heading", { name: "Resumen" })).toBeInTheDocument();
    expect(screen.getByText("/wt/repo/login-safari")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Crear workspace" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Login Safari",
        repoId: "r1",
        templateId: "plantilla",
        mode: "worktree",
        branch: null,
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

  test("rama existente exige nombre de rama para continuar", async () => {
    const user = userEvent.setup();
    setup();
    await goToNameStep(user);
    await user.type(screen.getByPlaceholderText("login-safari, revisión-api…"), "ws");

    await user.click(screen.getByText("Usar una rama existente"));
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();

    await user.type(screen.getByLabelText(/^Rama/), "dev");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled();
  });

  test("avisa del conflicto de checkout principal", async () => {
    const user = userEvent.setup();
    setup([makeWorkspace({ id: "ocupado", repoId: "r1", mode: "principal", name: "Ocupado" })]);
    await goToNameStep(user);
    await user.type(screen.getByPlaceholderText("login-safari, revisión-api…"), "ws");

    expect(screen.queryByText(/Ya hay/)).toBeNull();
    await user.click(screen.getByText("Checkout principal"));
    expect(screen.getByText(/Ya hay un workspace sobre el checkout principal/)).toBeInTheDocument();
    expect(screen.getByText(/Ocupado/)).toBeInTheDocument();
  });

  test("template rápido con id colisionado muestra error y no guarda", async () => {
    const user = userEvent.setup();
    const { saveTemplate } = setup();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await user.click(screen.getByRole("button", { name: "Crear template" }));
    await user.type(screen.getByPlaceholderText("Backend, revisión, observabilidad…"), "Plantilla");
    await user.click(screen.getByRole("button", { name: "Crear y elegir" }));

    expect(screen.getByText('Ya existe un template con el id "plantilla".')).toBeInTheDocument();
    expect(saveTemplate).not.toHaveBeenCalled();
  });
});
