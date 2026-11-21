import { beforeEach, describe, expect, test } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "../Chat";
import { AppProvider } from "../../context/AppContext";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import { makeFakeClient, makeWorkspace } from "../../../tests/fakes";

// Caracterización del comportamiento interactivo de Chat con un cliente fake.
// Protege el cableado del reducer de streaming (fase 1) y del hook (fase 2).

const rawMessages = [
  { type: "user", id: "u1", text: "hola", time: { created: 1 } },
  {
    type: "assistant",
    id: "a1",
    content: [{ type: "text", text: "respuesta" }],
    time: { created: 2 },
  },
];

function renderChat(
  options: Parameters<typeof makeFakeClient>[0] = {},
  workspace = makeWorkspace(),
) {
  const { client, hub } = makeFakeClient(options);
  const view = render(
    <AppProvider>
      <Chat client={client as unknown as ChatServer} workspace={workspace} />
    </AppProvider>,
  );
  return { client, hub, view };
}

async function ready(client: ReturnType<typeof makeFakeClient>["client"]) {
  await screen.findByPlaceholderText(/Planifica/);
  await waitFor(() => expect(client.session.create).toHaveBeenCalled());
}

beforeEach(() => {
  localStorage.clear();
});

describe("Chat — sesión y carga", () => {
  test("crea sesión al montar, persiste el id y carga los mensajes", async () => {
    const { client } = renderChat({ messages: rawMessages });
    await waitFor(() =>
      expect(client.session.create).toHaveBeenCalledWith({
        location: { directory: "/tmp/demo" },
        title: "Chat · Demo",
      }),
    );
    expect(await screen.findByText("hola")).toBeInTheDocument();
    expect(screen.getByText("respuesta")).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("openconf:session:w1")).toBe("s1"));
  });

  test("reutiliza la sesión guardada en localStorage", async () => {
    localStorage.setItem("openconf:session:w1", "previa");
    const { client } = renderChat({ messages: rawMessages });
    await screen.findByText("hola");
    expect(client.session.create).not.toHaveBeenCalled();
    expect(client.message.list).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "previa" }),
    );
  });
});

describe("Chat — envío", () => {
  test("envía el prompt con modelo y agente seleccionados y pinta el mensaje local", async () => {
    const user = userEvent.setup();
    const { client } = renderChat();
    await ready(client);

    await user.type(screen.getByPlaceholderText(/Planifica/), "construye algo");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() =>
      expect(client.session.prompt).toHaveBeenCalledWith({
        sessionID: "s1",
        text: "construye algo",
      }),
    );
    expect(client.session.switchModel).toHaveBeenCalledWith({
      sessionID: "s1",
      model: { id: "claude", providerID: "anthropic" },
    });
    expect(client.session.switchAgent).toHaveBeenCalledWith({ sessionID: "s1", agent: "build" });
    expect(screen.getByText("construye algo")).toBeInTheDocument();
  });

  test("el modelo guardado gana al del workspace", async () => {
    localStorage.setItem("openconf:model:w1", "openai/gpt");
    renderChat({}, makeWorkspace({ model: "anthropic/claude" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Modelo" })).toHaveValue("GPT"),
    );
  });
});

describe("Chat — streaming", () => {
  test("execution.started muestra Pensando, los deltas se acumulan y idle recarga", async () => {
    const { client, hub } = renderChat();
    await ready(client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({ type: "session.execution.started", data: { sessionID: "s1" } });
    });
    expect(await screen.findByText("Pensando…")).toBeInTheDocument();

    await act(async () => {
      hub.push({
        type: "session.text.started",
        data: { sessionID: "s1", assistantMessageID: "m1" },
      });
      hub.push({
        type: "session.text.delta",
        data: { sessionID: "s1", assistantMessageID: "m1", delta: "Hola " },
      });
      hub.push({
        type: "session.text.delta",
        data: { sessionID: "s1", assistantMessageID: "m1", delta: "mundo" },
      });
    });
    expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
    expect(screen.getByText("escribiendo…")).toBeInTheDocument();

    client.message.list.mockResolvedValue({
      data: [
        {
          type: "assistant",
          id: "a2",
          content: [{ type: "text", text: "Respuesta final" }],
          time: { created: 3 },
        },
      ],
    });
    await act(async () => {
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    });
    expect(await screen.findByText("Respuesta final")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Hola mundo")).toBeNull());
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  test("execution.failed muestra el mensaje de error", async () => {
    const { client, hub } = renderChat();
    await ready(client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({
        type: "session.execution.failed",
        data: { sessionID: "s1", error: { message: "boom" } },
      });
    });
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  test("Parar interrumpe la sesión y limpia el estado busy", async () => {
    const user = userEvent.setup();
    const { client, hub } = renderChat();
    await ready(client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({ type: "session.execution.started", data: { sessionID: "s1" } });
    });
    await user.click(await screen.findByRole("button", { name: "Parar" }));
    await waitFor(() => expect(client.session.interrupt).toHaveBeenCalledWith({ sessionID: "s1" }));
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  test("la rama git se muestra y se actualiza por evento", async () => {
    const { client, hub } = renderChat({ branch: "feature-x" });
    await ready(client);
    expect(await screen.findByText("feature-x")).toBeInTheDocument();

    await act(async () => {
      hub.push({ type: "vcs.branch.updated", data: { branch: "feature-y" } });
    });
    expect(await screen.findByText("feature-y")).toBeInTheDocument();
  });
});

describe("Chat — nueva conversación", () => {
  test("limpia la sesión guardada y crea una nueva", async () => {
    const user = userEvent.setup();
    const { client } = renderChat({ messages: rawMessages });
    await ready(client);
    await screen.findByText("hola");

    client.message.list.mockResolvedValue({ data: [] });
    await user.click(screen.getByRole("button", { name: "Nueva conversación" }));
    await waitFor(() => expect(client.session.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(localStorage.getItem("openconf:session:w1")).toBe("s2"));
    await waitFor(() => expect(screen.queryByText("hola")).toBeNull());
    expect(client.message.list).toHaveBeenCalledWith(expect.objectContaining({ sessionID: "s2" }));
  });
});
