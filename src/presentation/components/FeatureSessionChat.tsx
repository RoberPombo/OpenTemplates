/**
 * Chat de una sesión de feature (coordinador o paso) sobre un workspace
 * sintético. Vive solo en la UI: no entra en la lista de workspaces ni en la
 * persistencia, pero sí usa sus claves de preferencias y su ámbito de sesiones.
 */
import { useMemo } from "react";
import type { Feature } from "../../domain/features/model";
import type { FeatureRunnerInfo } from "../../domain/features/coordinator";
import type { Workspace } from "../../types";
import { useAppContext } from "../context/AppContext";
import { Chat } from "./Chat";

type Props = {
  feature: Feature;
  runner: FeatureRunnerInfo;
  sessionId: string;
  workspaceId: string;
  name: string;
  directory: string;
  branch: string | null;
  scope: string;
  profileId: string | null;
};

function syntheticWorkspace(
  feature: Feature,
  runner: FeatureRunnerInfo,
  props: Pick<Props, "workspaceId" | "name" | "directory" | "branch" | "profileId">,
): Workspace {
  return {
    id: props.workspaceId,
    name: props.name,
    repoId: feature.root?.repoId ?? null,
    projectPath: props.directory,
    mode: "worktree",
    branch: props.branch,
    worktreePath: props.directory,
    profileId: props.profileId,
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

export function FeatureSessionChat({
  feature,
  runner,
  sessionId,
  workspaceId,
  name,
  directory,
  branch,
  scope,
  profileId,
}: Props) {
  const root = useAppContext();
  const workspace = useMemo(
    () =>
      syntheticWorkspace(feature, runner, {
        workspaceId,
        name,
        directory,
        branch,
        profileId,
      }),
    [feature, runner, workspaceId, name, directory, branch, profileId],
  );
  const client = useMemo(() => root.provideChatGateway(runner.server), [root, runner.server]);

  return (
    <div className="coordinator-chat">
      <Chat client={client} workspace={workspace} scope={scope} initialSessionId={sessionId} />
    </div>
  );
}
