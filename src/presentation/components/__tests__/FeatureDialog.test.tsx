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
