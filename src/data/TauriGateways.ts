/**
 * Adaptadores Tauri de los puertos del dominio. Delegan en el mapa de comandos
 * `tauriCommands.ts` (invoke) y normalizan los errores de transporte a Error planos.
 */
import { api } from "./tauriCommands";
import { errorText } from "../domain/shared/errors";
import type { ModelDetails } from "../domain/models/details";
import type { BootstrapGateway, SettingsGateway } from "../domain/repositories/SettingsGateway";
import type { LibraryGateway } from "../domain/repositories/LibraryGateway";
import type { ModelCatalogGateway } from "../domain/repositories/ModelCatalogGateway";
import type { RepoGateway } from "../domain/repositories/RepoGateway";
import type { GitGateway } from "../domain/repositories/GitGateway";
import type { PullRequestGateway } from "../domain/repositories/PullRequestGateway";
import type { PreviewGateway } from "../domain/repositories/PreviewGateway";
import type { PreviewProbe } from "../domain/preview/preview";
import type { GitCommit, GitCommitResult, GitPushResult, GitStatus } from "../domain/workspace/git";
import { buildGitStatus } from "../domain/workspace/git";
import type { GhStatus, PullRequestCheck, PullRequestInfo } from "../domain/workspace/pullRequest";
import type { ResourcesGateway } from "../domain/repositories/ResourcesGateway";
import type { ProfileGateway } from "../domain/repositories/ProfileGateway";
import type { WorkspaceGateway } from "../domain/repositories/WorkspaceGateway";
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
  ProfileManifest,
  WorktreeStatus,
} from "../types";

async function call<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    throw new Error(errorText(error), { cause: error });
  }
}

export class TauriBootstrapGateway implements BootstrapGateway {
  bootstrap(): Promise<Bootstrap> {
    return call(api.bootstrap());
  }
}

export class TauriWorkspaceGateway implements WorkspaceGateway {
  create(input: CreateWorkspaceInput): Promise<ConfigOutcome> {
    return call(api.createWorkspace(input));
  }

  update(input: {
    id: string;
    mcpNames: string[];
    skills: SkillRef[];
    model: string | null;
  }): Promise<ConfigOutcome> {
    return call(api.updateWorkspace(input));
  }

  setDisabled(input: {
    id: string;
    disabledMcps: string[];
    disabledSkills: string[];
  }): Promise<ConfigOutcome> {
    return call(api.setWorkspaceDisabled(input));
  }

  reapplyProfile(id: string): Promise<ConfigOutcome> {
    return call(api.reapplyProfile(id));
  }

  delete(
    id: string,
    options?: { removeWorktree?: boolean; force?: boolean; deleteDb?: boolean },
  ): Promise<void> {
    return call(api.deleteWorkspace(id, options));
  }

  start(id: string): Promise<ServerInfo> {
    return call(api.startWorkspace(id));
  }

  stop(id: string): Promise<void> {
    return call(api.stopWorkspace(id));
  }

  status(): Promise<ServerInfo[]> {
    return call(api.workspaceStatus());
  }

  worktreeStatus(id: string): Promise<WorktreeStatus> {
    return call(api.worktreeStatus(id));
  }

  log(id: string, lines = 200): Promise<string> {
    return call(api.workspaceLog(id, lines));
  }
}

export class TauriRepoGateway implements RepoGateway {
  list(): Promise<Repo[]> {
    return call(api.listRepos());
  }

  add(path: string): Promise<Repo> {
    return call(api.addRepo(path));
  }

  refresh(id: string): Promise<Repo> {
    return call(api.refreshRepo(id));
  }

  remove(id: string): Promise<void> {
    return call(api.removeRepo(id));
  }
}

export class TauriGitGateway implements GitGateway {
  async status(projectPath: string): Promise<GitStatus> {
    return buildGitStatus(await call(api.gitStatus(projectPath)));
  }

  async stage(projectPath: string, paths: string[]): Promise<GitStatus> {
    return buildGitStatus(await call(api.gitStage(projectPath, paths)));
  }

  async unstage(projectPath: string, paths: string[]): Promise<GitStatus> {
    return buildGitStatus(await call(api.gitUnstage(projectPath, paths)));
  }

  stagedDiff(projectPath: string): Promise<string> {
    return call(api.gitDiff(projectPath, true));
  }

  commit(projectPath: string, message: string): Promise<GitCommitResult> {
    return call(api.gitCommit(projectPath, message));
  }

  push(
    projectPath: string,
    input: { branch: string; setUpstream: boolean; remote?: string },
  ): Promise<GitPushResult> {
    return call(api.gitPush(projectPath, input.branch, input.setUpstream));
  }

  commits(projectPath: string, base: string, limit?: number): Promise<GitCommit[]> {
    return call(api.gitCommits(projectPath, base, limit));
  }
}

export class TauriPullRequestGateway implements PullRequestGateway {
  status(): Promise<GhStatus> {
    return call(api.ghStatus());
  }

  view(projectPath: string): Promise<PullRequestInfo | null> {
    return call(api.ghPrView(projectPath));
  }

  checks(projectPath: string): Promise<PullRequestCheck[]> {
    return call(api.ghPrChecks(projectPath));
  }

  async create(
    projectPath: string,
    input: { base: string; head: string; title: string; body: string },
  ): Promise<{ url: string }> {
    return { url: await call(api.ghPrCreate({ projectPath, ...input })) };
  }
}

export class TauriProfileGateway implements ProfileGateway {
  list(): Promise<ProfileManifest[]> {
    return call(api.listProfiles());
  }

  save(manifest: ProfileManifest): Promise<ProfileManifest> {
    return call(api.saveProfile(manifest));
  }

  delete(id: string): Promise<void> {
    return call(api.deleteProfile(id));
  }

  agentsMd(id: string): Promise<string> {
    return call(api.profileAgentsMd(id));
  }

  saveAgentsMd(id: string, content: string): Promise<string> {
    return call(api.saveProfileAgentsMd(id, content));
  }
}

export class TauriModelCatalogGateway implements ModelCatalogGateway {
  list(): Promise<ModelDetails[]> {
    return call(api.listAvailableModels());
  }
}

export class TauriSettingsGateway implements SettingsGateway {
  get(): Promise<AppSettings> {
    return call(api.getSettings());
  }

  save(settings: AppSettings): Promise<AppSettings> {
    return call(api.saveSettings(settings));
  }
}

export class TauriLibraryGateway implements LibraryGateway {
  library(): Promise<Library> {
    return call(api.listLibrary());
  }

  mcps(): Promise<McpInfo[]> {
    return call(api.listMcps());
  }

  skills(projectPath?: string | null): Promise<SkillInfo[]> {
    return call(api.listSkills(projectPath));
  }
}

export class TauriResourcesGateway implements ResourcesGateway {
  usage(pid?: number | null): Promise<ResourceUsage> {
    return call(api.resources(pid));
  }
}

/** El sondeo de red no se convierte en error: el resultado ya describe el fallo. */
export class TauriPreviewGateway implements PreviewGateway {
  probe(url: string): Promise<PreviewProbe> {
    return call(api.previewProbe(url));
  }

  openExternal(url: string): Promise<void> {
    return call(api.openExternal(url));
  }
}
