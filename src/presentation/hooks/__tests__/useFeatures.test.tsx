import { describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import { useFeatures } from "../useFeatures";
import type { FeatureGateway } from "../../../domain/repositories/FeatureGateway";
import type { FeatureProvisionOutcome } from "../../../domain/features/provision";
import { makeFeature, makeStartedFeature } from "../../../tests/fixtures";

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
    startRunner: vi.fn(),
    runnerStatus: vi.fn(async () => null),
    stopRunner: vi.fn(async () => undefined),
    ...overrides,
  };
}

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
});
