import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShortcutsSettings } from "../ShortcutsSettings";

describe("ShortcutsSettings", () => {
  test("lista el set completo de atajos con su etiqueta", () => {
    render(<ShortcutsSettings />);

    expect(screen.getByText("Abrir la paleta de comandos")).toBeInTheDocument();
    expect(screen.getByText("Nueva sesión en el workspace")).toBeInTheDocument();
    expect(screen.getByText("Cerrar el panel o dock activo")).toBeInTheDocument();
    expect(screen.getByText("Parar el turno en curso")).toBeInTheDocument();
    expect(screen.getByText("Ir al workspace siguiente")).toBeInTheDocument();
    expect(screen.getByText("Ir al workspace anterior")).toBeInTheDocument();
    expect(screen.getByText("Abrir o cerrar el terminal")).toBeInTheDocument();
    expect(screen.getByText("Abrir el panel de diff y cambios")).toBeInTheDocument();
    expect(screen.getAllByText(/Ctrl\+K/).length).toBeGreaterThan(0);
  });
});
