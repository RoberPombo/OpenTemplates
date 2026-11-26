import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateWorkspace } from "../CreateWorkspace";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import { makeWorkspace } from "../../../tests/fakes";
import type { Library, Repo, ProfileManifest, Workspace } from "../../../types";

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

const library: Library = { agents: [], commands: [], plugins: [], skills: [], mcps: [] };

function setup(workspaces: Workspace[] = []) {
  const create = vi.fn(async (input: { name: string }) => ({
    workspace: makeWorkspace({ id: "nuevo", name: input.name }),
    configPath: "/cfg",
    agentsPath: "/agents",
    warnings: ["aviso"],
  }));
  const saveProfile = vi.fn(async (manifest: ProfileManifest) => manifest);
  const root = new CompositionRoot({
    workspaces: { create } as never,
    profiles: { save: saveProfile } as never,
    folderPicker: { pickDirectory: vi.fn(async () => "/carpeta") },
  });
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <AppProvider root={root}>
      <CreateWorkspace
        repos={[repo]}
        profiles={[profile]}
        library={library}
        workspaces={workspaces}
        worktreesRoot="/wt"
        onClose={onClose}
        onRepoAdded={vi.fn()}
        onProfileSaved={vi.fn()}
        onCreated={onCreated}
      />
    </AppProvider>,
  );
  return { create, saveProfile, onCreated, onClose };
}

async function goToNameStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Siguiente" }));
  await user.click(screen.getByRole("button", { name: "Siguiente" }));
}

describe("CreateWorkspace — wizard", () => {
  test("camino feliz: repo → perfil → nombre → crear con el input correcto", async () => {
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
        profileId: "plantilla",
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

  test("asocia etiquetas a los campos y Escape cierra el diálogo", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    expect(screen.getByRole("dialog", { name: "Nuevo workspace" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Crear perfil" }));
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(screen.getByLabelText("Descripción")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByLabelText("Nombre del workspace")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Rama/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Base/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Ruta del worktree/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  test("la carpeta suelta tiene una etiqueta asociada", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /Carpeta suelta/ }));
    expect(screen.getByLabelText("Carpeta")).toBeInTheDocument();
  });

  test("perfil rápido con id colisionado muestra error y no guarda", async () => {
    const user = userEvent.setup();
    const { saveProfile } = setup();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await user.click(screen.getByRole("button", { name: "Crear perfil" }));
    await user.type(screen.getByPlaceholderText("Backend, revisión, observabilidad…"), "Plantilla");
    await user.click(screen.getByRole("button", { name: "Crear y elegir" }));

    expect(screen.getByText('Ya existe un perfil con el id "plantilla".')).toBeInTheDocument();
    expect(saveProfile).not.toHaveBeenCalled();
  });
});
