import { describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import { useFeatures } from "../useFeatures";
import type { FeatureGateway } from "../../../domain/repositories/FeatureGateway";
import type { FeatureProvisionOutcome } from "../../../domain/features/provision";
import type { Feature } from "../../../domain/features/model";
import { makeFeature, makeRunner, makeStartedFeature } from "../../../tests/fixtures";

function fakeGateway(overrides: Partial<FeatureGateway> = {}): FeatureGateway {
  return {
    list: vi.fn(async () => [makeFeature()]),
    save: vi.fn(async (feature) => feature),
    remove: vi.fn(async () => undefined),
    provision: vi.fn(async (): Promise<FeatureProvisionOutcome> => ({
      feature: makeStartedFeature(),
      worktrees: [],
      warnings: [],
      errors: [],
      applied: [],
      blocked: false,
    })),
    artifacts: vi.fn(async () => []),
    writeArtifact: vi.fn(async (_id, name, content) => ({ name, content })),
    startRunner: vi.fn(async (id, profileId) => makeRunner(id, { profileId })),
    runnerStatus: vi.fn(async () => null),
    stopRunner: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Feature arrancada con sesión de coordinación ya creada: el hook no abre chat. */
function startedWithCoordinatorSession(overrides: Parameters<typeof makeFeature>[0] = {}): Feature {
  const started = makeStartedFeature(overrides);
  return {
    ...started,
    steps: started.steps.map((step) =>
      step.type === "coordinate" ? { ...step, sessionId: "ses-coord" } : step,
    ),
  };
}

const DECOMPOSITION_WITH_TARGETS = `\`\`\`feature-decomposition
{
  "requestTargets": [{ "name": "Back", "repoPath": "/repos/back", "scopes": ["api"] }],
  "proposeSteps": [{ "targetId": "target-web", "scopes": ["src"] }]
}
\`\`\``;

const DECOMPOSITION_WITHOUT_TARGETS = `\`\`\`feature-decomposition
{ "requestTargets": [], "proposeSteps": [] }
\`\`\``;

function setup(gateway: FeatureGateway = fakeGateway()) {
  const root = new CompositionRoot({
    features: gateway,
    confirm: { confirm: () => true },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProvider root={root}>{children}</AppProvider>
  );
  return { root, gateway, ...renderHook(() => useFeatures(), { wrapper }) };
}

describe("useFeatures", () => {
  test("carga la lista al montar", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.features).toHaveLength(1));
    expect(result.current.features[0]?.id).toBe("feat-1");
    expect(result.current.selected).toBeNull();
  });

  test("start guarda, inserta y selecciona la feature", async () => {
    const gateway = fakeGateway();
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));
    const draft = makeFeature({ id: "feat-2", name: "Otra" });
    await act(async () => {
      await result.current.start(draft);
    });
    expect(gateway.save).toHaveBeenCalledWith(expect.objectContaining({ id: "feat-2" }));
    expect(result.current.selectedId).toBe("feat-2");
    expect(result.current.features.map((item) => item.id)).toEqual(["feat-1", "feat-2"]);
  });

  test("provision actualiza la feature, recarga artefactos y avisa de los worktrees", async () => {
    const outcome: FeatureProvisionOutcome = {
      feature: makeStartedFeature({ id: "feat-1" }),
      worktrees: [],
      warnings: ["aviso"],
      errors: [],
      applied: [],
      blocked: false,
    };
    const gateway = fakeGateway({ provision: vi.fn(async () => outcome) });
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));
    await act(async () => {
      await result.current.provision("feat-1");
    });
    expect(gateway.provision).toHaveBeenCalledWith("feat-1");
    expect(gateway.artifacts).toHaveBeenCalledWith("feat-1");
    expect(result.current.notice).toBe("Worktrees listos · 1 aviso(s).");
    expect(result.current.busyId).toBeNull();
    expect(result.current.features[0]?.status).not.toBe("draft");
  });

  test("provision bloqueada expone los errores y no anuncia éxito", async () => {
    const gateway = fakeGateway({
      provision: vi.fn(async () => ({
        feature: makeStartedFeature(),
        worktrees: [],
        warnings: [],
        errors: ["bootstrap roto"],
        applied: [],
        blocked: true,
      })),
    });
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));
    await act(async () => {
      await result.current.provision("feat-1");
    });
    expect(result.current.error).toBe("bootstrap roto");
    expect(result.current.notice).toBeNull();
  });

  test("sin confirmación no borra la feature", async () => {
    const gateway = fakeGateway();
    const root = new CompositionRoot({ features: gateway, confirm: { confirm: () => false } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppProvider root={root}>{children}</AppProvider>
    );
    const { result } = renderHook(() => useFeatures(), { wrapper });
    await waitFor(() => expect(result.current.features).toHaveLength(1));
    await act(async () => {
      await result.current.remove("feat-1");
    });
    expect(gateway.remove).not.toHaveBeenCalled();
    expect(result.current.features).toHaveLength(1);
  });

  test("aprobar con targets nuevos guarda el artefacto, provisiona y actualiza", async () => {
    const started = makeStartedFeature();
    let saved = started;
    const gateway = fakeGateway({
      list: vi.fn(async () => [started]),
      save: vi.fn(async (feature: Feature) => {
        saved = feature;
        return feature;
      }),
      provision: vi.fn(async (): Promise<FeatureProvisionOutcome> => ({
        feature: saved,
        worktrees: [],
        warnings: [],
        errors: [],
        applied: [],
        blocked: false,
      })),
    });
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));

    await act(async () => {
      await result.current.approveDecomposition(started.id, DECOMPOSITION_WITH_TARGETS);
    });

    expect(gateway.writeArtifact).toHaveBeenCalledWith(
      started.id,
      "DECOMPOSITION.md",
      DECOMPOSITION_WITH_TARGETS,
    );
    expect(gateway.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: started.id,
        targets: expect.arrayContaining([expect.objectContaining({ name: "Back" })]),
      }),
    );
    expect(gateway.provision).toHaveBeenCalledWith(started.id);
    expect(gateway.artifacts).toHaveBeenCalledWith(started.id);
    expect(result.current.features[0]?.targets.map((target) => target.name)).toContain("Back");
    expect(result.current.notice).toBe("Descomposición aprobada · 1 target(s) nuevos.");
    expect(result.current.error).toBeNull();
  });

  test("aprobar sin targets nuevos no provisiona y refresca los pasos", async () => {
    const started = makeStartedFeature();
    const gateway = fakeGateway({ list: vi.fn(async () => [started]) });
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));

    await act(async () => {
      await result.current.approveDecomposition(started.id, DECOMPOSITION_WITHOUT_TARGETS);
    });

    expect(gateway.provision).not.toHaveBeenCalled();
    expect(gateway.save).toHaveBeenCalledWith(expect.objectContaining({ id: started.id }));
    expect(result.current.features[0]?.status).toBe("running");
    expect(
      result.current.features[0]?.steps.find((step) => step.type === "coordinate")?.status,
    ).toBe("done");
    expect(result.current.notice).toBe("Descomposición aprobada y pasos refrescados.");
    expect(result.current.error).toBeNull();
  });

  test("una descomposición inválida expone el error y no guarda", async () => {
    const started = makeStartedFeature();
    const gateway = fakeGateway({ list: vi.fn(async () => [started]) });
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));

    await act(async () => {
      await expect(
        result.current.approveDecomposition(started.id, "# sin bloque de propuesta"),
      ).rejects.toThrow("feature-decomposition");
    });

    expect(gateway.save).not.toHaveBeenCalled();
    expect(result.current.error).toContain("feature-decomposition");
    expect(result.current.notice).toBeNull();
  });

  test("si falla la recarga de artefactos, la aprobación sigue adelante", async () => {
    const started = makeStartedFeature();
    const gateway = fakeGateway({
      list: vi.fn(async () => [started]),
      artifacts: vi.fn(async () => {
        throw new Error("disco no disponible");
      }),
    });
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));

    await act(async () => {
      await result.current.approveDecomposition(started.id, DECOMPOSITION_WITHOUT_TARGETS);
    });

    expect(gateway.save).toHaveBeenCalled();
    expect(result.current.artifacts).toEqual([]);
    expect(result.current.notice).toBe("Descomposición aprobada y pasos refrescados.");
  });

  test("aprobar o lanzar una feature que no está en la lista falla sin tocar el gateway", async () => {
    const gateway = fakeGateway();
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));

    await act(async () => {
      await expect(result.current.approveDecomposition("feat-x", "")).rejects.toThrow(
        "La feature no existe.",
      );
      await expect(result.current.launchCoordinator("feat-x", null)).rejects.toThrow(
        "La feature no existe.",
      );
    });

    expect(gateway.save).not.toHaveBeenCalled();
    expect(gateway.startRunner).not.toHaveBeenCalled();
  });

  test("reloadArtifacts recarga los artefactos de la feature seleccionada", async () => {
    const started = makeStartedFeature();
    const gateway = fakeGateway({
      list: vi.fn(async () => [started]),
      artifacts: vi.fn(async () => [{ name: "BRIEF.md", content: "brief" }]),
    });
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));

    await act(async () => {
      result.current.select(started.id);
    });
    await act(async () => {
      await result.current.reloadArtifacts();
    });

    expect(gateway.artifacts).toHaveBeenCalledWith(started.id);
    expect(result.current.artifacts).toEqual([{ name: "BRIEF.md", content: "brief" }]);
  });

  test("lanzar el coordinador expone los avisos y conserva la selección", async () => {
    const feature = startedWithCoordinatorSession();
    const runner = makeRunner(feature.id, { warnings: ["falta el perfil del coordinador"] });
    const gateway = fakeGateway({
      list: vi.fn(async () => [feature]),
      startRunner: vi.fn(async () => runner),
      runnerStatus: vi.fn(async () => runner),
    });
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));

    await act(async () => {
      result.current.select(feature.id);
    });
    await act(async () => {
      await result.current.launchCoordinator(feature.id, "coord");
    });

    expect(gateway.startRunner).toHaveBeenCalledWith(feature.id, "coord");
    expect(result.current.coordinator).toEqual(runner);
    expect(result.current.notice).toBe("Coordinador listo · 1 aviso(s).");
    expect(result.current.error).toBeNull();
    expect(result.current.selectedId).toBe(feature.id);
    expect(result.current.coordinatorBusy).toBe(false);
  });

  test("si el coordinador falla, expone el error y no pierde la selección", async () => {
    const feature = startedWithCoordinatorSession();
    const gateway = fakeGateway({
      list: vi.fn(async () => [feature]),
      startRunner: vi.fn(async () => {
        throw new Error("no se pudo arrancar el servidor");
      }),
    });
    const { result } = setup(gateway);
    await waitFor(() => expect(result.current.features).toHaveLength(1));

    await act(async () => {
      result.current.select(feature.id);
    });
    await act(async () => {
      await expect(result.current.launchCoordinator(feature.id, "coord")).rejects.toThrow(
        "no se pudo arrancar el servidor",
      );
    });

    expect(result.current.error).toBe("no se pudo arrancar el servidor");
    expect(result.current.notice).toBeNull();
    expect(result.current.coordinator).toBeNull();
    expect(result.current.coordinatorBusy).toBe(false);
    expect(result.current.selectedId).toBe(feature.id);
  });
});
