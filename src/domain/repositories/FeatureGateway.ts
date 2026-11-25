/** Puerto de persistencia de features. */
import type { Feature } from "../features/model";
import type { FeatureArtifact } from "../features/coordinator";
import type { FeatureProvisionOutcome } from "../features/provision";

export interface FeatureGateway {
  list(): Promise<Feature[]>;
  save(feature: Feature): Promise<Feature>;
  remove(id: string): Promise<void>;
  /** Crea los worktrees que falten; idempotente si ya existen. */
  provision(id: string): Promise<FeatureProvisionOutcome>;
  /** Artefactos compartidos de la feature. */
  artifacts(id: string): Promise<FeatureArtifact[]>;
  writeArtifact(id: string, name: string, content: string): Promise<FeatureArtifact>;
}
