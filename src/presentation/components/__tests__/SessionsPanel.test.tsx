import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionsPanel } from "../SessionsPanel";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import type { SessionSummary } from "../../../domain/chat/sessions";

function makeSessions(): SessionSummary[] {
  return [
    {
      id: "a",
      title: "Refactor de login",
      created: 1,
      updated: 3,
      cost: 0.12,
      tokens: { input: 1, output: 2 },
    },
    {
      id: "b",
      title: "Migración de tests",
      created: 1,
      updated: 2,
      cost: 0,
      tokens: { input: 1, output: 2 },
    },
  ];
}

function renderPanel(props: Partial<Parameters<typeof SessionsPanel>[0]> = {}, confirmed = true) {
  const root = new CompositionRoot({ confirm: { confirm: () => confirmed } });
  const handlers = {
    onSelect: vi.fn(),
    onRename: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
    onNew: vi.fn(),
    onClose: vi.fn(),
    ...props,
  };
  const view = render(
    <AppProvider root={root}>
      <SessionsPanel
        sessions={makeSessions()}
        activeId="a"
        busy={false}
        error={null}
        {...handlers}
      />
    </AppProvider>,
  );
  return { ...handlers, view };
}

describe("SessionsPanel", () => {
  test("lista las sesiones, marca la activa y permite abrir otra", async () => {
    const user = userEvent.setup();
    const { onSelect, view } = renderPanel();

    expect(screen.getByText("Refactor de login")).toBeInTheDocument();
    expect(screen.getByText("Migración de tests")).toBeInTheDocument();
    expect(view.container.querySelector(".session-row.active")).toHaveTextContent(
      "Refactor de login",
    );

    await user.click(screen.getByRole("button", { name: /^Migración de tests/ }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  test("filtra por título y muestra el estado vacío", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText("Buscar sesiones"), "tests");
    expect(screen.queryByText("Refactor de login")).not.toBeInTheDocument();
    expect(screen.getByText("Migración de tests")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Buscar sesiones"));
    await user.type(screen.getByLabelText("Buscar sesiones"), "zzz");
    expect(screen.getByText("Sin resultados.")).toBeInTheDocument();
  });

  test("renombra en línea y guarda al pulsar Enter", async () => {
    const user = userEvent.setup();
    const { onRename } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Renombrar Refactor de login" }));
    const input = screen.getByLabelText("Título de la sesión");
    expect(input).toHaveValue("Refactor de login");

    await user.clear(input);
    await user.type(input, "Login arreglado{Enter}");
    expect(onRename).toHaveBeenCalledWith("a", "Login arreglado");
  });

  test("pide confirmación antes de eliminar", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Eliminar Migración de tests" }));
    expect(onDelete).toHaveBeenCalledWith("b");
  });

  test("no elimina si el usuario cancela", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderPanel({}, false);

    await user.click(screen.getByRole("button", { name: "Eliminar Migración de tests" }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  test("crea una sesión nueva y se cierra desde la cabecera", async () => {
    const user = userEvent.setup();
    const { onNew, onClose } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Nueva" }));
    expect(onNew).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Ocultar sesiones" }));
    expect(onClose).toHaveBeenCalled();
  });
});
