// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TerminalDock } from "../TerminalDock";
import { makeTerminalGateway, makeTerminalInfo } from "../../../tests/fakes";

vi.mock("@xterm/xterm", () => {
  class Terminal {
    cols = 80;
    rows = 24;
    write = vi.fn();
    open = vi.fn();
    loadAddon = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  }
  return { Terminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

function setup(initial = [] as ReturnType<typeof makeTerminalInfo>[]) {
  const fake = makeTerminalGateway(initial);
  const onClose = vi.fn();
  render(<TerminalDock gateway={fake.gateway} directory="/tmp/demo" onClose={onClose} />);
  return { fake, onClose };
}

describe("TerminalDock — estados", () => {
  test("sin terminales muestra el vacío y crea una con el cwd del proyecto", async () => {
    const user = userEvent.setup();
    const { fake } = setup();

    expect(await screen.findByText(/No hay terminales/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nueva terminal" }));

    expect(await screen.findByRole("tab", { name: "Terminal 1" })).toBeInTheDocument();
    expect(fake.create).toHaveBeenCalledWith(
      { directory: "/tmp/demo" },
      { cwd: "/tmp/demo", title: "Terminal 1" },
    );
    await waitFor(() =>
      expect(fake.connect).toHaveBeenCalledWith(
        expect.objectContaining({ ptyID: "pty_1", cursor: null }),
      ),
    );
  });

  test("lista los PTY existentes y reconecta el activo", async () => {
    const { fake } = setup([makeTerminalInfo({ id: "pty_7", title: "Servidor" })]);

    expect(await screen.findByRole("tab", { name: "Servidor" })).toBeInTheDocument();
    await waitFor(() =>
      expect(fake.connect).toHaveBeenCalledWith(expect.objectContaining({ ptyID: "pty_7" })),
    );
  });

  test("una conexión caída ofrece reintentar con el cursor pendiente", async () => {
    const user = userEvent.setup();
    const { fake } = setup([makeTerminalInfo({ id: "pty_7" })]);
    await waitFor(() => expect(fake.connect).toHaveBeenCalledTimes(1));

    fake.emit("pty_7", "prompt$ ", 8);
    fake.acknowledge("pty_7", 0);
    fake.emit("pty_7", "abc", 3);
    fake.drop("pty_7");

    expect(await screen.findByText(/Conexión perdida/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(fake.connect).toHaveBeenCalledTimes(2));
    expect(fake.cursors.at(-1)).toBe(11);
  });

  test("al seleccionar una pestaña caída se reconecta", async () => {
    const user = userEvent.setup();
    const { fake } = setup([makeTerminalInfo({ id: "pty_7" })]);
    await waitFor(() => expect(fake.connect).toHaveBeenCalledTimes(1));
    fake.drop("pty_7");
    expect(await screen.findByText(/Conexión perdida/)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Terminal 1" }));
    await waitFor(() => expect(fake.connect).toHaveBeenCalledTimes(2));
  });

  test("una terminal terminada avisa y no ofrece reconectar", async () => {
    const { fake } = setup([makeTerminalInfo({ id: "pty_7" })]);
    await waitFor(() => expect(fake.connect).toHaveBeenCalledTimes(1));

    fake.drop("pty_7", { code: 4404, reason: "session exited" });

    expect(await screen.findByText(/La terminal terminó/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar pestaña" })).toBeInTheDocument();
  });

  test("cerrar una pestaña borra su PTY; cerrar el dock no", async () => {
    const user = userEvent.setup();
    const { fake, onClose } = setup([makeTerminalInfo({ id: "pty_7" })]);
    await screen.findByRole("tab", { name: "Terminal 1" });

    await user.click(screen.getByRole("button", { name: "Cerrar Terminal 1" }));
    await waitFor(() =>
      expect(fake.remove).toHaveBeenCalledWith({ directory: "/tmp/demo" }, "pty_7"),
    );

    await user.click(screen.getByRole("button", { name: "Cerrar terminal" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fake.remove).toHaveBeenCalledTimes(1);
  });
});
