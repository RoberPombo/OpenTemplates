import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateDialog } from "../UpdateDialog";

function renderDialog(overrides: Partial<Parameters<typeof UpdateDialog>[0]> = {}) {
  const props = {
    update: { currentVersion: "0.1.0", version: "0.2.0" },
    installing: false,
    installed: false,
    error: null,
    onInstall: vi.fn(),
    onRestart: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<UpdateDialog {...props} />);
  return props;
}

describe("UpdateDialog", () => {
  test("muestra las versiones actual y nueva", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("0.2.0")).toBeInTheDocument();
  });

  test("instala al confirmar y aplaza al descartar", async () => {
    const props = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Actualizar ahora" }));
    expect(props.onInstall).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Más tarde" }));
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  test("mientras descarga no deja cerrar ni repetir", () => {
    renderDialog({ installing: true });
    expect(screen.getByRole("button", { name: "Actualizando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Más tarde" })).toBeDisabled();
  });

  test("tras instalar ofrece reiniciar", async () => {
    const props = renderDialog({ installed: true });
    expect(screen.getByText(/Reinicia la aplicación/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reiniciar ahora" }));
    expect(props.onRestart).toHaveBeenCalledOnce();
  });

  test("muestra el error de descarga", () => {
    renderDialog({ error: "firma inválida" });
    expect(screen.getByText("firma inválida")).toBeInTheDocument();
  });
});
