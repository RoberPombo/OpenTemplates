/**
 * Avanzar un paso del grafo: terminar la sesión (`awaiting-review`) o aprobar
 * el gate (`done`). No lanza pasos siguientes: eso lo decide el usuario en la
 * UI cuando el paso queda listo.
 */
import type { Feature } from "../features/model";
import { advanceStep } from "../features/steps";
import type { FeatureGateway } from "../repositories/FeatureGateway";

export type AdvanceStepAction = "finish" | "approve";

export class AdvanceStep {
  private readonly features: FeatureGateway;

  constructor(features: FeatureGateway) {
    this.features = features;
  }

  async execute(
    feature: Feature,
    stepId: string,
    action: AdvanceStepAction,
    now: number = Date.now(),
  ): Promise<Feature> {
    const to = action === "finish" ? "awaiting-review" : "done";
    const result = advanceStep(feature, stepId, to, now);
    if ("error" in result) throw new Error(result.error);
    return this.features.save(result.feature);
  }
}
