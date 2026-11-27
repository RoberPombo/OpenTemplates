/** Puerto de persistencia de features. */
import type { Feature } from "../features/model";
import type { FeatureArtifact, FeatureRunnerInfo } from "../features/coordinator";
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
  /** Materializa el contexto de la feature y arranca su servidor. */
  startRunner(id: string, profileId: string | null): Promise<FeatureRunnerInfo>;
  /** Arranca el servidor del worktree de un paso y devuelve su contexto. */
  startStepRunner(id: string, stepId: string, profileId: string | null): Promise<FeatureRunnerInfo>;
  /** `null` si el coordinador no tiene servidor vivo. */
  runnerStatus(id: string): Promise<FeatureRunnerInfo | null>;
  stopRunner(id: string): Promise<void>;
}
