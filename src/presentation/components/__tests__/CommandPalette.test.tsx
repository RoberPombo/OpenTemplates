import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "../CommandPalette";
import { buildPaletteCommands, type PaletteContext } from "../../../domain/palette/catalog";

const ALL_HANDLERS = [
  "workspace.settings",
  "session.new",
  "session.stop",
  "session.export",
  "session.goal",
  "panel.toggle",
  "panel.sessions",
  "panel.diff",
  "panel.terminal",
  "panel.close",
  "race.launch",
] as const;

function context(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    workspace: { id: "w1", name: "Demo" },
    workspaces: [
      { id: "w1", name: "Demo" },
      { id: "w2", name: "Segundo" },
    ],
    recentWorkspaceIds: ["w1"],
    hasServer: true,
    handlers: Object.fromEntries(ALL_HANDLERS.map((id) => [id, { enabled: true }])),
    ...overrides,
  };
}

function setup(overrides: Partial<PaletteContext> = {}) {
  const onRun = vi.fn();
  const onClose = vi.fn();
  render(
    <CommandPalette
      commands={buildPaletteCommands(context(overrides))}
      onRun={onRun}
      onClose={onClose}
    />,
  );
  return { onRun, onClose, input: screen.getByRole("combobox", { name: "Buscar una acción" }) };
}

describe("CommandPalette", () => {
  test("filtra las acciones al escribir", async () => {
    const user = userEvent.setup();
    const { input } = setup();

    await user.type(input, "objetivo");

    expect(screen.getByRole("option", { name: /Definir el objetivo/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Terminal del workspace/ }),
    ).not.toBeInTheDocument();
  });

  test("Enter ejecuta la acción activa y cierra la paleta", async () => {
    const user = userEvent.setup();
    const { input, onRun, onClose } = setup();

    await user.type(input, "objetivo");
    await user.keyboard("{Enter}");

    expect(onRun).toHaveBeenCalledWith("session.goal");
    expect(onClose).toHaveBeenCalled();
  });

  test("las flechas saltan acciones deshabilitadas y mantienen aria-activedescendant", async () => {
    const user = userEvent.setup();
    const { input, onRun } = setup();

    expect(input).toHaveAttribute("aria-activedescendant", "palette-option-workspace-create");
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "palette-option-workspace-next");
    await user.keyboard("{Enter}");

    expect(onRun).toHaveBeenCalledWith("workspace.next");
  });

  test("una acción deshabilitada muestra el motivo y no se ejecuta", async () => {
    const user = userEvent.setup();
    const { input, onRun } = setup({
      workspace: null,
      hasServer: false,
      handlers: {},
    });

    await user.type(input, "terminal");
    const option = screen.getByRole("option", { name: /Terminal del workspace/ });
    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(option).toHaveTextContent(/Selecciona un workspace/);

    await user.keyboard("{Enter}");
    expect(onRun).not.toHaveBeenCalled();
  });

  test("Escape cierra sin ejecutar", async () => {
    const user = userEvent.setup();
    const { input, onRun, onClose } = setup();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
  });

  test("la lista expone roles listbox/option y el foco vuelve al cerrar", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "abrir";
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    const { unmount } = render(
      <CommandPalette
        commands={buildPaletteCommands(context())}
        onRun={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("listbox", { name: "Acciones" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Buscar una acción" })).toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
