import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "../Chat";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import {
  makeFakeClient,
  makeNotificationGateway,
  makeSessionFiles,
  makeWorkspace,
} from "../../../tests/fakes";
import { createSessionFile, serializeSessionFile } from "../../../domain/chat/transfer";
import type { GoalDecisionResult } from "../../../domain/chat/goals";

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
  props: {
    sessionsOpen?: boolean;
    onCloseSessions?: () => void;
    onWorkspaceActivity?: (workspaceId: string) => void;
    notifications?: ReturnType<typeof makeNotificationGateway>;
    sessionFiles?: ReturnType<typeof makeSessionFiles>;
    confirm?: boolean;
  } = {},
) {
  const { client, hub } = makeFakeClient(options);
  const notifications = props.notifications ?? makeNotificationGateway();
  const root = new CompositionRoot({
    notifications,
    sessionFiles: props.sessionFiles ?? makeSessionFiles(),
    confirm: { confirm: () => props.confirm ?? true },
  });
  const view = render(
    <AppProvider root={root}>
      <Chat
        client={client as unknown as ChatServer}
        workspace={workspace}
        sessionsOpen={props.sessionsOpen}
        onCloseSessions={props.onCloseSessions}
        onWorkspaceActivity={props.onWorkspaceActivity}
      />
    </AppProvider>,
  );
  return { client, hub, view, notifications };
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
    await waitFor(() => expect(localStorage.getItem("opentemplates:session:w1")).toBe("s1"));
  });

  test("reutiliza la sesión guardada en localStorage", async () => {
    localStorage.setItem("opentemplates:session:w1", "previa");
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
    localStorage.setItem("opentemplates:model:w1", "openai/gpt");
    renderChat({}, makeWorkspace({ model: "anthropic/claude" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Modelo" })).toHaveValue("GPT"),
    );
  });
});

describe("Chat — comandos y skills", () => {
  const commands = [
    { name: "review", description: "Revisa cambios" },
    { name: "init", description: "Prepara AGENTS.md" },
  ];

  test("abre el menú con «/», filtra, navega con flechas y elige con Enter", async () => {
    const user = userEvent.setup();
    const { client } = renderChat({ commands });
    await ready(client);
    await waitFor(() => expect(client.command.list).toHaveBeenCalled());
    const textarea = screen.getByPlaceholderText(/Planifica/);

    await user.type(textarea, "/");
    expect(await screen.findByRole("listbox", { name: "Comandos y skills" })).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "/initcomandoPrepara AGENTS.md",
      "/reviewcomandoRevisa cambios",
    ]);
    expect(textarea).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("status")).toHaveTextContent("2 resultados");

    await user.type(textarea, "review");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(screen.getByRole("status")).toHaveTextContent("1 resultado para «review»");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByLabelText("Quitar comando /review")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.type(textarea, "rama main");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(client.session.command).toHaveBeenCalledWith({
        sessionID: "s1",
        name: "review",
        text: "rama main",
      }),
    );
    expect(client.session.prompt).not.toHaveBeenCalled();
  });

  test("un comando escrito a mano se envía con session.command", async () => {
    const user = userEvent.setup();
    const { client } = renderChat({ commands });
    await ready(client);
    await waitFor(() => expect(client.command.list).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText(/Planifica/), "/review rama main");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(client.session.command).toHaveBeenCalledWith({
        sessionID: "s1",
        name: "review",
        text: "rama main",
      }),
    );
    expect(client.session.prompt).not.toHaveBeenCalled();
  });

  test("Escape cierra el menú sin enviar", async () => {
    const user = userEvent.setup();
    const { client } = renderChat({ commands });
    await ready(client);
    await waitFor(() => expect(client.command.list).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText(/Planifica/), "/");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(client.session.prompt).not.toHaveBeenCalled();
    expect(client.session.command).not.toHaveBeenCalled();
  });

  test("ofrece las skills permitidas y las envía como adjuntas al comando", async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      skills: [
        { id: "testing", path: "/skills/testing" },
        { id: "prohibida", path: "/skills/prohibida" },
      ],
      disabledSkills: ["prohibida"],
    });
    const { client } = renderChat(
      {
        commands,
        skillsCatalog: [
          { id: "testing", name: "Testing", description: "Diseña pruebas" },
          { id: "prohibida", name: "Prohibida", description: "No disponible" },
        ],
      },
      workspace,
    );
    await ready(client);
    await waitFor(() => expect(client.skill.list).toHaveBeenCalled());

    const textarea = screen.getByPlaceholderText(/Planifica/);
    await user.type(textarea, "/");
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toHaveTextContent("Skills");
    expect(screen.getByRole("option", { name: /Testing/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Prohibida/ })).toBeNull();

    await user.click(screen.getByRole("option", { name: /review/i }));
    await user.type(textarea, "/test");
    await user.click(await screen.findByRole("option", { name: /Testing/ }));
    expect(await screen.findByLabelText("Quitar skill Testing")).toBeInTheDocument();

    await user.type(textarea, "revisa esto");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(client.session.command).toHaveBeenCalledWith({
        sessionID: "s1",
        name: "review",
        text: "revisa esto",
        skills: [{ id: "testing" }],
      }),
    );
  });

  test("una skill sin comando se envía con session.prompt y skills", async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({ skills: [{ id: "testing", path: "/skills/testing" }] });
    const { client } = renderChat(
      { skillsCatalog: [{ id: "testing", name: "Testing", description: "Diseña pruebas" }] },
      workspace,
    );
    await ready(client);
    await waitFor(() => expect(client.skill.list).toHaveBeenCalled());

    const textarea = screen.getByPlaceholderText(/Planifica/);
    await user.type(textarea, "/testing");
    await user.click(await screen.findByRole("option", { name: /Testing/ }));
    await user.type(textarea, "prueba esto");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() =>
      expect(client.session.prompt).toHaveBeenCalledWith({
        sessionID: "s1",
        text: "prueba esto",
        skills: [{ id: "testing" }],
      }),
    );
    expect(client.session.command).not.toHaveBeenCalled();
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

