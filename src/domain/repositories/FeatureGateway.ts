/** Puerto de persistencia de features. */
import type { Feature } from "../features/model";
import type { FeatureArtifact, FeatureRunnerInfo } from "../features/coordinator";
import type { FeatureProvisionOutcome } from "../features/provision";
import type { FeatureDeleteOutcome, FeatureDeletePreview } from "../features/deletion";
import type { BootstrapDetection } from "../../types";

export interface FeatureGateway {
  list(): Promise<Feature[]>;
  /** Ficheros ignorados que parecen configuración local; solo rutas y tipo. */
  bootstrapCandidates(repoId: string): Promise<BootstrapDetection>;
  save(feature: Feature): Promise<Feature>;
  /** Plan de borrado sin efectos: worktrees, ramas y protecciones. */
  deletePreview(id: string): Promise<FeatureDeletePreview>;
  /** Limpia worktrees, ramas y carpeta. La feature solo se va si no hay errores. */
  delete(id: string, forceDirty: boolean): Promise<FeatureDeleteOutcome>;
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
