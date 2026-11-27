/**
 * Chat del coordinador: reutiliza el chat de sesión de feature sobre el
 * workspace sintético de la coordinación.
 */
import type { Feature } from "../../domain/features/model";
import {
  coordinatorScope,
  coordinatorWorkspaceId,
  type FeatureRunnerInfo,
} from "../../domain/features/coordinator";
import { FeatureSessionChat } from "./FeatureSessionChat";

type Props = {
  feature: Feature;
  runner: FeatureRunnerInfo;
  sessionId: string;
};

export function CoordinatorChat({ feature, runner, sessionId }: Props) {
  return (
    <FeatureSessionChat
      feature={feature}
      runner={runner}
      sessionId={sessionId}
      workspaceId={coordinatorWorkspaceId(feature.id)}
      name={`${feature.name} · coordinador`}
      directory={runner.directory}
      branch={feature.root?.branch ?? null}
      scope={coordinatorScope()}
      profileId={runner.profileId}
    />
  );
}
