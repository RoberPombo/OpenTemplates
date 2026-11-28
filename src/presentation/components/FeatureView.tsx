/** Detalle de una feature: alcance, worktrees y grafo de pasos. */
import type { Feature, FeatureStatus } from "../../domain/features/model";
import { featureProgress } from "../../domain/features/model";
import type { FeatureArtifact, FeatureRunnerInfo } from "../../domain/features/coordinator";
import type { ProfileManifest } from "../../types";
import { CoordinatorPanel } from "./CoordinatorPanel";
import { StepSessions } from "./StepSessions";

type Props = {
  feature: Feature;
  artifacts: FeatureArtifact[];
  profiles: ProfileManifest[];
  defaultProfileId?: string | null;
  runner: FeatureRunnerInfo | null;
  coordinatorBusy: boolean;
  busy: boolean;
  notice: string | null;
  error: string | null;
  stepRunner: FeatureRunnerInfo | null;
  openStepId: string | null;
  stepBusyId: string | null;
  onProvision: () => void;
  onSaveArtifact: (name: string, content: string) => Promise<unknown>;
  onReloadArtifacts: () => Promise<unknown>;
  onLaunchCoordinator: (profileId: string | null) => Promise<unknown>;
  onStopCoordinator: () => Promise<unknown>;
  onApproveDecomposition: (content: string) => Promise<unknown>;
  onLaunchStep: (stepId: string, profileId: string | null) => Promise<unknown>;
  onFinishStep: (stepId: string) => Promise<unknown>;
  onApproveStep: (stepId: string) => Promise<unknown>;
  onCloseStepChat: () => void;
  onDelete: () => void;
  onBack: () => void;
};

const FEATURE_STATUS: Record<FeatureStatus, string> = {
  draft: "Borrador",
  confirmed: "Confirmada",
  running: "En marcha",
  blocked: "Bloqueada",
  done: "Terminada",
  failed: "Fallida",
  cancelled: "Cancelada",
};

const KIND_LABEL: Record<Feature["kind"], string> = {
  feature: "Feature",
  fix: "Fix",
  hotfix: "Hotfix",
  chore: "Chore",
};

export function FeatureView({
  feature,
  artifacts,
  profiles,
  defaultProfileId,
  runner,
  coordinatorBusy,
  busy,
  notice,
  error,
  stepRunner,
  openStepId,
  stepBusyId,
  onProvision,
  onSaveArtifact,
  onReloadArtifacts,
  onLaunchCoordinator,
  onStopCoordinator,
  onApproveDecomposition,
  onLaunchStep,
  onFinishStep,
  onApproveStep,
  onCloseStepChat,
  onDelete,
  onBack,
}: Props) {
  const progress = featureProgress(feature);
  const canProvision = feature.status !== "draft" && feature.status !== "done";

  return (
    <div className="feature-view">
      <header className="feature-head">
        <button className="ghost small" onClick={onBack}>
          ← Workspaces
        </button>
        <div className="feature-title">
          <h2>{feature.name}</h2>
          <div className="feature-badges">
            <span className="feature-badge">{KIND_LABEL[feature.kind]}</span>
            <span className={`feature-badge status-${feature.status}`}>
              {FEATURE_STATUS[feature.status]}
            </span>
            <span className="feature-badge muted">
              flujo {feature.flow === "fast" ? "rápido" : "completo"}
            </span>
          </div>
        </div>
        <div className="row">
          <button className="primary" disabled={busy || !canProvision} onClick={onProvision}>
            {busy ? "Preparando…" : "Preparar worktrees"}
          </button>
          <button className="ghost danger-text" onClick={onDelete}>
            Eliminar
          </button>
        </div>
      </header>

      {notice && <div className="feature-notice">{notice}</div>}
      {error && <div className="inline-error feature-error">{error}</div>}

      <p className="feature-brief-text">{feature.brief || "Sin objetivo escrito."}</p>

      <CoordinatorPanel
        feature={feature}
        artifacts={artifacts}
        profiles={profiles}
        defaultProfileId={defaultProfileId}
        runner={runner}
        coordinatorBusy={coordinatorBusy}
        onSave={onSaveArtifact}
        onReloadArtifacts={onReloadArtifacts}
        onLaunch={onLaunchCoordinator}
        onStop={onStopCoordinator}
        onApprove={onApproveDecomposition}
      />

      <section className="feature-panel">
        <div className="section-head">
          <h3>Repos y worktrees</h3>
          <span className="muted small-text">
            {progress.done}/{progress.total} pasos
          </span>
        </div>
        <ul className="feature-targets">
          {feature.root && (
            <li>
              <span className="feature-target-name">{feature.root.name}</span>
              <span className="feature-target-meta">
                metarepo · rama {feature.root.branch} · base {feature.root.baseBranch}
              </span>
              <code className="feature-path">
                {feature.directory}/{feature.root.relativePath}
              </code>
            </li>
          )}
          {feature.targets.map((target) => (
            <li key={target.id}>
              <span className="feature-target-name">{target.name}</span>
              <span className="feature-target-meta">
                rama {target.branch} · base {target.baseBranch} · scopes{" "}
                {target.scopes.map((scope) => scope.path).join(", ")}
              </span>
              <code className="feature-path">
                {feature.directory}/{target.relativePath}
              </code>
            </li>
          ))}
        </ul>
        {feature.targets.length === 0 && <p className="muted">Sin repos todavía.</p>}
      </section>

      <section className="feature-panel">
        <div className="section-head">
          <h3>Pasos</h3>
          <span className="muted small-text">{feature.directory}</span>
        </div>
        {feature.steps.length === 0 ? (
          <p className="muted">Aún no hay pasos: el flujo se genera al confirmar el alcance.</p>
        ) : (
          <StepSessions
            feature={feature}
            profiles={profiles}
            defaultProfileId={defaultProfileId}
            runner={stepRunner}
            openStepId={openStepId}
            busyStepId={stepBusyId}
            onLaunch={onLaunchStep}
            onFinish={onFinishStep}
            onApprove={onApproveStep}
            onCloseChat={onCloseStepChat}
          />
        )}
      </section>
    </div>
  );
}
