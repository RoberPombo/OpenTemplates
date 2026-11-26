/** Borrar una feature del store (los worktrees los limpia el adaptador). */
import type { FeatureGateway } from "../repositories/FeatureGateway";

export class DeleteFeature {
  private readonly features: FeatureGateway;

  constructor(features: FeatureGateway) {
    this.features = features;
  }

  async execute(id: string): Promise<void> {
    await this.features.remove(id);
  }
}
