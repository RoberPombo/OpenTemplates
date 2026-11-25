import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureView } from "../FeatureView";
import type { CreateFeatureInput, Feature } from "../../../domain/features/model";
import { createFeatureDraft } from "../../../domain/features/model";
import { startFeature } from "../../../domain/features/flow";

function makeFeature(overrides: Partial<CreateFeatureInput> = {}): Feature {
  const result = createFeatureDraft({
    id: "feat-1",
    name: "Checkout con Stripe",
    kind: "feature",
    brief: "Cobrar con Stripe en el checkout",
    directory: "/data/features/feat-1",
    targets: [{ repoId: "web", name: "Web", repoPath: "/repos/web" }],
    now: 1,
    ...overrides,
  });
  if ("error" in result) throw new Error(result.error);
  return result.feature;
}

function started(overrides: Partial<CreateFeatureInput> = {}): Feature {
  const result = startFeature(makeFeature(overrides), 2);
  if ("error" in result) throw new Error(result.error);
  return result.feature;
}

describe("FeatureView", () => {
  test("muestra alcance, pasos y el siguiente paso listo", () => {
    render(
      <FeatureView
        feature={started()}
        busy={false}
        notice={null}
        error={null}
        onProvision={() => {}}
        onDelete={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Checkout con Stripe" })).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.getByText("Confirmada")).toBeInTheDocument();
    expect(screen.getByText("/data/features/feat-1/web")).toBeInTheDocument();
    expect(screen.getByText("Coordinación")).toBeInTheDocument();
    expect(screen.getByText("Plan · Web")).toBeInTheDocument();
    expect(screen.getAllByText("siguiente")).toHaveLength(1);
  });

  test("preparar worktrees avisa y deshabilita mientras trabaja", async () => {
    const user = userEvent.setup();
    const onProvision = vi.fn();
    const { rerender } = render(
      <FeatureView
        feature={started()}
        busy={false}
        notice={null}
        error={null}
        onProvision={onProvision}
        onDelete={() => {}}
        onBack={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Preparar worktrees" }));
    expect(onProvision).toHaveBeenCalledTimes(1);

    rerender(
      <FeatureView
        feature={started()}
        busy
        notice={null}
        error={null}
        onProvision={onProvision}
        onDelete={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Preparando…" })).toBeDisabled();
  });

  test("muestra el error de bootstrap bloqueado", () => {
    render(
      <FeatureView
        feature={{ ...started(), status: "blocked" }}
        busy={false}
        notice={null}
        error="Bootstrap obligatorio «.env»: falta .env en el checkout principal."
        onProvision={() => {}}
        onDelete={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText("Bloqueada")).toBeInTheDocument();
    expect(screen.getByText(/Bootstrap obligatorio/)).toBeInTheDocument();
  });
});
