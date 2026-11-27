import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceSessions } from "../WorkspaceSessions";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import type { ServerInfo } from "../../../types";
import { makeFakeClient, makeSessionFiles, makeWorkspace } from "../../../tests/fakes";
import { createSessionFile, serializeSessionFile } from "../../../domain/chat/transfer";

const server: ServerInfo = {
  workspaceId: "w1",
  contextHash: "hash-a",
  baseUrl: "http://127.0.0.1:4096",
  password: "secreto",
  port: 4096,
  pid: 42,
};

const sessionList = [
  { id: "s2", title: "Diseño de API", time: { created: 1, updated: 3 }, cost: 0.5 },
  { id: "s1", title: "Chat · Demo", time: { created: 1, updated: 2 }, cost: 0 },
];

function setup(
  props: {
    activeSessionId?: string | null;
    sessions?: unknown[];
    confirm?: boolean;
    sessionFiles?: ReturnType<typeof makeSessionFiles>;
    workspace?: ReturnType<typeof makeWorkspace>;
    importError?: unknown;
  } = {},
) {
  const { client, hub } = makeFakeClient({
    sessions: props.sessions ?? sessionList,
    importError: props.importError,
  });
  const sessionFiles = props.sessionFiles ?? makeSessionFiles();
  const root = new CompositionRoot({
    createChatServer: () => client as unknown as ChatServer,
    sessionFiles,
    confirm: { confirm: () => props.confirm ?? true },
  });
  const onOpenSession = vi.fn();
  render(
    <AppProvider root={root}>
      <WorkspaceSessions
        workspace={props.workspace ?? makeWorkspace()}
        server={server}
        activeSessionId={props.activeSessionId ?? "s1"}
        onOpenSession={onOpenSession}
      />
    </AppProvider>,
  );
  return { client, hub, sessionFiles, onOpenSession };
}

beforeEach(() => {
  localStorage.clear();
});

describe("WorkspaceSessions", () => {
  test("lista las sesiones, marca la activa y abre la elegida", async () => {
    const user = userEvent.setup();
    const { client, onOpenSession } = setup();

    expect(await screen.findByText("Diseño de API")).toBeInTheDocument();
    expect(screen.getByText("Chat · Demo")).toBeInTheDocument();
    expect(client.session.list).toHaveBeenCalledWith({ directory: "/tmp/demo", limit: 100 });
    expect(document.querySelector(".session-row.active")).toHaveTextContent("Chat · Demo");

    await user.click(screen.getByRole("button", { name: /^Diseño de API/ }));
    expect(onOpenSession).toHaveBeenCalledWith("w1", "s2");
  });

  test("crea una sesión nueva con el modelo del workspace y la abre", async () => {
    const user = userEvent.setup();
    const { client, onOpenSession } = setup({
      workspace: makeWorkspace({ model: "anthropic/claude" }),
    });
    await screen.findByText("Diseño de API");

    await user.click(screen.getByRole("button", { name: "Nueva sesión en Demo" }));

    await waitFor(() =>
      expect(client.session.create).toHaveBeenCalledWith({
        location: { directory: "/tmp/demo" },
        title: "Chat · Demo",
        model: { providerID: "anthropic", id: "claude" },
      }),
    );
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith("w1", "s1"));
  });

  test("recarga la lista cuando el servidor avisa de una sesión nueva", async () => {
    const { client, hub } = setup();
    await waitFor(() => expect(client.session.list).toHaveBeenCalled());
    const before = client.session.list.mock.calls.length;

    await act(async () => {
      hub.push({ type: "session.created", data: { sessionID: "s3" } });
    });

    await waitFor(() => expect(client.session.list.mock.calls.length).toBeGreaterThan(before));
  });

  test("renombra al hacer doble clic y guarda con Enter", async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await screen.findByText("Diseño de API");

    await user.dblClick(screen.getByText("Diseño de API"));
    const input = screen.getByLabelText("Título de la sesión");
    expect(input).toHaveValue("Diseño de API");

    await user.clear(input);
    await user.type(input, "API lista{Enter}");

    await waitFor(() =>
      expect(client.session.update).toHaveBeenCalledWith({
        sessionID: "s2",
        title: "API lista",
      }),
    );
  });

  test("elimina con confirmación y crea otra si era la sesión abierta", async () => {
    const user = userEvent.setup();
    const { client, onOpenSession } = setup({ activeSessionId: "s1" });
    await screen.findByText("Chat · Demo");

    await user.click(screen.getByRole("button", { name: "Eliminar Chat · Demo" }));

    await waitFor(() => expect(client.session.remove).toHaveBeenCalledWith({ sessionID: "s1" }));
    await waitFor(() => expect(client.session.create).toHaveBeenCalled());
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith("w1", "s1"));
  });

  test("no elimina si el usuario cancela", async () => {
    const user = userEvent.setup();
    const { client } = setup({ confirm: false });
    await screen.findByText("Chat · Demo");

    await user.click(screen.getByRole("button", { name: "Eliminar Chat · Demo" }));

    expect(client.session.remove).not.toHaveBeenCalled();
  });

  test("duplica, importa y exporta desde la fila", async () => {
    const user = userEvent.setup();
    const transfer = {
      info: { id: "ses_compartida", title: "Sesión compartida" },
      messages: [{ id: "msg_1", type: "user", text: "hola" }],
    };
    const sessionFiles = makeSessionFiles({
      file: {
        path: "/tmp/sesion.json",
        contents: serializeSessionFile(createSessionFile(transfer, { sanitized: true, now: 0 })),
      },
    });
    const { client, onOpenSession } = setup({ sessionFiles });
    await screen.findByText("Chat · Demo");

    await user.click(screen.getByRole("button", { name: "Duplicar Chat · Demo" }));
    await waitFor(() => expect(client.session.fork).toHaveBeenCalledWith({ sessionID: "s1" }));
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith("w1", "fork1"));

    await user.click(screen.getByRole("button", { name: "Importar sesión en Demo" }));
    await waitFor(() =>
      expect(client.session.import).toHaveBeenCalledWith({
        info: expect.objectContaining({
          id: "ses_compartida",
          location: { directory: "/tmp/demo" },
        }),
        messages: transfer.messages,
        location: { directory: "/tmp/demo" },
      }),
    );
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith("w1", "ses_compartida"));

    await user.click(screen.getByRole("button", { name: "Exportar Chat · Demo" }));
    await waitFor(() => expect(sessionFiles.saves).toHaveLength(1));
    await waitFor(() =>
      expect(client.session.export).toHaveBeenCalledWith({ sessionID: "s1", sanitize: true }),
    );
  });

  test("muestra el estado vacío", async () => {
    setup({ sessions: [] });
    expect(await screen.findByText("Aún no hay sesiones.")).toBeInTheDocument();
  });
});
