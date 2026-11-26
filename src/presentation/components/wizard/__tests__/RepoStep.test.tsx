import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepoStep } from "../RepoStep";
import type { Repo } from "../../../../types";

const repo: Repo = {
  id: "r1",
  name: "Repo",
  path: "/repo",
  remote: null,
  provider: "github",
  mainBranch: "main",
  createdAt: 0,
  updatedAt: 0,
};

function setup(overrides: { loose?: boolean } = {}) {
  const handlers = {
    onSelectRepo: vi.fn(),
    onSelectLoose: vi.fn(),
    onPickRepo: vi.fn(),
    onPickLooseFolder: vi.fn(),
    onLoosePathChange: vi.fn(),
  };
  render(
    <RepoStep
      repos={[repo]}
      loose={overrides.loose ?? false}
      repoId="r1"
      loosePath=""
      {...handlers}
    />,
  );
  return handlers;
}

describe("RepoStep", () => {
  test("lista los repos y notifica la selección", async () => {
    const user = userEvent.setup();
    const { onSelectRepo, onPickRepo } = setup();

    expect(screen.getByRole("heading", { name: "Repositorio" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Repo/ }));
    expect(onSelectRepo).toHaveBeenCalledWith("r1");

    await user.click(screen.getByRole("button", { name: "Añadir carpeta…" }));
    expect(onPickRepo).toHaveBeenCalledOnce();
  });

  test("en carpeta suelta muestra la ruta y permite elegirla", async () => {
    const user = userEvent.setup();
    const { onPickLooseFolder, onLoosePathChange } = setup({ loose: true });

    const pathInput = screen.getByLabelText("Carpeta");
    fireEvent.change(pathInput, { target: { value: "/tmp" } });
    expect(onLoosePathChange).toHaveBeenLastCalledWith("/tmp");

    await user.click(screen.getByRole("button", { name: "Elegir…" }));
    expect(onPickLooseFolder).toHaveBeenCalledOnce();
  });
});
