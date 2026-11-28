import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureDialog } from "../FeatureDialog";
import type { Repo } from "../../../types";

const repo: Repo = {
  id: "repo-web",
  name: "Web",
  path: "/repos/web",
  provider: "github",
  mainBranch: "main",
  createdAt: 0,
  updatedAt: 0,
};

describe("FeatureDialog", () => {
  test("crea un borrador con el repo, base y scope indicados", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(
      <FeatureDialog repos={[repo]} dataDir="/data" onClose={() => {}} onCreated={onCreated} />,
    );

    await user.type(screen.getByLabelText("Nombre"), "Checkout con Stripe");
    await user.type(screen.getByLabelText("Objetivo"), "Cobrar con Stripe");
    await user.click(screen.getByRole("checkbox", { name: /Web/ }));
    await user.click(screen.getByRole("button", { name: "Crear feature" }));

    expect(onCreated).toHaveBeenCalledTimes(1);
    const feature = onCreated.mock.calls[0][0];
    expect(feature.name).toBe("Checkout con Stripe");
    expect(feature.kind).toBe("feature");
    expect(feature.brief).toBe("Cobrar con Stripe");
    expect(feature.status).toBe("draft");
    expect(feature.directory).toMatch(/^\/data\/features\//);
    expect(feature.targets).toHaveLength(1);
    expect(feature.targets[0].repoPath).toBe("/repos/web");
    expect(feature.targets[0].baseBranch).toBe("main");
    expect(feature.targets[0].scopes).toEqual([{ id: "scope-root", path: "." }]);
    expect(feature.targets[0].branch).toBe("feature/checkout-con-stripe");
  });

  test("expone las etiquetas de todos los campos y Escape cierra", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FeatureDialog repos={[repo]} dataDir="/data" onClose={onClose} onCreated={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Nueva feature" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Tipo")).toHaveFocus();
    expect(screen.getByLabelText("Tipo")).toBeInTheDocument();
    expect(screen.getByLabelText("Metarepo (opcional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Objetivo")).toBeInTheDocument();
    expect(screen.getByLabelText("Base del metarepo")).toBeInTheDocument();
    expect(screen.getByLabelText("Base de los repos")).toBeInTheDocument();
    expect(screen.getByLabelText("Scopes")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  test("propone candidatos por repo y guarda solo los marcados", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const detectBootstrap = vi.fn(async (repoId: string) => ({
      candidates:
        repoId === "repo-web"
          ? [
              { path: ".env", kind: "env" as const },
              { path: ".env.local", kind: "env" as const },
            ]
          : [],
      truncated: false,
    }));
    render(
      <FeatureDialog
        repos={[repo]}
        dataDir="/data"
        detectBootstrap={detectBootstrap}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );

    await user.type(screen.getByLabelText("Nombre"), "Checkout con Stripe");
    await user.type(screen.getByLabelText("Objetivo"), "Cobrar con Stripe");
    await user.click(screen.getByRole("checkbox", { name: /Web/ }));

    const env = await screen.findByRole("checkbox", { name: ".env en Web" });
    const local = screen.getByRole("checkbox", { name: ".env.local en Web" });
    expect(env).not.toBeChecked();
    expect(local).not.toBeChecked();

    await user.click(env);
    await user.click(screen.getByRole("button", { name: "Crear feature" }));

    expect(detectBootstrap).toHaveBeenCalledWith("repo-web");
    const feature = onCreated.mock.calls[0][0];
    expect(feature.targets[0].bootstrap).toEqual([{ path: ".env", mode: "copy", required: false }]);
  });

  test("agrupa los candidatos por repo y avisa si la lista se trunca", async () => {
    const user = userEvent.setup();
    const api: Repo = { ...repo, id: "repo-api", name: "API", path: "/repos/api" };
    const detectBootstrap = vi.fn(async (repoId: string) =>
      repoId === "repo-web"
        ? {
            candidates: [{ path: ".env", kind: "env" as const }],
            truncated: false,
          }
        : {
            candidates: [{ path: "app.local.yml", kind: "local" as const }],
            truncated: true,
          },
    );
    render(
      <FeatureDialog
        repos={[repo, api]}
        dataDir="/data"
        detectBootstrap={detectBootstrap}
        onClose={() => {}}
        onCreated={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Web" }));
    await user.click(screen.getByRole("checkbox", { name: "API" }));

    expect(await screen.findByRole("checkbox", { name: ".env en Web" })).toBeInTheDocument();
    expect(
      await screen.findByRole("checkbox", { name: "app.local.yml en API" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hay más candidatos/)).toBeInTheDocument();
    expect(detectBootstrap).toHaveBeenCalledWith("repo-web");
    expect(detectBootstrap).toHaveBeenCalledWith("repo-api");
  });

  test("conserva el bootstrap manual y no lo duplica con lo detectado", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const configured: Repo = {
      ...repo,
      bootstrap: [{ path: ".env", mode: "copy", required: true }],
    };
    const detectBootstrap = vi.fn(async () => ({
      candidates: [
        { path: ".env", kind: "env" as const },
        { path: ".env.local", kind: "env" as const },
      ],
      truncated: false,
    }));
    render(
      <FeatureDialog
        repos={[configured]}
        dataDir="/data"
        detectBootstrap={detectBootstrap}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );

    await user.type(screen.getByLabelText("Nombre"), "Checkout con Stripe");
    await user.type(screen.getByLabelText("Objetivo"), "Cobrar con Stripe");
    await user.click(screen.getByRole("checkbox", { name: /Web/ }));

    const env = await screen.findByRole("checkbox", { name: ".env en Web" });
    expect(env).toBeChecked();
    expect(screen.getByRole("checkbox", { name: ".env.local en Web" })).not.toBeChecked();
    expect(screen.getAllByRole("checkbox", { name: /\.env en Web/ })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Crear feature" }));

    expect(onCreated.mock.calls[0][0].targets[0].bootstrap).toEqual([
      { path: ".env", mode: "copy", required: true },
    ]);
  });

  test("un fallo de detección avisa pero no bloquea el alta", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const configured: Repo = {
      ...repo,
      bootstrap: [{ path: ".env", mode: "copy", required: true }],
    };
    const detectBootstrap = vi.fn(async () => {
      throw new Error("git no disponible");
    });
    render(
      <FeatureDialog
        repos={[configured]}
        dataDir="/data"
        detectBootstrap={detectBootstrap}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );

    await user.type(screen.getByLabelText("Nombre"), "Checkout con Stripe");
    await user.type(screen.getByLabelText("Objetivo"), "Cobrar con Stripe");
    await user.click(screen.getByRole("checkbox", { name: /Web/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron detectar candidatos",
    );
    await user.click(screen.getByRole("button", { name: "Crear feature" }));

    expect(onCreated.mock.calls[0][0].targets[0].bootstrap).toEqual([
      { path: ".env", mode: "copy", required: true },
    ]);
  });

  test("un hotfix usa el flujo rápido y exige repos", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(
      <FeatureDialog repos={[repo]} dataDir="/data" onClose={() => {}} onCreated={onCreated} />,
    );

    expect(screen.getByRole("button", { name: "Crear feature" })).toBeDisabled();

    await user.type(screen.getByLabelText("Nombre"), "Caída de pagos");
    await user.type(screen.getByLabelText("Objetivo"), "Recuperar el cobro");
    await user.selectOptions(screen.getByLabelText("Tipo"), "hotfix");

    expect(screen.getByText(/Flujo rápido/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Web/ }));
    await user.click(screen.getByRole("button", { name: "Crear feature" }));

    const feature = onCreated.mock.calls[0][0];
    expect(feature.kind).toBe("hotfix");
    expect(feature.flow).toBe("fast");
    expect(feature.targets[0].branch).toBe("hotfix/caida-de-pagos");
  });
});
