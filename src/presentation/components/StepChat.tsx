/**
 * Chat de la sesión de un paso. Usa el worktree que devuelve el runner y un
 * ámbito propio para no mezclar historial con el coordinador ni con otros pasos.
 */
import type { Feature, FeatureStep } from "../../domain/features/model";
import type { FeatureRunnerInfo } from "../../domain/features/coordinator";
import { stepScopeKey, stepSessionTitle, stepWorkspaceId } from "../../domain/features/steps";
import { FeatureSessionChat } from "./FeatureSessionChat";

type Props = {
  feature: Feature;
  step: FeatureStep;
  runner: FeatureRunnerInfo;
  sessionId: string;
};

export function StepChat({ feature, step, runner, sessionId }: Props) {
  const target = feature.targets.find((item) => item.id === step.targetId);
  return (
    <FeatureSessionChat
      feature={feature}
      runner={runner}
      sessionId={sessionId}
      workspaceId={stepWorkspaceId(feature.id, step.id)}
      name={`${feature.name} · ${stepSessionTitle(feature, step)}`}
      directory={runner.directory}
      branch={target?.branch ?? feature.root?.branch ?? null}
      scope={stepScopeKey(step)}
      profileId={runner.profileId}
    />
  );
}
