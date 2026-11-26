import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { ModelOption } from "../../../domain/chat/selection";
import { RaceDialog } from "../RaceDialog";

const MODELS: ModelOption[] = [
  {
    key: "anthropic/claude",
    providerID: "anthropic",
    id: "claude",
    name: "Claude",
    variants: [],
    details: {
      key: "anthropic/claude",
      providerID: "anthropic",
      id: "claude",
      name: "Claude",
      inputModalities: [],
      outputModalities: [],
      cost: { input: 3, output: 15 },
    },
  },
  {
    key: "openai/gpt",
    providerID: "openai",
    id: "gpt",
    name: "GPT",
    variants: [],
    details: {
      key: "openai/gpt",
      providerID: "openai",
      id: "gpt",
      name: "GPT",
      inputModalities: [],
      outputModalities: [],
      cost: { input: 1, output: 4 },
    },
  },
  {
    key: "google/gemini",
    providerID: "google",
    id: "gemini",
    name: "Gemini",
    variants: [],
  },
];

function setup(overrides: Partial<React.ComponentProps<typeof RaceDialog>> = {}) {
  const onLaunch = vi.fn(() => null);
  const onClose = vi.fn();
  render(
    <RaceDialog
      models={MODELS}
      agents={[
        { id: "build", name: "Build" },
        { id: "plan", name: "Plan" },
      ]}
      isGit
      worktreesAvailable
      catalogError={null}
      error={null}
      onLaunch={onLaunch}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onLaunch, onClose };
}

async function chooseModels(user: ReturnType<typeof userEvent.setup>, names: RegExp[]) {
  await user.click(screen.getByRole("combobox", { name: "Modelos de la carrera" }));
  for (const name of names) {
    await user.click(await screen.findByRole("option", { name }));
  }
  await user.keyboard("{Escape}");
}

describe("RaceDialog", () => {
  test("expone las etiquetas de los campos y Escape cierra sin lanzar", async () => {
    const user = userEvent.setup();
    const { onClose, onLaunch } = setup();

    expect(screen.getByRole("dialog", { name: "Nueva carrera" })).toBeInTheDocument();
    expect(screen.getByLabelText("Encargo")).toBeInTheDocument();
    expect(
      await screen.findByRole("combobox", { name: "Modelos de la carrera" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("combobox", { name: "Agente de la carrera" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Un worktree por corrida" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  test("exige encargo y al menos dos modelos antes de lanzar", async () => {
    const user = userEvent.setup();
    const { onLaunch } = setup();
    const launch = screen.getByRole("button", { name: "Lanzar carrera" });
    expect(launch).toBeDisabled();

    await user.type(screen.getByLabelText("Encargo"), "Arregla el formulario");
    expect(launch).toBeDisabled();
    expect(screen.getByText("Faltan modelos: 2.")).toBeInTheDocument();

    await chooseModels(user, [/Claude/, /GPT/]);
    await waitFor(() => expect(launch).toBeEnabled());

    await user.click(launch);
    expect(onLaunch).toHaveBeenCalledWith({
      prompt: "Arregla el formulario",
      modelKeys: ["anthropic/claude", "openai/gpt"],
      agent: null,
      useWorktrees: true,
    });
  });

  test("muestra el coste estimado solo cuando todos los modelos dan precios", async () => {
    const user = userEvent.setup();
    setup();
    await chooseModels(user, [/Claude/, /GPT/]);
    expect(await screen.findByText("Coste estimado")).toBeInTheDocument();
    expect(screen.getByText("Claude: $0.024 · GPT: $0.007")).toBeInTheDocument();

    await chooseModels(user, [/Gemini/]);
    await waitFor(() => expect(screen.getByText("sin precios en el catálogo")).toBeInTheDocument());
  });

  test("sin git desactiva el worktree por corrida y lo explica", () => {
    setup({ isGit: false, worktreesAvailable: false });
    const checkbox = screen.getByRole("checkbox", { name: /Un worktree por corrida/ });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(/compartirán la carpeta del workspace/)).toBeInTheDocument();
  });

  test("un error al lanzar se pinta y no cierra el diálogo", async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn(() => "No hay proyecto");
    const { onClose } = setup({ onLaunch });
    await user.type(screen.getByLabelText("Encargo"), "Haz algo");
    await chooseModels(user, [/Claude/, /GPT/]);
    await user.click(screen.getByRole("button", { name: "Lanzar carrera" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No hay proyecto");
    expect(onClose).not.toHaveBeenCalled();
    expect(onLaunch).toHaveBeenCalled();
  });
});
