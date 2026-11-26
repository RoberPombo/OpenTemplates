import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NameStep } from "../NameStep";
import { makeWorkspace } from "../../../../tests/fakes";
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

function setup(overrides: { mode?: "principal" | "worktree"; conflicts?: boolean } = {}) {
  const handlers = {
    onNameChange: vi.fn(),
    onModeChange: vi.fn(),
    onBranchChange: vi.fn(),
    onBaseChange: vi.fn(),
    onWorktreePathChange: vi.fn(),
    onToggleFetchRemote: vi.fn(),
    onToggleUseExisting: vi.fn(),
  };
  render(
    <NameStep
      name=""
      slug=""
      loose={false}
      loosePath=""
      repo={repo}
      mode={overrides.mode ?? "worktree"}
      branch=""
      base=""
      worktreePath=""
      defaultBranch="ws"
      defaultPath="/wt/repo/ws"
      fetchRemote={false}
      useExisting={false}
      principalConflicts={
        overrides.conflicts
          ? [makeWorkspace({ id: "ocupado", repoId: "r1", mode: "principal", name: "Ocupado" })]
          : []
      }
      {...handlers}
    />,
  );
  return handlers;
}

describe("NameStep", () => {
  test("el nombre alimenta el campo y el modo worktree muestra rama y base", async () => {
    const user = userEvent.setup();
    const { onNameChange, onModeChange } = setup();

    fireEvent.change(screen.getByLabelText("Nombre del workspace"), { target: { value: "ws" } });
    expect(onNameChange).toHaveBeenLastCalledWith("ws");

    expect(screen.getByLabelText(/^Rama/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Base/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Ruta del worktree/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Checkout principal/ }));
    expect(onModeChange).toHaveBeenCalledWith("principal");
  });

  test("avisa del conflicto al elegir checkout principal", () => {
    setup({ mode: "principal", conflicts: true });
    expect(screen.getByText(/Ya hay un workspace sobre el checkout principal/)).toBeInTheDocument();
    expect(screen.getByText(/Ocupado/)).toBeInTheDocument();
  });
});
