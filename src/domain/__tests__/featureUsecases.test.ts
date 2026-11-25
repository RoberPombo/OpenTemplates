// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import type { CreateFeatureInput, Feature } from "../features/model";
import { createFeatureDraft } from "../features/model";
import type { FeatureProvisionOutcome } from "../features/provision";
import type { FeatureGateway } from "../repositories/FeatureGateway";
import { DeleteFeature } from "../usecases/DeleteFeature";
import { ProvisionFeature } from "../usecases/ProvisionFeature";
import { SaveFeature } from "../usecases/SaveFeature";
import { StartFeature } from "../usecases/StartFeature";

function draft(overrides: Partial<CreateFeatureInput> = {}): Feature {
  const result = createFeatureDraft({
    id: "feat-1",
    name: "Checkout con Stripe",
    kind: "feature",
    brief: "Añadir el checkout",
    directory: "/data/features/feat-1",
    targets: [{ repoId: "repo-a", name: "Web", repoPath: "/repos/web" }],
    now: 1000,
    ...overrides,
  });
  if ("error" in result) throw new Error(result.error);
  return result.feature;
}

function fakeGateway(overrides: Partial<FeatureGateway> = {}): FeatureGateway {
  return {
    list: vi.fn(async () => []),
    save: vi.fn(async (feature: Feature) => feature),
    remove: vi.fn(async () => undefined),
    provision: vi.fn(async (): Promise<FeatureProvisionOutcome> => ({
      feature: draft(),
      worktrees: [],
      warnings: [],
      errors: [],
      applied: [],
      blocked: false,
    })),
    ...overrides,
  };
}

describe("StartFeature", () => {
  test("confirma, expande y guarda", async () => {
    const gateway = fakeGateway();
    const feature = await new StartFeature(gateway).execute(draft(), 2000);

    expect(feature.status).toBe("confirmed");
    expect(feature.steps).toHaveLength(6);
    expect(gateway.save).toHaveBeenCalledWith(feature);
  });

  test("no guarda si falta el brief", async () => {
    const gateway = fakeGateway();
    await expect(new StartFeature(gateway).execute(draft({ brief: " " }))).rejects.toThrow(
      "Describe la feature antes de confirmarla.",
    );
    expect(gateway.save).not.toHaveBeenCalled();
  });
});

describe("SaveFeature", () => {
  test("delega en el gateway", async () => {
    const feature = draft();
    const gateway = fakeGateway({
      save: vi.fn(async (): Promise<Feature> => ({ ...feature, status: "running" })),
    });
    const saved = await new SaveFeature(gateway).execute(feature);
    expect(saved.status).toBe("running");
    expect(gateway.save).toHaveBeenCalledWith(feature);
  });
});

describe("DeleteFeature", () => {
  test("borra por id", async () => {
    const gateway = fakeGateway();
    await new DeleteFeature(gateway).execute("feat-1");
    expect(gateway.remove).toHaveBeenCalledWith("feat-1");
  });
});

describe("ProvisionFeature", () => {
  test("pide materializar y devuelve el resultado", async () => {
    const outcome: FeatureProvisionOutcome = {
      feature: draft(),
      worktrees: [
        {
          role: "root",
          repoPath: "/repos/main",
          path: "/data/features/feat-1/main",
          branch: "feature/checkout-con-stripe",
          base: "origin/develop",
        },
      ],
      warnings: ["aviso"],
      errors: [],
      applied: [".env listo"],
      blocked: false,
    };
    const gateway = fakeGateway({ provision: vi.fn(async () => outcome) });

    const result = await new ProvisionFeature(gateway).execute("feat-1");

    expect(result).toBe(outcome);
    expect(gateway.provision).toHaveBeenCalledWith("feat-1");
  });
});