describe("Chat — historial de sesiones", () => {
  const sessions = [
    { id: "s2", title: "Diseño de API", time: { created: 1, updated: 3 }, cost: 0.5 },
    { id: "s1", title: "Chat · Demo", time: { created: 1, updated: 2 }, cost: 0 },
  ];

  test("lista las sesiones del workspace y abre la elegida", async () => {
    const user = userEvent.setup();
    localStorage.setItem("opentemplates:session:w1", "s1");
    const { client } = renderChat({ sessions }, makeWorkspace(), { sessionsOpen: true });

    expect(await screen.findByText("Diseño de API")).toBeInTheDocument();
    expect(client.session.list).toHaveBeenCalledWith({
      directory: "/tmp/demo",
      limit: 100,
    });

    client.message.list.mockResolvedValue({ data: [] });
    await user.click(screen.getByRole("button", { name: /^Diseño de API/ }));

    await waitFor(() =>
      expect(client.message.list).toHaveBeenCalledWith(
        expect.objectContaining({ sessionID: "s2" }),
      ),
    );
    expect(localStorage.getItem("opentemplates:session:w1")).toBe("s2");
  });

  test("recarga la lista cuando el servidor avisa de una sesión nueva", async () => {
    const { client, hub } = renderChat({ sessions }, makeWorkspace(), { sessionsOpen: true });
    await waitFor(() => expect(client.session.list).toHaveBeenCalled());

    const before = client.session.list.mock.calls.length;
    await act(async () => {
      hub.push({ type: "session.created", data: { sessionID: "s3" } });
    });
    await waitFor(() => expect(client.session.list.mock.calls.length).toBeGreaterThan(before));
  });

  test("cerrar el panel lo notifica al contenedor", async () => {
    const user = userEvent.setup();
    const onCloseSessions = vi.fn();
    renderChat({ sessions }, makeWorkspace(), { sessionsOpen: true, onCloseSessions });

    await user.click(screen.getByRole("button", { name: "Ocultar sesiones" }));
    expect(onCloseSessions).toHaveBeenCalled();
  });
});

