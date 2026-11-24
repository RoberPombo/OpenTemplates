import { describe, expect, test, vi } from "vitest";
import type React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceView } from "../WorkspaceView";
import { AppProvider } from "../../context/AppContext";
import type { CompositionRoot } from "../../../CompositionRoot";
import type { ServerInfo } from "../../../types";
import {
  makeFakeClient,
  makePreviewGateway,
  makeTerminalGateway,
  makeWorkspace,
} from "../../../tests/fakes";

const server: ServerInfo = {
  workspaceId: "w1",
  baseUrl: "http://127.0.0.1:4096",
  password: "secreto",
  port: 4096,
  pid: 42,
};

function setup(
  sharedWith: string[] = [],
  extra: Partial<React.ComponentProps<typeof WorkspaceView>> = {},
) {
  const store = new Map<string, string>([
    ["opentemplates:panel", "0"],
    ["opentemplates:session:w1", "s1"],
  ]);
  const preferences = {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => {
      store.set(key, value);
    },
    remove: (key: string) => {
      store.delete(key);
    },
  };
  const terminals = makeTerminalGateway();
  const preview = makePreviewGateway();
  const { client } = makeFakeClient({
    sessionDiff: [
      {
        file: "notas.txt",
        patch: "diff --git a/notas.txt b/notas.txt\n@@ -1 +1 @@\n-dos\n+dos cambiado\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
    ],
  });
  const root = {
    preferences,
    resources: { usage: vi.fn(async () => null) },
    provideChatGateway: () => client,
    provideTerminalGateway: () => terminals.gateway,
    providePreviewGateway: () => preview.gateway,
  } as unknown as CompositionRoot;
  render(
    <AppProvider root={root}>
      <WorkspaceView
        workspace={makeWorkspace()}
        sharedWith={sharedWith}
        server={server}
        starting={false}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onDelete={vi.fn()}
        onUpdated={vi.fn()}
        worktreesRoot="/wt"
        repoPath={null}
        {...extra}
      />
    </AppProvider>,
  );
  return { client, store, terminals, preview };
}

describe("WorkspaceView — panel de cambios", () => {
  test("cambiar de perfil arranca su contexto", async () => {
    const user = userEvent.setup();
    const onStartProfile = vi.fn(async () => ({
      ...server,
      contextHash: "hash-b",
      port: 4097,
      baseUrl: "http://127.0.0.1:4097",
    }));
    const profiles = [
      {
        id: "backend",
        name: "Backend",
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
      },
      {
        id: "frontend",
        name: "Frontend",
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
      },
    ];
    setup([], { profiles, onStartProfile });
    const select = await screen.findByRole("combobox", { name: "Perfil del workspace" });
    await user.selectOptions(select, "frontend");
    await waitFor(() => expect(onStartProfile).toHaveBeenCalledWith("w1", "frontend"));
  });

  test("muestra con qué workspaces comparte servidor", () => {
    setup(["Backend", "Métricas"]);
    expect(screen.getByText(/comparte servidor con Backend, Métricas/)).toBeInTheDocument();
  });

  test("el botón Cambios abre el panel en esa pestaña y la recuerda", async () => {
    const user = userEvent.setup();
    const { client, store } = setup();
    expect(screen.queryByRole("tab", { name: "Cambios" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cambios" }));
    expect(screen.getByRole("tab", { name: "Cambios" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(client.session.diff).toHaveBeenCalledWith({ sessionID: "s1" }));
    expect(await screen.findByText("notas.txt")).toBeInTheDocument();
    expect(store.get("opentemplates:panel")).toBe("1");
    expect(store.get("opentemplates:panel-tab:w1")).toBe("cambios");
  });

  test("las pestañas cambian entre resumen, cambios y ficheros", async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await user.click(screen.getByRole("button", { name: "Panel" }));
    expect(screen.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Ficheros" }));
    expect(screen.getByRole("tab", { name: "Ficheros" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(client.file.list).toHaveBeenCalled());
  });

  test("el botón Vista abre la vista previa y la cierra sin tocar el servidor", async () => {
    const user = userEvent.setup();
    const { preview, store } = setup();
    expect(screen.queryByRole("region", { name: "Vista previa de la aplicación" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Vista" }));
    expect(
      await screen.findByRole("region", { name: "Vista previa de la aplicación" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(preview.probe).toHaveBeenCalledWith("http://localhost:5173"));
    expect(store.get("opentemplates:preview")).toBe("1");

    await user.click(screen.getByRole("button", { name: "Vista" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Vista previa de la aplicación" })).toBeNull(),
    );
    expect(store.get("opentemplates:preview")).toBe("0");
  });

  test("el botón Terminal abre y cierra el dock sin borrar los PTYs", async () => {
    const user = userEvent.setup();
    const { terminals, store } = setup();
    expect(screen.queryByRole("region", { name: "Terminal del workspace" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Terminal" }));
    expect(
      await screen.findByRole("region", { name: "Terminal del workspace" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/No hay terminales/)).toBeInTheDocument();
    expect(store.get("opentemplates:terminal")).toBe("1");

    await user.click(screen.getByRole("button", { name: "Terminal" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Terminal del workspace" })).toBeNull(),
    );
    expect(store.get("opentemplates:terminal")).toBe("0");
    expect(terminals.remove).not.toHaveBeenCalled();
  });
});
