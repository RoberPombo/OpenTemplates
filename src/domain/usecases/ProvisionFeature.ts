/**
 * Materializar una feature: worktrees del metarepo y de cada subrepo.
 * El dominio ya decidió rutas y ramas; aquí solo se pide al adaptador.
 */
import type { FeatureProvisionOutcome } from "../features/provision";
import type { FeatureGateway } from "../repositories/FeatureGateway";

export class ProvisionFeature {
  private readonly features: FeatureGateway;

  constructor(features: FeatureGateway) {
    this.features = features;
  }

  async execute(featureId: string): Promise<FeatureProvisionOutcome> {
    return this.features.provision(featureId);
  }
}
