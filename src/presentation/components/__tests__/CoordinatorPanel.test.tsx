import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoordinatorPanel } from "../CoordinatorPanel";
import type { Feature } from "../../../domain/features/model";
import { makeFeature } from "../../../tests/fixtures";

function draft(overrides: Parameters<typeof makeFeature>[0] = {}): Feature {
  return makeFeature({
    name: "Checkout con Stripe",
    brief: "Cobrar con Stripe",
    targets: [{ repoId: "web", name: "Web", repoPath: "/repos/web", scopes: ["front"] }],
    now: 1,
    ...overrides,
  });
}
describe("CoordinatorPanel", () => {
  test("muestra el encargo y guarda la descomposición editada", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(
      <CoordinatorPanel
        feature={draft()}
        artifacts={[]}
        profiles={[]}
        defaultProfileId={null}
        runner={null}
        coordinatorBusy={false}
        onSave={onSave}
        onReloadArtifacts={async () => undefined}
        onLaunch={async () => undefined}
        onStop={async () => undefined}
        onApprove={async () => undefined}
      />,
    );

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
      <CoordinatorPanel
        feature={draft({ kind: "hotfix" })}
        artifacts={[]}
        profiles={[]}
        defaultProfileId={null}
        runner={null}
        coordinatorBusy={false}
        onSave={vi.fn()}
        onReloadArtifacts={async () => undefined}
        onLaunch={async () => undefined}
        onStop={async () => undefined}
        onApprove={async () => undefined}
      />,
    );
    expect(screen.getByText(/Flujo rápido: no hay coordinador/)).toBeInTheDocument();
  });
});
