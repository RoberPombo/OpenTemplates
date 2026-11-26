/**
 * Constructores de datos de prueba compartidos. Evitan que cada test de
 * features repita el mismo borrador con pequeñas variaciones.
 */
import type { CreateFeatureInput, Feature } from "../domain/features/model";
import type { FeatureRunnerInfo } from "../domain/features/coordinator";
import { createFeatureDraft } from "../domain/features/model";
import { startFeature } from "../domain/features/flow";

export function makeFeatureInput(overrides: Partial<CreateFeatureInput> = {}): CreateFeatureInput {
  return {
    id: "feat-1",
    name: "Checkout con Stripe",
    kind: "feature",
    brief: "Añadir el checkout con Stripe",
    directory: "/data/features/feat-1",
    targets: [{ repoId: "repo-a", name: "Web", repoPath: "/repos/web" }],
    now: 1000,
    ...overrides,
  };
}

export function makeFeature(overrides: Partial<CreateFeatureInput> = {}): Feature {
  const result = createFeatureDraft(makeFeatureInput(overrides));
  if ("error" in result) throw new Error(result.error);
  return result.feature;
}

export function makeStartedFeature(
  overrides: Partial<CreateFeatureInput> = {},
  now = 2000,
): Feature {
  const result = startFeature(makeFeature(overrides), now);
  if ("error" in result) throw new Error(result.error);
  return result.feature;
}

/** Runner de coordinador con servidor local ficticio; sin red. */
export function makeRunner(
  featureId = "feat-1",
  overrides: Partial<FeatureRunnerInfo> = {},
): FeatureRunnerInfo {
  return {
    featureId,
    profileId: "coord",
    directory: `/data/features/${featureId}/web`,
    contextHash: "hash",
    server: {
      workspaceId: featureId,
      baseUrl: "http://127.0.0.1:4100",
      password: "pw",
      port: 4100,
      pid: 10,
    },
    warnings: [],
    ...overrides,
  };
}
