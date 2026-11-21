import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Bootstrap, Workspace } from "../types";

const apiMock = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  listLibrary: vi.fn(),
  listMcps: vi.fn(),
  listSkills: vi.fn(),
  workspaceStatus: vi.fn(),
  startWorkspace: vi.fn(),
  stopWorkspace: vi.fn(),
  worktreeStatus: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

vi.mock("../data/tauriCommands", () => ({ api: apiMock }));
vi.mock("../components/PerformanceCapture", () => ({ default: () => null }));
vi.mock("../components/WorkspaceView", () => ({
  WorkspaceView: ({
    workspace,
    server,
    starting,
    onStart,
    onStop,
    onDelete,
  }: {
    workspace: Workspace;
    server?: unknown;
    starting: boolean;
    onStart: () => void;
    onStop: () => void;
    onDelete: () => void;
  }) => (
    <div>
      <span>view:{workspace.name}</span>
      <span>
        state:{server ? "live" : "off"}
        {starting ? ":starting" : ""}
      </span>
      <button onClick={onStart}>start</button>
      <button onClick={onStop}>stop</button>
      <button onClick={onDelete}>delete</button>
    </div>
  ),
}));
vi.mock("../components/CreateWorkspace", () => ({
  CreateWorkspace: ({
    onClose,
    onCreated,
  }: {
    onClose: () => void;
    onCreated: (workspace: Workspace, warnings: string[], startNow: boolean) => void;
  }) => (
    <div>
      <button
        onClick={() =>
          onCreated(
            {
              id: "nuevo",
              name: "Nuevo",
              projectPath: "/nuevo",
              mode: "adhoc",
              mcpNames: [],
              disabledMcps: [],
              skills: [],
              disabledSkills: [],
              agents: [],
              commands: [],
              plugins: [],
              models: [],
              createdAt: 0,
              updatedAt: 0,
            },
            ["aviso"],
            false,
          )
        }
      >
        create
      </button>
      <button onClick={onClose}>close-create</button>
    </div>
  ),
}));
vi.mock("../components/ManagePanel", () => ({
  ManagePanel: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close-manage</button>
  ),
}));

import App from "../App";
import { AppProvider } from "../context/AppContext";

const w1: Workspace = {
  id: "w1",
  name: "Primero",
  repoId: "r1",
  projectPath: "/repo",
  mode: "adhoc",
  mcpNames: [],
  disabledMcps: [],
  skills: [],
  disabledSkills: [],
  agents: [],
  commands: [],
  plugins: [],
  models: [],
  createdAt: 0,
  updatedAt: 0,
};
const w2: Workspace = { ...w1, id: "w2", name: "Segundo", mode: "worktree", branch: "dev" };

const bootstrap: Bootstrap = {
  workspaces: [w1, w2],
  repos: [
    {
      id: "r1",
      name: "Repo",
      path: "/repo",
      remote: null,
      provider: "github",
      mainBranch: "main",
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  templates: [],
  settings: { version: 1 },
  worktreesRoot: "/wt",
  running: [],
  dataDir: "/data",
  opencodeBin: "/bin/opencode",
  error: null,
  notices: [],
};

function renderApp() {
  return render(
    <AppProvider>
      <App />
    </AppProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  apiMock.bootstrap.mockResolvedValue(bootstrap);
  apiMock.listLibrary.mockResolvedValue({
    agents: [],
    commands: [],
    plugins: [],
    skills: [],
    mcps: [],
  });
  apiMock.workspaceStatus.mockResolvedValue([]);
  apiMock.deleteWorkspace.mockResolvedValue(undefined);
  apiMock.worktreeStatus.mockResolvedValue({
    exists: true,
    dirty: false,
    branch: "dev",
    path: "/wt",
  });
});

describe("App — carga y selección", () => {
  test("bootstrap pinta la lista agrupada y autoselecciona el primero", async () => {
    renderApp();
    expect(await screen.findByText("Primero")).toBeInTheDocument();
    expect(screen.getByText("Segundo")).toBeInTheDocument();
    expect(screen.getByText("Repo")).toBeInTheDocument();
    expect(screen.getByText("view:Primero")).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("openconf:selected")).toBe("w1"));
    expect(apiMock.listLibrary).toHaveBeenCalled();
  });

  test("respeta la selección guardada", async () => {
    localStorage.setItem("openconf:selected", "w2");
    renderApp();
    expect(await screen.findByText("view:Segundo")).toBeInTheDocument();
  });

  test("seleccionar otro workspace persiste el id", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText("Primero");
    await user.click(screen.getByText("Segundo"));
    expect(screen.getByText("view:Segundo")).toBeInTheDocument();
    expect(localStorage.getItem("openconf:selected")).toBe("w2");
  });

  test("fallo de bootstrap muestra pantalla fatal", async () => {
    apiMock.bootstrap.mockRejectedValue(new Error("sin backend"));
    renderApp();
    expect(await screen.findByText("OpenConf no pudo arrancar")).toBeInTheDocument();
    expect(screen.getByText("sin backend")).toBeInTheDocument();
  });
});

