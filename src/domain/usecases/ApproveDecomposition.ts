/**
 * Aprobar la descomposición del coordinador: valida el bloque propuesto,
 * refresca el grafo de pasos y provisiona los worktrees de los targets nuevos.
 * La app ejecuta; el coordinador solo propone.
 */
import type { Feature } from "../features/model";
import { applyDecomposition, parseDecomposition } from "../features/decomposition";
import { DECOMPOSITION_FILE } from "../features/coordinator";
import type { FeatureGateway } from "../repositories/FeatureGateway";

export type DecompositionApproval = {
  feature: Feature;
  addedTargets: number;
  warnings: string[];
};

export class ApproveDecomposition {
  private readonly features: FeatureGateway;

  constructor(features: FeatureGateway) {
    this.features = features;
  }

  async execute(feature: Feature, content: string, now: number = Date.now()) {
    const parsed = parseDecomposition(content);
    if ("error" in parsed) throw new Error(parsed.error);
    const applied = applyDecomposition(feature, parsed.proposal, now);
    if ("error" in applied) throw new Error(applied.error);

    // El documento aprobado queda como artefacto compartido, no solo en el hilo.
    await this.features.writeArtifact(feature.id, DECOMPOSITION_FILE, content);
    let saved = await this.features.save(applied.feature);
    let warnings: string[] = [];
    if (applied.addedTargetIds.length > 0) {
      const outcome = await this.features.provision(saved.id);
      saved = outcome.feature;
      warnings = [...outcome.errors, ...outcome.warnings];
    }
    return {
      feature: saved,
      addedTargets: applied.addedTargetIds.length,
      warnings,
    } satisfies DecompositionApproval;
  }
}
