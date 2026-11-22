/**
 * Adaptadores Tauri de los puertos del dominio. Delegan en el mapa de comandos
 * `tauriCommands.ts` (invoke) y normalizan los errores de transporte a Error planos.
 */
import { api } from "./tauriCommands";
import { errorText } from "../domain/shared/errors";
import type { BootstrapGateway, SettingsGateway } from "../domain/repositories/SettingsGateway";
import type { LibraryGateway } from "../domain/repositories/LibraryGateway";
import type { ModelCatalogGateway } from "../domain/repositories/ModelCatalogGateway";
import type { RepoGateway } from "../domain/repositories/RepoGateway";
import type { ResourcesGateway } from "../domain/repositories/ResourcesGateway";
import type { TemplateGateway } from "../domain/repositories/TemplateGateway";
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
  TemplateManifest,
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

  reapplyTemplate(id: string): Promise<ConfigOutcome> {
    return call(api.reapplyTemplate(id));
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

export class TauriTemplateGateway implements TemplateGateway {
  list(): Promise<TemplateManifest[]> {
    return call(api.listTemplates());
  }

  save(manifest: TemplateManifest): Promise<TemplateManifest> {
    return call(api.saveTemplate(manifest));
  }

  delete(id: string): Promise<void> {
    return call(api.deleteTemplate(id));
  }

  agentsMd(id: string): Promise<string> {
    return call(api.templateAgentsMd(id));
  }

  saveAgentsMd(id: string, content: string): Promise<string> {
    return call(api.saveTemplateAgentsMd(id, content));
  }
}

export class TauriModelCatalogGateway implements ModelCatalogGateway {
  list(): Promise<string[]> {
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
