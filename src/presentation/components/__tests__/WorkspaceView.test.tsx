import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceView } from "../WorkspaceView";
import { AppProvider } from "../../context/AppContext";
import type { CompositionRoot } from "../../../CompositionRoot";
import type { ServerInfo } from "../../../types";
import { makeFakeClient, makeTerminalGateway, makeWorkspace } from "../../../tests/fakes";

const server: ServerInfo = {
  workspaceId: "w1",
  baseUrl: "http://127.0.0.1:4096",
  password: "secreto",
  port: 4096,
  pid: 42,
};

function setup() {
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
  } as unknown as CompositionRoot;
  render(
    <AppProvider root={root}>
      <WorkspaceView
        workspace={makeWorkspace()}
        server={server}
        starting={false}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onDelete={vi.fn()}
        onUpdated={vi.fn()}
      />
    </AppProvider>,
  );
  return { client, store, terminals };
}

describe("WorkspaceView — panel de cambios", () => {
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
