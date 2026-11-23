import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangesPanel } from "../ChangesPanel";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import { makeFakeClient, makeWorkspace } from "../../../tests/fakes";

const sessionDiff = [
  {
    file: "notas.txt",
    patch: "diff --git a/notas.txt b/notas.txt\n@@ -1 +1 @@\n-dos\n+dos cambiado\n",
    additions: 1,
    deletions: 1,
    status: "modified",
  },
  {
    file: "src/nuevo.ts",
    patch: "diff --git a/src/nuevo.ts b/src/nuevo.ts\n@@ -0,0 +1 @@\n+export {};\n",
    additions: 1,
    deletions: 0,
    status: "added",
  },
];

const workingStatus = [
  { file: "notas.txt", additions: 1, deletions: 1, status: "modified" },
  { file: "viejo.txt", additions: 0, deletions: 3, status: "deleted" },
];

const workingDiff = [
  {
    file: "notas.txt",
    patch: "diff --git a/notas.txt b/notas.txt\n@@ -1 +1 @@\n-dos\n+dos cambiado\n",
    additions: 1,
    deletions: 1,
    status: "modified",
  },
  {
    file: "viejo.txt",
    patch: "diff --git a/viejo.txt b/viejo.txt\n@@ -1,3 +0,0 @@\n-uno\n-dos\n-tres\n",
    additions: 0,
    deletions: 3,
    status: "deleted",
  },
];

function setup(
  options: Partial<Parameters<typeof makeFakeClient>[0]> = {},
  sessionId: string | null = "s1",
) {
  const { client, hub } = makeFakeClient({
    sessionDiff,
    vcsStatus: workingStatus,
    vcsDiff: workingDiff,
    ...options,
  });
  render(
    <ChangesPanel
      client={client as unknown as ChatServer}
      workspace={makeWorkspace()}
      sessionId={sessionId}
    />,
  );
  return { client, hub };
}

describe("ChangesPanel — cambios de la sesión", () => {
  test("lista los ficheros con estado y contadores y abre el diff", async () => {
    const user = userEvent.setup();
    const { client } = setup();
    expect(await screen.findByText("notas.txt")).toBeInTheDocument();
    expect(screen.getByText("nuevo.ts")).toBeInTheDocument();
    expect(screen.getByLabelText("Resumen de cambios")).toHaveTextContent("2 archivos");
    expect(screen.getByLabelText("Resumen de cambios")).toHaveTextContent("+2");
    expect(screen.getByLabelText("Resumen de cambios")).toHaveTextContent("−1");
    expect(screen.getByLabelText("modificado")).toHaveTextContent("M");
    expect(screen.getByLabelText("añadido")).toHaveTextContent("A");
    expect(client.session.diff).toHaveBeenCalledWith({ sessionID: "s1" });

    await user.click(screen.getByRole("button", { name: /notas\.txt/ }));
    expect(screen.getByText("dos cambiado")).toBeInTheDocument();
    expect(screen.queryByText("- dos")).not.toBeInTheDocument();
    const diff = screen.getByLabelText("Diff de notas.txt");
    expect(diff.querySelectorAll(".diff-line.add")).toHaveLength(1);
    expect(diff.querySelectorAll(".diff-line.delete")).toHaveLength(1);
    expect(diff.querySelectorAll(".diff-line.hunk")).toHaveLength(1);
  });

  test("sin sesión activa lo dice y no llama al servidor", async () => {
    const user = userEvent.setup();
    const { client } = setup({}, null);
    await user.click(screen.getByRole("button", { name: "Sesión" }));
    expect(
      await screen.findByText("Sin sesión activa; mira el árbol de trabajo."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Resumen de cambios")).toHaveTextContent("0 archivos");
    expect(client.session.diff).not.toHaveBeenCalled();
  });

  test("un turno terminado refresca con un solo disparo", async () => {
    const { client, hub } = setup();
    await screen.findByText("notas.txt");
    expect(client.session.diff).toHaveBeenCalledTimes(1);
    hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    await waitFor(() => expect(client.session.diff).toHaveBeenCalledTimes(2), { timeout: 1500 });
  });

  test("ignora el fin de turno de otra sesión", async () => {
    const { client, hub } = setup();
    await screen.findByText("notas.txt");
    hub.push({ type: "session.idle", data: { sessionID: "otra" } });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(client.session.diff).toHaveBeenCalledTimes(1);
  });
});

describe("ChangesPanel — árbol de trabajo", () => {
  test("carga el estado de git y pide el diff al abrir un fichero", async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await screen.findByText("notas.txt");
    await user.click(screen.getByRole("button", { name: "Working tree" }));
    await waitFor(() => expect(client.vcs.status).toHaveBeenCalled());
    expect(await screen.findByText("viejo.txt")).toBeInTheDocument();
    expect(screen.getByLabelText("Resumen de cambios")).toHaveTextContent("2 archivos");
    expect(screen.getByLabelText("borrado")).toHaveTextContent("D");
    expect(client.vcs.diff).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /viejo\.txt/ }));
    await waitFor(() =>
      expect(client.vcs.diff).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "working", untracked: "files" }),
      ),
    );
    expect(screen.getByText("tres")).toBeInTheDocument();
  });

  test("un árbol limpio no pide parches", async () => {
    setup({ vcsStatus: [] });
    const user = userEvent.setup();
    await screen.findByText("notas.txt");
    await user.click(screen.getByRole("button", { name: "Working tree" }));
    expect(await screen.findByText("El árbol de trabajo está limpio.")).toBeInTheDocument();
    expect(screen.getByLabelText("Resumen de cambios")).toHaveTextContent("0 archivos");
  });
});

describe("ChangesPanel — errores", () => {
  test("muestra el error del servidor sin romper el panel", async () => {
    const client = {
      ...makeFakeClient().client,
    } as unknown as ChatServer;
    client.session.diff = vi.fn(async () => {
      throw new Error("sesión no encontrada");
    });
    render(<ChangesPanel client={client} workspace={makeWorkspace()} sessionId="s1" />);
    expect(await screen.findByText(/sesión no encontrada/)).toBeInTheDocument();
  });
});
