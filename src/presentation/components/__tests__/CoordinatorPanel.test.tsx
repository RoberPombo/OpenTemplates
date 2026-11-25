import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoordinatorPanel } from "../CoordinatorPanel";
import type { CreateFeatureInput, Feature } from "../../../domain/features/model";
import { createFeatureDraft } from "../../../domain/features/model";

function draft(overrides: Partial<CreateFeatureInput> = {}): Feature {
  const result = createFeatureDraft({
    id: "feat-1",
    name: "Checkout con Stripe",
    kind: "feature",
    brief: "Cobrar con Stripe",
    directory: "/data/features/feat-1",
    targets: [{ repoId: "web", name: "Web", repoPath: "/repos/web", scopes: ["front"] }],
    now: 1,
    ...overrides,
  });
  if ("error" in result) throw new Error(result.error);
  return result.feature;
}

describe("CoordinatorPanel", () => {
  test("muestra el encargo y guarda la descomposición editada", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(<CoordinatorPanel feature={draft()} artifacts={[]} onSave={onSave} />);

    expect(screen.getByText(/Eres el coordinador/)).toBeInTheDocument();
    const editor = screen.getByLabelText("Descomposición");
    expect((editor as HTMLTextAreaElement).value).toContain(
      "# Descomposición — Checkout con Stripe",
    );
    expect((editor as HTMLTextAreaElement).value).toContain("### Web · front");

    await user.clear(editor);
    await user.type(editor, "Mi plan por scope");
    await user.click(screen.getByRole("button", { name: "Guardar descomposición" }));

    expect(onSave).toHaveBeenCalledWith("DECOMPOSITION.md", "Mi plan por scope");
    expect(await screen.findByText("Descomposición guardada.")).toBeInTheDocument();
  });

  test("en flujo rápido no hay coordinador", () => {
    render(
      <CoordinatorPanel feature={draft({ kind: "hotfix" })} artifacts={[]} onSave={vi.fn()} />,
    );
    expect(screen.getByText(/Flujo rápido: no hay coordinador/)).toBeInTheDocument();
  });
});
