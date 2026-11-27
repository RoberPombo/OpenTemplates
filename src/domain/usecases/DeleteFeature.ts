/**
 * Borrado completo de una feature: preview para confirmar y limpieza real.
 * Las protecciones (rama base, publicada, en uso) las revalida Rust; la UI solo
 * decide si el usuario aceptó perder los cambios sin commitear.
 */
import type { FeatureDeleteOutcome, FeatureDeletePreview } from "../features/deletion";
import type { FeatureGateway } from "../repositories/FeatureGateway";

export class DeleteFeature {
  private readonly features: FeatureGateway;

  constructor(features: FeatureGateway) {
    this.features = features;
  }

  preview(id: string): Promise<FeatureDeletePreview> {
    return this.features.deletePreview(id);
  }

  execute(id: string, forceDirty: boolean): Promise<FeatureDeleteOutcome> {
    return this.features.delete(id, forceDirty);
  }
}
