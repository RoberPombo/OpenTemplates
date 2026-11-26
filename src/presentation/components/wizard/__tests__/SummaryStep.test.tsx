import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SummaryStep } from "../SummaryStep";
import { makeWorkspace } from "../../../../tests/fakes";
import type { ProfileManifest, SkillRef } from "../../../../types";

const profile: ProfileManifest = {
  id: "plantilla",
  name: "Plantilla",
  description: "",
  version: 1,
  agents: ["a1", "a2"],
  skills: ["s1"],
  mcps: ["m1"],
  commands: [],
  plugins: [],
  models: [],
  model: null,
  permissions: [],
  createdAt: 0,
  updatedAt: 0,
};

function setup(overrides: { pathConflicts?: boolean } = {}) {
  const onToggleStartNow = vi.fn();
  render(
    <SummaryStep
      name="Demo"
      loose={false}
      loosePath=""
      repo={{
        id: "r1",
        name: "Repo",
        path: "/repo",
        remote: null,
        provider: "github",
        mainBranch: "main",
        createdAt: 0,
        updatedAt: 0,
      }}
      mode="worktree"
      worktreePath=""
      defaultPath="/wt/repo/demo"
      branch=""
      base=""
      defaultBranch="demo"
      profile={profile}
      selectedMcps={new Set()}
      selectedSkills={new Map<string, SkillRef>()}
      pathConflicts={
        overrides.pathConflicts
          ? [makeWorkspace({ id: "ocupado", name: "Ocupado", mode: "principal" })]
          : []
      }
      startNow={false}
      onToggleStartNow={onToggleStartNow}
    />,
  );
  return { onToggleStartNow };
}

describe("SummaryStep", () => {
  test("resume la configuración y permite arrancar el servidor", async () => {
    const user = userEvent.setup();
    const { onToggleStartNow } = setup();

    expect(screen.getByRole("heading", { name: "Resumen" })).toBeInTheDocument();
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("Plantilla · v1")).toBeInTheDocument();
    expect(screen.getByText("2 agentes · 1 skills · 1 MCPs")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Arrancar el servidor al crear/ }));
    expect(onToggleStartNow).toHaveBeenCalledOnce();
  });

  test("avisa de conflictos de carpeta", () => {
    setup({ pathConflicts: true });
    expect(screen.getByText(/La carpeta del checkout principal ya la usa/)).toBeInTheDocument();
    expect(screen.getByText(/Ocupado/)).toBeInTheDocument();
  });
});
