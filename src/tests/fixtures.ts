/**
 * Constructores de datos de prueba compartidos. Evitan que cada test de
 * features repita el mismo borrador con pequeñas variaciones.
 */
import type { CreateFeatureInput, Feature } from "../domain/features/model";
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
