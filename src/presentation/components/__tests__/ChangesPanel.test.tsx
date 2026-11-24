import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangesPanel } from "../ChangesPanel";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import type { ConfirmDialog } from "../../../domain/repositories/Dialogs";
import {
  makeConfirmDialog,
  makeFakeClient,
  makeGitFile,
  makeGitGateway,
  makeGitStatus,
  makePullRequestGateway,
  makeWorkspace,
  type FakeClientOptions,
} from "../../../tests/fakes";
import type { GitStatus } from "../../../domain/workspace/git";

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

const workingGit = makeGitStatus({
  branch: "feat/panel",
  upstream: null,
  files: [
    makeGitFile({
      path: "notas.txt",
      staged: false,
      index: null,
      worktree: "M",
      additions: 1,
      deletions: 1,
    }),
    makeGitFile({
      path: "viejo.txt",
      status: "deleted",
      staged: false,
      index: null,
      worktree: "D",
      additions: 0,
      deletions: 3,
    }),
  ],
});

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
  options: {
    status?: GitStatus;
    sessionId?: string | null;
    confirm?: ConfirmDialog;
    client?: Partial<FakeClientOptions>;
    gitOptions?: Partial<Parameters<typeof makeGitGateway>[0]>;
  } = {},
) {
  const sessionId = options.sessionId === undefined ? "s1" : options.sessionId;
  const { client, hub } = makeFakeClient({
    sessionDiff,
    vcsDiff: workingDiff,
    ...options.client,
  });
  const git = makeGitGateway({ status: options.status ?? workingGit, ...options.gitOptions });
  const pullRequests = makePullRequestGateway();
  render(
    <ChangesPanel
      client={client as unknown as ChatServer}
      workspace={makeWorkspace()}
      sessionId={sessionId}
      git={git.gateway}
      pullRequests={pullRequests.gateway}
      confirm={options.confirm ?? makeConfirmDialog()}
    />,
  );
  return { client, hub, git, pullRequests };
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
    const { client } = setup({ sessionId: null });
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
    const { client, git } = setup();
    await screen.findByText("notas.txt");
    await user.click(screen.getByRole("button", { name: "Working tree" }));
    await waitFor(() => expect(git.status).toHaveBeenCalled());
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
    setup({ status: makeGitStatus({ files: [] }) });
    const user = userEvent.setup();
    await screen.findByText("notas.txt");
    await user.click(screen.getByRole("button", { name: "Working tree" }));
    expect(await screen.findByText("El árbol de trabajo está limpio.")).toBeInTheDocument();
    expect(screen.getByLabelText("Resumen de cambios")).toHaveTextContent("0 archivos");
  });
});

describe("ChangesPanel — commit y push", () => {
  test("prepara y quita ficheros con el checkbox", async () => {
    const user = userEvent.setup();
    const { git } = setup();
    await user.click(screen.getByRole("button", { name: "Working tree" }));
    const checkbox = await screen.findByLabelText("Preparar notas.txt");
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(git.stage).toHaveBeenCalledWith("/tmp/demo", ["notas.txt"]);
    await waitFor(() => expect(screen.getByLabelText("Quitar del stage notas.txt")).toBeChecked());
    await user.click(screen.getByLabelText("Quitar del stage notas.txt"));
    expect(git.unstage).toHaveBeenCalledWith("/tmp/demo", ["notas.txt"]);
  });

  test("sugiere el mensaje con el diff preparado y commitea solo con acción explícita", async () => {
    const user = userEvent.setup();
    const status = makeGitStatus({
      files: [
        makeGitFile({ path: "a.txt", staged: true, additions: 2, deletions: 0 }),
        makeGitFile({
          path: "b.txt",
          staged: false,
          index: null,
          worktree: "M",
        }),
      ],
    });
    const { client, git } = setup({
      status,
      confirm: makeConfirmDialog(false),
      client: { generatedText: "feat(panel): mensaje sugerido" },
    });
    await user.click(screen.getByRole("button", { name: "Working tree" }));
    const commitButton = await screen.findByRole("button", { name: "Commit" });
    expect(commitButton).toBeDisabled();
    expect(git.commit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sugerir mensaje" }));
    await waitFor(() => expect(client.generate.text).toHaveBeenCalled());
    expect(client.generate.text.mock.calls[0]?.[0].prompt).toContain("diff --git a/src/a.ts");
    expect(screen.getByLabelText("Mensaje del commit")).toHaveValue(
      "feat(panel): mensaje sugerido",
    );

    await user.click(screen.getByRole("button", { name: "Commit" }));
    expect(git.commit).not.toHaveBeenCalled();
  });

  test("confirma antes de commitear si quedan ficheros sin preparar", async () => {
    const user = userEvent.setup();
    const status = makeGitStatus({
      files: [
        makeGitFile({ path: "a.txt", staged: true }),
        makeGitFile({ path: "b.txt", staged: false, index: null, worktree: "M" }),
      ],
    });
    const confirm = { confirm: vi.fn(() => true) };
    const { git } = setup({ status, confirm });
    await user.click(screen.getByRole("button", { name: "Working tree" }));
    const message = await screen.findByLabelText("Mensaje del commit");
    await user.type(message, "feat: cambia a");
    await user.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => expect(git.commit).toHaveBeenCalledWith("/tmp/demo", "feat: cambia a"));
    expect(confirm.confirm).toHaveBeenCalledWith(expect.stringContaining("b.txt"));
  });

  test("un hook que falla muestra la salida y no hace push", async () => {
    const user = userEvent.setup();
    const status = makeGitStatus({ files: [makeGitFile({ path: "a.txt", staged: true })] });
    const { git } = setup({
      status,
      gitOptions: { commitError: new Error("El commit falló:\nhook roto: falta el test") },
    });
    await user.click(screen.getByRole("button", { name: "Working tree" }));
    await user.type(await screen.findByLabelText("Mensaje del commit"), "feat: algo");
    await user.click(screen.getByRole("button", { name: "Commit" }));
    expect(await screen.findByText(/hook roto/)).toBeInTheDocument();
    expect(git.push).not.toHaveBeenCalled();
  });

  test("sin upstream ofrece publicar la rama con su nombre visible", async () => {
    const user = userEvent.setup();
    const { git } = setup();
    await user.click(screen.getByRole("button", { name: "Working tree" }));
    const publish = await screen.findByRole("button", {
      name: "Publicar rama (push -u origin/feat/panel)",
    });
    await user.click(publish);
    await waitFor(() =>
      expect(git.push).toHaveBeenCalledWith("/tmp/demo", {
        branch: "feat/panel",
        setUpstream: true,
        remote: "origin",
      }),
    );
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
    const git = makeGitGateway();
    const pullRequests = makePullRequestGateway();
    render(
      <ChangesPanel
        client={client}
        workspace={makeWorkspace()}
        sessionId="s1"
        git={git.gateway}
        pullRequests={pullRequests.gateway}
        confirm={makeConfirmDialog()}
      />,
    );
    expect(await screen.findByText(/sesión no encontrada/)).toBeInTheDocument();
  });
});
