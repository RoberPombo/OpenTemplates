import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  Bootstrap,
  ConfigOutcome,
  CreateWorkspaceInput,
  Library,
  McpInfo,
  Repo,
  ServerInfo,
  SkillInfo,
  SkillRef,
  TemplateManifest,
  WorktreeStatus,
} from "./types";

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

  listTemplates: () => invoke<TemplateManifest[]>("list_templates"),
  saveTemplate: (manifest: TemplateManifest) =>
    invoke<TemplateManifest>("save_template", { manifest }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),
  templateAgentsMd: (id: string) =>
    invoke<string>("template_agents_md", { id }),
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
  reapplyTemplate: (id: string) =>
    invoke<ConfigOutcome>("reapply_template", { id }),
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
  worktreeStatus: (id: string) =>
    invoke<WorktreeStatus>("worktree_status", { id }),
  workspaceLog: (id: string, lines = 200) =>
    invoke<string>("workspace_log", { id, lines }),

  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) =>
    invoke<AppSettings>("save_settings", { settings }),
};
