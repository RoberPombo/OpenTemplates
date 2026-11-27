import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteFeatureDialog } from "../DeleteFeatureDialog";
import type { FeatureDeletePreview } from "../../../domain/features/deletion";

function preview(overrides: Partial<FeatureDeletePreview> = {}): FeatureDeletePreview {
  return {
    featureId: "feat-1",
    name: "Checkout con Stripe",
    directory: "/data/features/feat-1",
    worktrees: [
      {
        role: "root",
        name: "Meta",
        repoPath: "/repos/meta",
        path: "/data/features/feat-1/meta",
        branch: "feature/checkout",
        baseBranch: "main",
        exists: true,
        dirty: false,
        branchExists: true,
        branchPublished: false,
        branchInUse: null,
        protectReason: null,
      },
      {
        role: "target",
        name: "Web",
        repoPath: "/repos/web",
        path: "/data/features/feat-1/meta/repos/web",
        branch: "feature/checkout",
        baseBranch: "develop",
        exists: true,
        dirty: false,
        branchExists: true,
        branchPublished: true,
        branchInUse: null,
        protectReason: "publicada en origin",
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe("DeleteFeatureDialog", () => {
  test("lista worktrees y ramas y exige aceptar los cambios sin commitear", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const dirty = preview();
    dirty.worktrees[0] = { ...dirty.worktrees[0], dirty: true };

    render(
      <DeleteFeatureDialog
        preview={dirty}
        busy={false}
        error={null}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getAllByText("/data/features/feat-1/meta").length).toBeGreaterThan(0);
    expect(screen.getByText("se conserva: publicada en origin")).toBeInTheDocument();
    expect(screen.getByText("se borra")).toBeInTheDocument();
    expect(screen.getByText("Hay cambios sin commitear.")).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "Eliminar feature" });
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /cambios sin commitear/i }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  test("sin cambios confirma directamente y cancelar no borra", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DeleteFeatureDialog
        preview={preview()}
        busy={false}
        error={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Eliminar feature" }));
    expect(onConfirm).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("muestra el error del fallo parcial sin cerrar el diálogo", () => {
    render(
      <DeleteFeatureDialog
        preview={preview()}
        busy={false}
        error="No se pudo quitar el worktree /x. La feature sigue en la lista para poder reintentar."
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo quitar el worktree");
  });
});