describe("Chat — transferencia de sesiones", () => {
  const sessions = [{ id: "s1", title: "Chat · Demo", time: { created: 1, updated: 2 }, cost: 0 }];
  const transfer = {
    info: {
      id: "ses_compartida",
      title: "Sesión compartida",
      location: { directory: "/home/ana/otro" },
    },
    messages: [{ id: "msg_1", type: "user", text: "hola" }],
  };
  const importFile = {
    path: "/tmp/sesion.json",
    contents: serializeSessionFile(createSessionFile(transfer, { sanitized: true, now: 0 })),
  };

  test("exporta la sesión saneada y avisa con la ruta", async () => {
    const user = userEvent.setup();
    localStorage.setItem("opentemplates:session:w1", "s1");
    const sessionFiles = makeSessionFiles();
    const { client } = renderChat({ sessions }, makeWorkspace(), {
      sessionsOpen: true,
      sessionFiles,
    });
    await screen.findByText("Chat · Demo");

    await user.click(screen.getByRole("button", { name: "Exportar Chat · Demo" }));

    await waitFor(() =>
      expect(client.session.export).toHaveBeenCalledWith({ sessionID: "s1", sanitize: true }),
    );
    expect(await screen.findByText("Sesión exportada en /tmp/sesion.json")).toBeInTheDocument();
    const file = JSON.parse(sessionFiles.saved[0] ?? "{}");
    expect(file.format).toBe("opentemplates.session");
    expect(file.version).toBe(1);
    expect(file.sanitized).toBe(true);
    expect(file.session.info.id).toBe("s1");
    expect(sessionFiles.saves[0]?.suggestedName).toMatch(/^sesion-chat-demo-\d{8}\.json$/);
  });

  test("pide confirmación antes de sobrescribir y reintenta con overwrite", async () => {
    const user = userEvent.setup();
    localStorage.setItem("opentemplates:session:w1", "s1");
    const sessionFiles = makeSessionFiles({ saved: "exists" });
    renderChat({ sessions }, makeWorkspace(), {
      sessionsOpen: true,
      sessionFiles,
      confirm: true,
    });
    await screen.findByText("Chat · Demo");

    await user.click(screen.getByRole("button", { name: "Exportar Chat · Demo" }));

    await waitFor(() => expect(sessionFiles.saves).toHaveLength(2));
    expect(sessionFiles.saves[1]?.overwrite).toBe(true);
    expect(sessionFiles.saved).toHaveLength(1);
  });

  test("no escribe si el usuario rechaza sobrescribir", async () => {
    const user = userEvent.setup();
    localStorage.setItem("opentemplates:session:w1", "s1");
    const sessionFiles = makeSessionFiles({ saved: "exists" });
    renderChat({ sessions }, makeWorkspace(), {
      sessionsOpen: true,
      sessionFiles,
      confirm: false,
    });
    await screen.findByText("Chat · Demo");

    await user.click(screen.getByRole("button", { name: "Exportar Chat · Demo" }));

    await waitFor(() => expect(sessionFiles.saves).toHaveLength(1));
    expect(sessionFiles.saved).toHaveLength(0);
  });

  test("importa el archivo en el workspace y selecciona la sesión nueva", async () => {
    const user = userEvent.setup();
    localStorage.setItem("opentemplates:session:w1", "s1");
    const sessionFiles = makeSessionFiles({ file: importFile });
    const { client } = renderChat({ sessions }, makeWorkspace(), {
      sessionsOpen: true,
      sessionFiles,
    });
    await screen.findByText("Chat · Demo");
    const lists = client.session.list.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Importar sesión" }));

    await waitFor(() =>
      expect(client.session.import).toHaveBeenCalledWith({
        info: expect.objectContaining({
          id: "ses_compartida",
          title: "Sesión compartida",
          location: { directory: "/tmp/demo" },
        }),
        messages: transfer.messages,
        location: { directory: "/tmp/demo" },
      }),
    );
    await waitFor(() =>
      expect(localStorage.getItem("opentemplates:session:w1")).toBe("ses_compartida"),
    );
    expect(await screen.findByText("Sesión importada desde /tmp/sesion.json")).toBeInTheDocument();
    expect(client.session.list.mock.calls.length).toBeGreaterThan(lists);
    expect(screen.getByText("Sesión compartida")).toBeInTheDocument();
  });

  test("un archivo ilegible se explica en el panel y no se importa", async () => {
    const user = userEvent.setup();
    localStorage.setItem("opentemplates:session:w1", "s1");
    const sessionFiles = makeSessionFiles({
      file: { path: "/tmp/roto.json", contents: "no es json" },
    });
    const { client } = renderChat({ sessions }, makeWorkspace(), {
      sessionsOpen: true,
      sessionFiles,
    });
    await screen.findByText("Chat · Demo");

    await user.click(screen.getByRole("button", { name: "Importar sesión" }));

    expect(await screen.findByText("El archivo no es JSON válido.")).toBeInTheDocument();
    expect(client.session.import).not.toHaveBeenCalled();
  });

  test("una colisión de id se explica sin ocultarla", async () => {
    const user = userEvent.setup();
    localStorage.setItem("opentemplates:session:w1", "s1");
    const sessionFiles = makeSessionFiles({ file: importFile });
    renderChat(
      { sessions, importError: new Error("Session already exists: ses_compartida") },
      makeWorkspace(),
      { sessionsOpen: true, sessionFiles },
    );
    await screen.findByText("Chat · Demo");

    await user.click(screen.getByRole("button", { name: "Importar sesión" }));

    expect(
      await screen.findByText(/Ya existe una sesión con el identificador ses_compartida/),
    ).toBeInTheDocument();
    expect(localStorage.getItem("opentemplates:session:w1")).toBe("s1");
  });

  test("duplica la sesión, la selecciona y refresca la lista", async () => {
    const user = userEvent.setup();
    localStorage.setItem("opentemplates:session:w1", "s1");
    const { client } = renderChat({ sessions }, makeWorkspace(), { sessionsOpen: true });
    await screen.findByText("Chat · Demo");
    const lists = client.session.list.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Duplicar Chat · Demo" }));

    await waitFor(() => expect(client.session.fork).toHaveBeenCalledWith({ sessionID: "s1" }));
    await waitFor(() => expect(localStorage.getItem("opentemplates:session:w1")).toBe("fork1"));
    expect(await screen.findByText("Sesión duplicada.")).toBeInTheDocument();
    expect(client.session.list.mock.calls.length).toBeGreaterThan(lists);
  });

  test("continuar desde un mensaje bifurca con `before`", async () => {
    const user = userEvent.setup();
    localStorage.setItem("opentemplates:session:w1", "previa");
    const { client } = renderChat({ messages: rawMessages });
    await screen.findByText("hola");

    await user.click(
      screen.getAllByRole("button", { name: "Continuar desde aquí" })[0] as HTMLElement,
    );

    await waitFor(() =>
      expect(client.session.fork).toHaveBeenCalledWith({
        sessionID: "previa",
        before: "u1",
      }),
    );
  });

  test("no deja continuar desde un mensaje con el turno en curso", async () => {
    localStorage.setItem("opentemplates:session:w1", "previa");
    const { hub } = renderChat({ messages: rawMessages });
    await screen.findByText("hola");
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({ type: "session.execution.started", data: { sessionID: "previa" } });
    });
    await screen.findByText("Pensando…");

    for (const button of screen.getAllByRole("button", { name: "Continuar desde aquí" })) {
      expect(button).toBeDisabled();
    }
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
    await waitFor(() => expect(localStorage.getItem("opentemplates:session:w1")).toBe("s2"));
    await waitFor(() => expect(screen.queryByText("hola")).toBeNull());
    expect(client.message.list).toHaveBeenCalledWith(expect.objectContaining({ sessionID: "s2" }));
  });
});

