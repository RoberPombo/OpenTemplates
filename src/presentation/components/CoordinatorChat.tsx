/**
 * Chat del coordinador: monta el `Chat` normal sobre una sesión creada por la
 * app. El workspace es sintético: vive solo en la UI y nunca entra en la lista
 * de workspaces ni en la persistencia.
 */
import { useMemo } from "react";
import type { Feature } from "../../domain/features/model";
import {
  coordinatorScope,
  coordinatorWorkspaceId,
  type FeatureRunnerInfo,
} from "../../domain/features/coordinator";
import type { Workspace } from "../../types";
import { useAppContext } from "../context/AppContext";
import { Chat } from "./Chat";

type Props = {
  feature: Feature;
  runner: FeatureRunnerInfo;
  sessionId: string;
};

function syntheticWorkspace(feature: Feature, runner: FeatureRunnerInfo): Workspace {
  return {
    id: coordinatorWorkspaceId(feature.id),
    name: `${feature.name} · coordinador`,
    repoId: feature.root?.repoId ?? null,
    projectPath: runner.directory,
    mode: "worktree",
    branch: feature.root?.branch ?? null,
    worktreePath: runner.directory,
    profileId: runner.profileId,
    issue: feature.issue,
    mcpNames: [],
    disabledMcps: [],
    skills: [],
    disabledSkills: [],
    agents: [],
    commands: [],
    plugins: [],
    model: runner.server.model ?? null,
    models: runner.server.models ?? [],
    contextHash: runner.contextHash,
    createdAt: feature.createdAt,
    updatedAt: feature.updatedAt,
  };
}

export function CoordinatorChat({ feature, runner, sessionId }: Props) {
  const root = useAppContext();
  const workspace = useMemo(() => syntheticWorkspace(feature, runner), [feature, runner]);
  const client = useMemo(() => root.provideChatGateway(runner.server), [root, runner.server]);

  return (
    <div className="coordinator-chat">
      <Chat
        client={client}
        workspace={workspace}
        scope={coordinatorScope()}
        initialSessionId={sessionId}
        sessionsOpen={false}
      />
    </div>
  );
}
