/**
 * Arrancar una feature: valida el alcance, expande el flujo y guarda.
 * La materialización de worktrees es del adaptador (Rust), no de este caso de uso.
 */
import type { Feature } from "../features/model";
import { startFeature } from "../features/flow";
import type { FeatureGateway } from "../repositories/FeatureGateway";

export class StartFeature {
  private readonly features: FeatureGateway;

  constructor(features: FeatureGateway) {
    this.features = features;
  }

  async execute(feature: Feature, now: number = Date.now()): Promise<Feature> {
    const result = startFeature(feature, now);
    if ("error" in result) throw new Error(result.error);
    return this.features.save(result.feature);
  }
}
