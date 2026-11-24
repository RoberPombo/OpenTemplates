import { describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreviewDock } from "../PreviewDock";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import type { PreviewProbe } from "../../../domain/preview/preview";
import {
  makeFakeClient,
  makePreferences,
  makePreviewGateway,
  makeWorkspace,
} from "../../../tests/fakes";

const ready: PreviewProbe = {
  ok: true,
  status: 200,
  title: "Mi app",
  error: null,
  frameBlocked: false,
  verified: true,
};

const refused: PreviewProbe = {
  ok: false,
  status: null,
  title: null,
  error: "No hay nadie escuchando en localhost:5173. Arranca el servidor de desarrollo.",
  frameBlocked: false,
  verified: true,
};

function setup(
  options: {
    probes?: PreviewProbe[];
    probe?: (url: string) => PreviewProbe | Promise<PreviewProbe>;
    sessionId?: string | null;
    initialPrefs?: Record<string, string>;
  } = {},
) {
  const fake = makePreviewGateway({ probes: options.probes, probe: options.probe });
  const { client } = makeFakeClient();
  const { preferences, store } = makePreferences(options.initialPrefs);
  const onClose = vi.fn();
  render(
    <PreviewDock
      gateway={fake.gateway}
      preferences={preferences}
      workspace={makeWorkspace()}
      client={client as unknown as ChatServer}
      sessionId={options.sessionId === undefined ? "s1" : options.sessionId}
      onClose={onClose}
    />,
  );
  return { fake, client, preferences, store, onClose };
}

describe("PreviewDock — carga y estado", () => {
  test("muestra el estado de comprobación y luego la página", async () => {
    let resolveProbe: (probe: PreviewProbe) => void = () => {};
    const pending = new Promise<PreviewProbe>((resolve) => {
      resolveProbe = resolve;
    });
    setup({ probe: () => pending });

    expect(screen.getByText(/Comprobando http:\/\/localhost:5173/)).toBeInTheDocument();
    expect(screen.queryByTitle("Aplicación en marcha")).toBeNull();

    await act(async () => resolveProbe(ready));

    expect(await screen.findByTitle("Aplicación en marcha")).toBeInTheDocument();
    expect(screen.getByText("HTTP 200 · «Mi app»")).toBeInTheDocument();
  });

  test("un error de conexión se explica y no deja un iframe en blanco", async () => {
    setup({ probes: [refused] });

    expect(
      (await screen.findAllByText(/No hay nadie escuchando en localhost:5173/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTitle("Aplicación en marcha")).toBeNull();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  test("Reintentar vuelve a sondear y pinta la página cuando responde", async () => {
    const user = userEvent.setup();
    const { fake } = setup({ probes: [refused, ready] });

    await screen.findAllByText(/No hay nadie escuchando/);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByTitle("Aplicación en marcha")).toBeInTheDocument();
    expect(fake.probe).toHaveBeenCalledTimes(2);
  });

  test("avisa cuando el servidor prohíbe embeber la página", async () => {
    setup({ probes: [{ ...ready, frameBlocked: true }] });

    expect(await screen.findByText(/prohíbe embeber la página/)).toBeInTheDocument();
  });
});

describe("PreviewDock — URL, dispositivo y navegador", () => {
  test("una URL inválida se señala y no se guarda ni se sondea", async () => {
    const user = userEvent.setup();
    const { fake, store } = setup();
    await screen.findByTitle("Aplicación en marcha");

    const input = screen.getByLabelText("URL o puerto de la aplicación");
    await user.clear(input);
    await user.type(input, "ftp://localhost");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(screen.getByText(/Solo se admiten direcciones http/)).toBeInTheDocument();
    expect(store.has("opentemplates:preview-url:w1")).toBe(false);
    expect(fake.probe).toHaveBeenCalledTimes(1);
  });

  test("recuerda la URL aplicada y la sondea al cambiar", async () => {
    const user = userEvent.setup();
    const { fake, store } = setup({
      initialPrefs: { "opentemplates:preview-device:w1": "tablet" },
    });
    await screen.findByTitle("Aplicación en marcha");
    expect(fake.probe).toHaveBeenCalledWith("http://localhost:5173");

    const input = screen.getByLabelText("URL o puerto de la aplicación");
    await user.clear(input);
    await user.type(input, "3000");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(fake.probe).toHaveBeenLastCalledWith("http://localhost:3000"));
    expect(store.get("opentemplates:preview-url:w1")).toBe("http://localhost:3000");
    expect(screen.getByRole("button", { name: "Tablet" })).toHaveAttribute("aria-pressed", "true");
  });

  test("recargar vuelve a sondear y abrir usa el navegador del sistema", async () => {
    const user = userEvent.setup();
    const { fake } = setup();
    await screen.findByTitle("Aplicación en marcha");

    await user.click(screen.getByRole("button", { name: "Recargar" }));
    await waitFor(() => expect(fake.probe).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(fake.openExternal).toHaveBeenCalledWith("http://localhost:5173");
  });
});

describe("PreviewDock — enviar al agente", () => {
  test("compone y manda un prompt numerado con URL, ruta, tamaño y petición", async () => {
    const user = userEvent.setup();
    const { client } = setup({ probes: [ready] });
    await screen.findByTitle("Aplicación en marcha");

    await user.click(screen.getByRole("button", { name: "Móvil" }));
    await user.type(
      screen.getByLabelText("¿Qué quieres que revise el agente?"),
      "el botón de guardar no responde",
    );
    await user.click(screen.getByRole("button", { name: "Enviar al agente" }));

    await waitFor(() => expect(client.session.prompt).toHaveBeenCalledTimes(1));
    const input = client.session.prompt.mock.calls[0][0] as { sessionID: string; text: string };
    expect(input.sessionID).toBe("s1");
    expect(input.text).toContain("1. URL: http://localhost:5173");
    expect(input.text).toContain("3. Ruta local: /tmp/demo");
    expect(input.text).toContain("4. Vista: Móvil (390×844)");
    expect(input.text).toContain("5. Estado: HTTP 200 · «Mi app»");
    expect(input.text).toContain("6. Petición: el botón de guardar no responde");
    expect(await screen.findByText("Prompt enviado a la sesión activa.")).toBeInTheDocument();
  });

  test("sin sesión activa el envío queda deshabilitado y se explica", async () => {
    setup({ sessionId: null });
    await screen.findByTitle("Aplicación en marcha");

    const send = screen.getByRole("button", { name: "Enviar al agente" });
    expect(send).toBeDisabled();
    expect(send.getAttribute("title")).toContain("No hay sesión activa");
    expect(screen.getByText(/No hay sesión activa/)).toBeInTheDocument();
  });
});