describe("App — ciclo de vida", () => {
  test("arrancar marca starting y luego live", async () => {
    const user = userEvent.setup();
    let resolveStart: (value: unknown) => void = () => {};
    apiMock.startWorkspace.mockImplementation(
      () => new Promise((resolve) => (resolveStart = resolve)),
    );
    renderApp();
    await screen.findByText("view:Primero");
    await user.click(screen.getByText("start"));
    expect(screen.getByText("state:off:starting")).toBeInTheDocument();
    resolveStart({ workspaceId: "w1", baseUrl: "http://x", password: "p", port: 1, pid: 9 });
    expect(await screen.findByText("state:live")).toBeInTheDocument();
    expect(apiMock.startWorkspace).toHaveBeenCalledWith("w1");
  });

  test("parar quita el servidor", async () => {
    const user = userEvent.setup();
    apiMock.bootstrap.mockResolvedValue({
      ...bootstrap,
      running: [{ workspaceId: "w1", baseUrl: "http://x", password: "p", port: 1, pid: 9 }],
    });
    apiMock.stopWorkspace.mockResolvedValue(undefined);
    renderApp();
    await screen.findByText("state:live");
    await user.click(screen.getByText("stop"));
    expect(await screen.findByText("state:off")).toBeInTheDocument();
    expect(apiMock.stopWorkspace).toHaveBeenCalledWith("w1");
  });

  test("error al arrancar se muestra como notice", async () => {
    const user = userEvent.setup();
    apiMock.startWorkspace.mockRejectedValue(new Error("puerto ocupado"));
    renderApp();
    await screen.findByText("view:Primero");
    await user.click(screen.getByText("start"));
    expect(await screen.findByText("puerto ocupado")).toBeInTheDocument();
  });
});

describe("App — borrado con política", () => {
  test("adhoc: confirma y borra; la selección salta al siguiente", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp();
    await screen.findByText("view:Primero");
    await user.click(screen.getByText("delete"));
    await waitFor(() => expect(screen.queryByText("Primero")).toBeNull());
    expect(apiMock.deleteWorkspace).toHaveBeenCalledWith("w1", {
      removeWorktree: false,
      force: false,
    });
    expect(screen.getByText("view:Segundo")).toBeInTheDocument();
    expect(localStorage.getItem("openconf:selected")).toBe("w2");
    confirm.mockRestore();
  });

  test("worktree sucio: doble confirmación activa force", async () => {
    const user = userEvent.setup();
    localStorage.setItem("openconf:selected", "w2");
    apiMock.worktreeStatus.mockResolvedValue({
      exists: true,
      dirty: true,
      branch: "dev",
      path: "/wt",
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp();
    await screen.findByText("view:Segundo");
    await user.click(screen.getByText("delete"));
    await waitFor(() => expect(screen.queryByText("Segundo")).toBeNull());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(apiMock.deleteWorkspace).toHaveBeenCalledWith("w2", {
      removeWorktree: true,
      force: true,
    });
    confirm.mockRestore();
  });

  test("confirmación rechazada no borra", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderApp();
    await screen.findByText("view:Primero");
    await user.click(screen.getByText("delete"));
    expect(screen.getByText("view:Primero")).toBeInTheDocument();
    expect(apiMock.deleteWorkspace).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe("App — creación y gestión", () => {
  test("crear añade, selecciona y avisa de warnings", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText("Primero");
    await user.click(screen.getByText("Nuevo workspace"));
    await user.click(screen.getByText("create"));
    expect(await screen.findByText("view:Nuevo")).toBeInTheDocument();
    expect(screen.getByText("aviso")).toBeInTheDocument();
    expect(localStorage.getItem("openconf:selected")).toBe("nuevo");
  });

  test("abrir y cerrar el panel de gestión", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText("Primero");
    await user.click(screen.getByText("Repos y templates"));
    expect(screen.getByText("close-manage")).toBeInTheDocument();
    await user.click(screen.getByText("close-manage"));
    expect(screen.queryByText("close-manage")).toBeNull();
  });
});
