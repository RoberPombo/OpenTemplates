import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Feature } from "../../../domain/features/model";
import { StepSessions } from "../StepSessions";
import { makeRunner, makeStartedFeature } from "../../../tests/fixtures";
import type { ProfileManifest } from "../../../types";

function profile(overrides: Partial<ProfileManifest> = {}): ProfileManifest {
  return {
    id: "implementador",
    name: "Implementador",
    description: "",
    version: 1,
    agents: ["implementer"],
    skills: [],
    mcps: [],
    commands: [],
    plugins: [],
    models: [],
    permissions: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

type Props = Parameters<typeof StepSessions>[0];

function renderSessions(overrides: Partial<Props> = {}) {
  const feature = overrides.feature ?? makeStartedFeature({ kind: "chore" });
  const onLaunch = vi.fn(async () => undefined);
  const onFinish = vi.fn(async () => undefined);
  const onApprove = vi.fn(async () => undefined);
  render(
    <StepSessions
      feature={feature}
      profiles={[profile()]}
      defaultProfileId={null}
      runner={null}
      openStepId={null}
      busyStepId={null}
      onLaunch={onLaunch}
      onFinish={onFinish}
      onApprove={onApprove}
      onCloseChat={() => {}}
      {...overrides}
    />,
  );
  return { feature, onLaunch, onFinish, onApprove };
}

describe("StepSessions", () => {
  test("lanza un paso listo con el perfil resuelto por rol", async () => {
    const user = userEvent.setup();
    const { feature, onLaunch } = renderSessions();
    const implement = feature.steps.find((step) => step.type === "implement")!;

    expect(screen.getByText("Implementador · implementer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lanzar sesión" }));
    expect(onLaunch).toHaveBeenCalledWith(implement.id, "implementador");
  });

  test("un paso en revisión pide aprobación y no ofrece lanzar", async () => {
    const user = userEvent.setup();
    const feature = makeStartedFeature();
    const steps = feature.steps.map((step) =>
      step.type === "coordinate"
        ? { ...step, status: "done" as const }
        : step.type === "recon"
          ? { ...step, status: "awaiting-review" as const, sessionId: "ses-recon" }
          : step,
    );
    const { onApprove } = renderSessions({ feature: { ...feature, steps } });
    const recon = steps.find((step) => step.type === "recon")!;

    expect(screen.getByText("Revisión")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aprobar y continuar" }));
    expect(onApprove).toHaveBeenCalledWith(recon.id);
  });

  test("un paso en marcha reabre el chat o se termina", async () => {
    const user = userEvent.setup();
    const feature = makeStartedFeature({ kind: "chore" });
    const implement = feature.steps.find((step) => step.type === "implement")!;
    const running: Feature = {
      ...feature,
      steps: feature.steps.map((step) =>
        step.id === implement.id ? { ...step, status: "running", sessionId: "ses-step" } : step,
      ),
    };
    const runner = makeRunner(feature.id, {
      profileId: "implementador",
      directory: "/data/features/feat-1/web",
    });
    const { onFinish, onLaunch } = renderSessions({
      feature: running,
      runner,
      openStepId: null,
    });

    await user.click(screen.getByRole("button", { name: "Abrir chat" }));
    expect(onLaunch).toHaveBeenCalledWith(implement.id, "implementador");
    await user.click(screen.getByRole("button", { name: "Terminar paso" }));
    expect(onFinish).toHaveBeenCalledWith(implement.id);
  });

  test("la coordinación se remite a su panel", () => {
    renderSessions({ feature: makeStartedFeature() });
    expect(screen.getByText("en el panel del coordinador")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lanzar sesión" })).not.toBeInTheDocument();
  });
});
