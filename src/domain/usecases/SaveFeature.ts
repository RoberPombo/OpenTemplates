/** Guardar una feature tal cual (cambios de estado, pasos, sesión…). */
import type { Feature } from "../features/model";
import type { FeatureGateway } from "../repositories/FeatureGateway";

export class SaveFeature {
  private readonly features: FeatureGateway;

  constructor(features: FeatureGateway) {
    this.features = features;
  }

  async execute(feature: Feature): Promise<Feature> {
    return this.features.save(feature);
  }
}
