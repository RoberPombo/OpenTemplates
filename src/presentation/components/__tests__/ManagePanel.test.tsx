import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ManagePanel } from "../ManagePanel";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import type { Library, Repo, ProfileManifest } from "../../../types";

// Caracterización de ManagePanel con los puertos fake inyectados por
// CompositionRoot: repos, perfiles, ajustes, selector de carpetas y confirmación.

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

const library: Library = {
  agents: [
    { id: "a1", name: "Agente", description: "Agente global", path: "/a1", source: "global" },
  ],
  commands: [],
  plugins: [],
  skills: [{ id: "s1", name: "Skill", description: "Skill global", path: "/s1", source: "global" }],
  mcps: [{ name: "mcp-a", config: { url: "http://a" }, source: "global" }],
};

function setup(profiles: ProfileManifest[] = [profile]) {
  let stored = [...profiles];
  const reposList = vi.fn(async () => [repo]);
  const add = vi.fn(async () => repo);
  const refresh = vi.fn(async () => repo);
  const remove = vi.fn(async () => undefined);
  const save = vi.fn(async (manifest: ProfileManifest) => {
    const saved = { ...manifest };
    stored = [saved];
    return saved;
  });
  const saveAgentsMd = vi.fn(async () => "");
  const list = vi.fn(async () => stored);
  const deleteProfile = vi.fn(async () => undefined);
  const agentsMd = vi.fn(async () => "# AGENTS");
  const saveSettings = vi.fn(async (settings: { worktreesRoot?: string | null }) => settings);
  const confirm = vi.fn(() => true);
  const pickDirectory = vi.fn(async () => "/nuevo/repo");
  const listModels = vi.fn(async () => [
    {
      key: "anthropic/claude",
      providerID: "anthropic",
      id: "claude",
      name: "Claude",
      inputModalities: ["text"],
      outputModalities: ["text"],
    },
    {
      key: "openai/gpt",
      providerID: "openai",
      id: "gpt",
      name: "GPT",
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
    },
  ]);

  const root = new CompositionRoot({
    repos: { list: reposList, add, refresh, remove } as never,
    profiles: {
      save,
      saveAgentsMd,
      list,
      delete: deleteProfile,
      agentsMd,
    } as never,
    settings: { save: saveSettings } as never,
    modelCatalog: { list: listModels } as never,
    confirm: { confirm } as never,
    folderPicker: { pickDirectory } as never,
  });

  const onReposChanged = vi.fn();
  const onProfilesChanged = vi.fn();
  const onWorktreesRootChanged = vi.fn();
  render(
    <AppProvider root={root}>
      <ManagePanel
        repos={[repo]}
        profiles={profiles}
        library={library}
        workspaces={[]}
        worktreesRoot="/wt"
        defaultProfileId={null}
        onReposChanged={onReposChanged}
        onProfilesChanged={onProfilesChanged}
        onWorktreesRootChanged={onWorktreesRootChanged}
        onClose={vi.fn()}
      />
    </AppProvider>,
  );

  return {
    root,
    add,
    refresh,
    remove,
    listRepos: reposList,
    save,
    saveAgentsMd,
    list,
    deleteProfile,
    agentsMd,
    saveSettings,
    confirm,
    pickDirectory,
    onReposChanged,
    onProfilesChanged,
    onWorktreesRootChanged,
  };
}

describe("ManagePanel — repos", () => {
  test("añadir repo usa el selector y recarga la lista", async () => {
    const user = userEvent.setup();
    const { add, listRepos, pickDirectory, onReposChanged } = setup();

    await user.click(screen.getByRole("button", { name: /Añadir repo/ }));

    expect(pickDirectory).toHaveBeenCalledWith("Elegir repositorio git");
    expect(add).toHaveBeenCalledWith("/nuevo/repo");
    await waitFor(() => expect(listRepos).toHaveBeenCalled());
    expect(onReposChanged).toHaveBeenCalledWith([repo]);
  });

  test("quitar repo pide confirmación y delega en el puerto", async () => {
    const user = userEvent.setup();
    const { remove, confirm, onReposChanged } = setup();

    await user.click(screen.getByRole("button", { name: "Quitar" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Repo"));
    expect(remove).toHaveBeenCalledWith("r1");
    expect(onReposChanged).toHaveBeenCalledWith([repo]);
  });
});

describe("ManagePanel — perfiles", () => {
  test("crea un perfil nuevo con id derivado del nombre y modelos normalizados", async () => {
    const user = userEvent.setup();
    const { save, saveAgentsMd, onProfilesChanged } = setup();

    await user.click(screen.getByRole("button", { name: "Perfiles" }));
    await user.click(screen.getByRole("button", { name: /Nuevo perfil/ }));
    await user.type(screen.getByLabelText("Nombre"), "Backend review");
    const models = await screen.findByRole("combobox", { name: "Modelos del perfil" });
    await user.click(models);
    await user.type(models, "claude");
    await user.click(await screen.findByRole("option", { name: /claude/ }));
    await user.click(screen.getByRole("button", { name: "Guardar perfil" }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "backend-review",
        name: "Backend review",
        models: ["anthropic/claude"],
        model: null,
      }),
    );
    expect(saveAgentsMd).toHaveBeenCalledWith("backend-review", "");
    expect(onProfilesChanged).toHaveBeenCalledWith([
      expect.objectContaining({ id: "backend-review", name: "Backend review" }),
    ]);
    expect(await screen.findByText(/Profile guardado/)).toBeInTheDocument();
  });

  test("el selector de suscripción filtra los modelos disponibles", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Perfiles" }));
    const subscription = await screen.findByRole("combobox", { name: "Suscripción" });
    await user.click(subscription);
    await user.click(await screen.findByRole("option", { name: "openai" }));

    const models = await screen.findByRole("combobox", { name: "Modelos del perfil" });
    await user.click(models);

    expect(await screen.findByRole("option", { name: /gpt \(openai\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /claude/ })).not.toBeInTheDocument();
  });

  test("sin nombre muestra error y no guarda", async () => {
    const user = userEvent.setup();
    const { save } = setup();

    await user.click(screen.getByRole("button", { name: "Perfiles" }));
    await user.click(screen.getByRole("button", { name: /Nuevo perfil/ }));
    await user.click(screen.getByRole("button", { name: "Guardar perfil" }));

    expect(screen.getByText("El perfil necesita un nombre.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  test("seleccionar un perfil carga su AGENTS.md", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Perfiles" }));
    expect(await screen.findByDisplayValue("# AGENTS")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Plantilla");
  });
});

describe("ManagePanel — ajustes", () => {
  test("guardar la raíz de worktrees delega en settings y notifica la raíz resultante", async () => {
    const user = userEvent.setup();
    const { saveSettings, onWorktreesRootChanged } = setup();

    await user.click(screen.getByRole("button", { name: "Ajustes" }));
    const input = screen.getByPlaceholderText("/wt");
    await user.clear(input);
    await user.type(input, "/nuevo/wt");
    await user.click(screen.getByRole("button", { name: "Guardar ajustes" }));

    expect(saveSettings).toHaveBeenCalledWith({
      version: 2,
      worktreesRoot: "/nuevo/wt",
      defaultProfileId: null,
    });
    expect(onWorktreesRootChanged).toHaveBeenCalledWith("/nuevo/wt");
    expect(await screen.findByText("Ajustes guardados.")).toBeInTheDocument();
  });
});
