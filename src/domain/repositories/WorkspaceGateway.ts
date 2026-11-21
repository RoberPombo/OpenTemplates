/** Puerto de ciclo de vida de workspaces (proceso opencode + config aislada). */
import type {
  ConfigOutcome,
  CreateWorkspaceInput,
  ServerInfo,
  SkillRef,
  WorktreeStatus,
} from "../../types";

export interface WorkspaceGateway {
  create(input: CreateWorkspaceInput): Promise<ConfigOutcome>;
  update(input: {
    id: string;
    mcpNames: string[];
    skills: SkillRef[];
    model: string | null;
  }): Promise<ConfigOutcome>;
  setDisabled(input: {
    id: string;
    disabledMcps: string[];
    disabledSkills: string[];
  }): Promise<ConfigOutcome>;
  reapplyTemplate(id: string): Promise<ConfigOutcome>;
  delete(
    id: string,
    options?: { removeWorktree?: boolean; force?: boolean; deleteDb?: boolean },
  ): Promise<void>;
  start(id: string): Promise<ServerInfo>;
  stop(id: string): Promise<void>;
  status(): Promise<ServerInfo[]>;
  worktreeStatus(id: string): Promise<WorktreeStatus>;
  log(id: string, lines?: number): Promise<string>;
}
