import { invoke } from "@tauri-apps/api/core";
import type { ModelDetails } from "../domain/models/details";
import type {
  GitCommit,
  GitCommitResult,
  GitPushResult,
  GitStatusRaw,
} from "../domain/workspace/git";
import type { GhStatus, PullRequestCheck, PullRequestInfo } from "../domain/workspace/pullRequest";
import type {
  AppSettings,
  Bootstrap,
  ConfigOutcome,
  CreateWorkspaceInput,
  Library,
  McpInfo,
  Repo,
  ResourceUsage,
  ServerInfo,
  SkillInfo,
  SkillRef,
  TemplateManifest,
  WorktreeStatus,
} from "../types";

export const api = {
  bootstrap: () => invoke<Bootstrap>("bootstrap"),
  listLibrary: () => invoke<Library>("list_library"),
  listMcps: () => invoke<McpInfo[]>("list_mcps"),
  listSkills: (projectPath?: string | null) =>
    invoke<SkillInfo[]>("list_skills", { projectPath: projectPath ?? null }),

  listRepos: () => invoke<Repo[]>("list_repos"),
  addRepo: (path: string) => invoke<Repo>("add_repo", { path }),
  refreshRepo: (id: string) => invoke<Repo>("refresh_repo", { id }),
  removeRepo: (id: string) => invoke<void>("remove_repo", { id }),

  listAvailableModels: () => invoke<ModelDetails[]>("list_available_models"),
  listTemplates: () => invoke<TemplateManifest[]>("list_templates"),
  saveTemplate: (manifest: TemplateManifest) =>
    invoke<TemplateManifest>("save_template", { manifest }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),
  templateAgentsMd: (id: string) => invoke<string>("template_agents_md", { id }),
  saveTemplateAgentsMd: (id: string, content: string) =>
    invoke<string>("save_template_agents_md", { id, content }),

  createWorkspace: (input: CreateWorkspaceInput) =>
    invoke<ConfigOutcome>("create_workspace", { input }),
  updateWorkspace: (input: {
    id: string;
    mcpNames: string[];
    skills: SkillRef[];
    model: string | null;
  }) => invoke<ConfigOutcome>("update_workspace", input),
  setWorkspaceDisabled: (input: { id: string; disabledMcps: string[]; disabledSkills: string[] }) =>
    invoke<ConfigOutcome>("set_workspace_disabled", input),
  reapplyTemplate: (id: string) => invoke<ConfigOutcome>("reapply_template", { id }),
  deleteWorkspace: (
    id: string,
    options?: { removeWorktree?: boolean; force?: boolean; deleteDb?: boolean },
  ) =>
    invoke<void>("delete_workspace", {
      id,
      removeWorktree: options?.removeWorktree,
      force: options?.force,
      deleteDb: options?.deleteDb,
    }),
  startWorkspace: (id: string) => invoke<ServerInfo>("start_workspace", { id }),
  stopWorkspace: (id: string) => invoke<void>("stop_workspace", { id }),
  workspaceStatus: () => invoke<ServerInfo[]>("workspace_status"),
  worktreeStatus: (id: string) => invoke<WorktreeStatus>("worktree_status", { id }),
  workspaceLog: (id: string, lines = 200) => invoke<string>("workspace_log", { id, lines }),
  resources: (pid?: number | null) => invoke<ResourceUsage>("resources", { pid: pid ?? null }),

  gitStatus: (projectPath: string) => invoke<GitStatusRaw>("git_status", { projectPath }),
  gitStage: (projectPath: string, paths: string[]) =>
    invoke<GitStatusRaw>("git_stage", { projectPath, paths }),
  gitUnstage: (projectPath: string, paths: string[]) =>
    invoke<GitStatusRaw>("git_unstage", { projectPath, paths }),
  gitDiff: (projectPath: string, staged: boolean) =>
    invoke<string>("git_diff", { projectPath, staged }),
  gitCommit: (projectPath: string, message: string) =>
    invoke<GitCommitResult>("git_commit", { projectPath, message }),
  gitPush: (projectPath: string, branch: string, setUpstream: boolean) =>
    invoke<GitPushResult>("git_push", { projectPath, branch, setUpstream }),
  gitCommits: (projectPath: string, base: string, limit?: number) =>
    invoke<GitCommit[]>("git_commits", { projectPath, base, limit: limit ?? null }),

  ghStatus: () => invoke<GhStatus>("gh_status"),
  ghPrView: (projectPath: string) => invoke<PullRequestInfo | null>("gh_pr_view", { projectPath }),
  ghPrChecks: (projectPath: string) => invoke<PullRequestCheck[]>("gh_pr_checks", { projectPath }),
  ghPrCreate: (input: {
    projectPath: string;
    base: string;
    head: string;
    title: string;
    body: string;
  }) => invoke<string>("gh_pr_create", { input }),

  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>("save_settings", { settings }),

  /** Escribe texto en una ruta elegida por el diálogo; `false` si ya existía. */
  writeTextFile: (path: string, contents: string, overwrite: boolean) =>
    invoke<boolean>("write_text_file", { path, contents, overwrite }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
};