describe("Chat — permisos y preguntas del agente", () => {
  const pendingPermission = {
    id: "per_1",
    sessionID: "s1",
    action: "bash",
    resources: ["rm -rf dist"],
    message: "Necesito limpiar el build",
  };

  const pendingForm = {
    id: "frm_1",
    sessionID: "s1",
    title: "¿Qué entorno preparo?",
    fields: [{ key: "entorno", type: "string" as const, title: "Entorno", required: true }],
  };

  test("carga los pendientes al montar y responde un permiso", async () => {
    const user = userEvent.setup();
    const { client } = renderChat({ permissions: [pendingPermission] });
    await ready(client);

    expect(client.permission.list).toHaveBeenCalledWith({ sessionID: "s1" });
    expect(client.form.list).toHaveBeenCalledWith({ sessionID: "s1" });
    expect(await screen.findByText("Ejecutar un comando")).toBeInTheDocument();
    expect(screen.getByText("rm -rf dist")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Permitir una vez" }));
    await waitFor(() =>
      expect(client.permission.reply).toHaveBeenCalledWith({
        sessionID: "s1",
        requestID: "per_1",
        decision: "once",
      }),
    );
    await waitFor(() => expect(screen.queryByText("Ejecutar un comando")).toBeNull());
  });

  test("un evento permission.asked abre el dock y replied lo cierra", async () => {
    const { client, hub } = renderChat();
    await ready(client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({
        type: "permission.asked",
        data: {
          id: "per_2",
          sessionID: "s1",
          action: "read",
          resources: ["config.env"],
        },
      });
    });
    expect(await screen.findByText("Leer un archivo")).toBeInTheDocument();

    await act(async () => {
      hub.push({
        type: "permission.replied",
        data: { sessionID: "s1", requestID: "per_2", reply: "reject" },
      });
    });
    await waitFor(() => expect(screen.queryByText("Leer un archivo")).toBeNull());
  });

  test("un formulario pendiente se responde y desaparece del dock", async () => {
    const user = userEvent.setup();
    const { client } = renderChat({ forms: [pendingForm] });
    await ready(client);

    expect(await screen.findByText("¿Qué entorno preparo?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();

    await user.type(screen.getByLabelText(/Entorno/), "dev");
    await user.click(screen.getByRole("button", { name: "Responder" }));

    await waitFor(() =>
      expect(client.form.reply).toHaveBeenCalledWith({
        sessionID: "s1",
        formID: "frm_1",
        answer: { entorno: "dev" },
      }),
    );
    await waitFor(() => expect(screen.queryByText("¿Qué entorno preparo?")).toBeNull());
  });

  test("un evento form.created abre la pregunta y form.cancelled la cierra", async () => {
    const { client, hub } = renderChat();
    await ready(client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({
        type: "form.created",
        data: {
          form: {
            id: "frm_2",
            sessionID: "s1",
            title: "Elige un nombre",
            fields: [{ key: "nombre", type: "string", title: "Nombre", required: true }],
          },
        },
      });
    });
    expect(await screen.findByText("Elige un nombre")).toBeInTheDocument();

    await act(async () => {
      hub.push({ type: "form.cancelled", data: { id: "frm_2", sessionID: "s1" } });
    });
    await waitFor(() => expect(screen.queryByText("Elige un nombre")).toBeNull());
  });
});

describe("Chat — notificaciones nativas", () => {
  const sessions = [
    { id: "s1", title: "Diseño de API", time: { created: 1, updated: 2 }, cost: 0 },
  ];

  function focusOn(focused: boolean) {
    return vi.spyOn(document, "hasFocus").mockReturnValue(focused);
  }

  beforeEach(() => {
    localStorage.setItem("opentemplates:notifications", "1");
    focusOn(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("avisa del turno terminado con workspace y sesión si no hay foco", async () => {
    const onWorkspaceActivity = vi.fn();
    const { client, hub, notifications } = renderChat({ sessions }, makeWorkspace(), {
      onWorkspaceActivity,
    });
    await ready(client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    });

    await waitFor(() =>
      expect(notifications.notify).toHaveBeenCalledWith({
        title: "Demo · Diseño de API",
        body: "Turno terminado",
        workspaceId: "w1",
      }),
    );
    expect(onWorkspaceActivity).toHaveBeenCalledWith("w1");
  });

  test("con la ventana enfocada no avisa ni marca el workspace", async () => {
    focusOn(true);
    const onWorkspaceActivity = vi.fn();
    const { client, hub, notifications } = renderChat({ sessions }, makeWorkspace(), {
      onWorkspaceActivity,
    });
    await ready(client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    });

    expect(notifications.notify).not.toHaveBeenCalled();
    expect(onWorkspaceActivity).not.toHaveBeenCalled();
  });

  test("con la preferencia desactivada no avisa", async () => {
    localStorage.setItem("opentemplates:notifications", "0");
    const { client, hub, notifications } = renderChat({ sessions });
    await ready(client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    });

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  test("un permiso pendiente avisa una sola vez aunque se reenvíe", async () => {
    const { client, hub, notifications } = renderChat({ sessions });
    await ready(client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    const asked = {
      type: "permission.asked",
      data: { id: "per_9", sessionID: "s1", action: "bash", resources: ["pnpm test"] },
    };
    await act(async () => {
      hub.push(asked);
      hub.push(asked);
    });

    await waitFor(() => expect(notifications.notify).toHaveBeenCalledTimes(1));
    expect(notifications.notify).toHaveBeenCalledWith({
      title: "Demo · Diseño de API",
      body: "Esperando tu aprobación",
      workspaceId: "w1",
    });
  });

  test("throttling: dos turnos seguidos generan un solo aviso", async () => {
    const { client, hub, notifications } = renderChat({ sessions });
    await ready(client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    });

    await waitFor(() => expect(notifications.notify).toHaveBeenCalledTimes(1));
  });
});

describe("Chat — objetivo de sesión", () => {
  async function createGoalViaDialog(
    user: ReturnType<typeof userEvent.setup>,
    client: ReturnType<typeof makeFakeClient>["client"],
  ) {
    await ready(client);
    await user.click(screen.getByRole("button", { name: "Definir un objetivo para la sesión" }));
    await user.type(screen.getByLabelText("Criterio de fin"), "deja los tests en verde");
    await user.click(screen.getByRole("button", { name: "Crear objetivo" }));
    await screen.findByText("deja los tests en verde");
  }

  test("al cerrar el turno evalúa con el modelo de decisión y continúa con el texto correcto", async () => {
    const user = userEvent.setup();
    const { client, hub } = renderChat({
      decisionResults: [
        {
          verdict: "continue",
          confidence: 0.9,
          cost: 0.001,
          tokens: { input: 10, output: 4 },
          error: null,
        },
      ],
    });
    await createGoalViaDialog(user, client);
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    await act(async () => {
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    });

    await waitFor(() => expect(client.generate.decisions).toHaveBeenCalled());
    const request = vi.mocked(client.generate.decisions).mock.calls[0]?.[0];
    expect(request?.model).toEqual({ providerID: "opencode", id: "jev-1.13-free" });
    expect(request?.input[0]?.text).toContain("deja los tests en verde");
    expect(request?.questions[0]?.choices.map((choice) => choice.value)).toEqual([
      "continue",
      "done",
      "blocked",
    ]);

    await waitFor(() => expect(client.session.prompt).toHaveBeenCalled());
    const prompt = vi.mocked(client.session.prompt).mock.calls.at(-1)?.[0];
    expect(prompt).toMatchObject({ sessionID: "s1" });
    expect(prompt?.text).toContain("Continúa con el objetivo: «deja los tests en verde»");
    expect(prompt?.text).toContain("1 de 5 turnos");
  });

  test("no evalúa si hay un permiso pendiente", async () => {
    const user = userEvent.setup();
    const { client, hub } = renderChat({
      permissions: [{ id: "per_1", sessionID: "s1", action: "bash", resources: ["pnpm test"] }],
    });
    await createGoalViaDialog(user, client);
    await act(async () => {
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    });
    await waitFor(() => expect(client.permission.list).toHaveBeenCalled());
    expect(client.generate.decisions).not.toHaveBeenCalled();
    expect(client.session.prompt).not.toHaveBeenCalled();
  });

  test("cumplido: para el bucle y avisa", async () => {
    localStorage.setItem("opentemplates:notifications", "1");
    const decisions: GoalDecisionResult[] = [
      {
        verdict: "done",
        confidence: 0.97,
        cost: 0.001,
        tokens: { input: 8, output: 2 },
        error: null,
      },
    ];
    const user = userEvent.setup();
    const { client, hub, notifications } = renderChat({ decisionResults: decisions });
    await createGoalViaDialog(user, client);
    await act(async () => {
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    });
    await waitFor(() => expect(client.generate.decisions).toHaveBeenCalled());
    expect(screen.getByText("cumplido")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        notifications.notify.mock.calls.some(([input]) =>
          input.title.includes("Objetivo cumplido"),
        ),
      ).toBe(true),
    );
    expect(client.session.prompt).not.toHaveBeenCalled();
  });

  test("parar el turno a mano pausa el objetivo y lo persiste", async () => {
    const user = userEvent.setup();
    const { client, hub } = renderChat({ sessions: [{ id: "s1", title: "Sesión", cost: 0 }] });
    await createGoalViaDialog(user, client);
    await act(async () => {
      hub.push({ type: "session.execution.started", data: { sessionID: "s1" } });
    });
    await user.click(screen.getByRole("button", { name: "Parar" }));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("opentemplates:goal:w1:s1") ?? "{}");
      expect(stored.status).toBe("paused");
    });
    expect(screen.getByText("pausado")).toBeInTheDocument();
  });
});
