import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileStep } from "../ProfileStep";
import type { Library, ProfileManifest, SkillRef } from "../../../../types";

const profile: ProfileManifest = {
  id: "plantilla",
  name: "Plantilla",
  description: "",
  version: 1,
  agents: [],
  skills: [],
  mcps: [],
  commands: [],
  plugins: [],
  models: [],
  model: null,
  permissions: [],
  createdAt: 0,
  updatedAt: 0,
};

const library: Library = {
  agents: [],
  commands: [],
  plugins: [],
  skills: [
    { id: "skill-1", name: "Skill uno", description: "Una skill", path: "/s", source: "local" },
  ],
  mcps: [{ name: "mcp-uno", config: { url: "https://mcp.example" }, source: "local" }],
};

const selectedSkills = new Map<string, SkillRef>();

function setup(overrides: { quickOpen?: boolean; profileId?: string | null } = {}) {
  const handlers = {
    onToggleQuickOpen: vi.fn(),
    onQuickNameChange: vi.fn(),
    onQuickDescriptionChange: vi.fn(),
    onCreateQuickProfile: vi.fn(),
    onSelectProfile: vi.fn(),
    onToggleMcp: vi.fn(),
    onToggleSkill: vi.fn(),
  };
  render(
    <ProfileStep
      profiles={[profile]}
      library={library}
      profileId={overrides.profileId === undefined ? null : overrides.profileId}
      quickOpen={overrides.quickOpen ?? false}
      quickName=""
      quickDescription=""
      quickSlug=""
      savingProfile={false}
      selectedMcps={new Set()}
      selectedSkills={selectedSkills}
      {...handlers}
    />,
  );
  return handlers;
}

describe("ProfileStep", () => {
  test("elige un perfil y permite marcar MCPs y skills", async () => {
    const user = userEvent.setup();
    const { onSelectProfile, onToggleMcp, onToggleSkill } = setup();

    expect(screen.getByRole("heading", { name: "Perfil" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Plantilla/ }));
    expect(onSelectProfile).toHaveBeenCalledWith("plantilla");

    await user.click(screen.getByRole("checkbox", { name: /mcp-uno/ }));
    expect(onToggleMcp).toHaveBeenCalledWith("mcp-uno");

    await user.click(screen.getByRole("checkbox", { name: /Skill uno/ }));
    expect(onToggleSkill).toHaveBeenCalledWith(library.skills[0]);
  });

  test("el alta rápida usa sus campos y envía la creación", async () => {
    const user = userEvent.setup();
    const { onQuickNameChange, onCreateQuickProfile } = setup({ quickOpen: true });

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Backend" } });
    expect(onQuickNameChange).toHaveBeenLastCalledWith("Backend");

    await user.click(screen.getByRole("button", { name: "Crear y elegir" }));
    expect(onCreateQuickProfile).toHaveBeenCalledOnce();
  });

  test("con perfil elegido no muestra la selección manual", () => {
    setup({ profileId: "plantilla" });
    expect(screen.queryByRole("heading", { name: "MCPs" })).toBeNull();
  });
});
