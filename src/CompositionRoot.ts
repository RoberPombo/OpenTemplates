/**
 * Composition Root: único punto de cableado de dependencias.
 * Los puertos se sobrescriben por constructor (tests) o se instancian con los
 * adaptadores reales. El singleton solo se usa en el alta del grafo (main/AppProvider).
 */
import {
  TauriBootstrapGateway,
  TauriLibraryGateway,
  TauriModelCatalogGateway,
  TauriRepoGateway,
  TauriResourcesGateway,
  TauriSettingsGateway,
  TauriTemplateGateway,
  TauriWorkspaceGateway,
} from "./data/TauriGateways";
import { LocalStoragePreferences } from "./data/LocalStoragePreferences";
import { WindowConfirmDialog } from "./data/WindowConfirmDialog";
import { TauriFolderPicker } from "./data/TauriFolderPicker";
import { TauriUpdateGateway } from "./data/TauriUpdateGateway";
import { TauriNotificationGateway } from "./data/TauriNotificationGateway";
import { TauriSessionFiles } from "./data/TauriSessionFiles";
import { createChatGateway } from "./data/OpencodeChatGateway";
import { DeleteWorkspace } from "./domain/usecases/DeleteWorkspace";
import { CreateWorkspace } from "./domain/usecases/CreateWorkspace";
import { ApplyWorkspaceSettings } from "./domain/usecases/ApplyWorkspaceSettings";
import { CheckForUpdate } from "./domain/usecases/CheckForUpdate";
import { InstallUpdate } from "./domain/usecases/InstallUpdate";
import type { BootstrapGateway, SettingsGateway } from "./domain/repositories/SettingsGateway";
import type { ChatGateway, ChatServer } from "./domain/repositories/ChatGateway";
import type { ConfirmDialog, FolderPicker } from "./domain/repositories/Dialogs";
import type { LibraryGateway } from "./domain/repositories/LibraryGateway";
import type { ModelCatalogGateway } from "./domain/repositories/ModelCatalogGateway";
import type { NotificationGateway } from "./domain/repositories/NotificationGateway";
import type { Preferences } from "./domain/repositories/Preferences";
import type { RepoGateway } from "./domain/repositories/RepoGateway";
import type { ResourcesGateway } from "./domain/repositories/ResourcesGateway";
import type { SessionFiles } from "./domain/repositories/SessionFiles";
import type { TemplateGateway } from "./domain/repositories/TemplateGateway";
import type { UpdateGateway } from "./domain/repositories/UpdateGateway";
import type { WorkspaceGateway } from "./domain/repositories/WorkspaceGateway";
import type { ServerInfo } from "./types";

export type Ports = {
  bootstrap: BootstrapGateway;
  workspaces: WorkspaceGateway;
  repos: RepoGateway;
  templates: TemplateGateway;
  settings: SettingsGateway;
  library: LibraryGateway;
  modelCatalog: ModelCatalogGateway;
  resources: ResourcesGateway;
  preferences: Preferences;
  confirm: ConfirmDialog;
  folderPicker: FolderPicker;
  updates: UpdateGateway;
  notifications: NotificationGateway;
  sessionFiles: SessionFiles;
};

export class CompositionRoot {
  private static instance: CompositionRoot | null = null;

  readonly bootstrap: BootstrapGateway;
  readonly workspaces: WorkspaceGateway;
  readonly repos: RepoGateway;
  readonly templates: TemplateGateway;
  readonly settings: SettingsGateway;
  readonly library: LibraryGateway;
  readonly modelCatalog: ModelCatalogGateway;
  readonly resources: ResourcesGateway;
  readonly preferences: Preferences;
  readonly confirm: ConfirmDialog;
  readonly folderPicker: FolderPicker;
  readonly updates: UpdateGateway;
  readonly notifications: NotificationGateway;
  readonly sessionFiles: SessionFiles;

  constructor(overrides: Partial<Ports> = {}) {
    this.bootstrap = overrides.bootstrap ?? new TauriBootstrapGateway();
    this.workspaces = overrides.workspaces ?? new TauriWorkspaceGateway();
    this.repos = overrides.repos ?? new TauriRepoGateway();
    this.templates = overrides.templates ?? new TauriTemplateGateway();
    this.settings = overrides.settings ?? new TauriSettingsGateway();
    this.library = overrides.library ?? new TauriLibraryGateway();
    this.modelCatalog = overrides.modelCatalog ?? new TauriModelCatalogGateway();
    this.resources = overrides.resources ?? new TauriResourcesGateway();
    this.preferences = overrides.preferences ?? new LocalStoragePreferences();
    this.confirm = overrides.confirm ?? new WindowConfirmDialog();
    this.folderPicker = overrides.folderPicker ?? new TauriFolderPicker();
    this.updates = overrides.updates ?? new TauriUpdateGateway();
    this.notifications = overrides.notifications ?? new TauriNotificationGateway();
    this.sessionFiles = overrides.sessionFiles ?? new TauriSessionFiles();
  }

  static getInstance(): CompositionRoot {
    if (!CompositionRoot.instance) {
      CompositionRoot.instance = new CompositionRoot();
    }
    return CompositionRoot.instance;
  }

  provideDeleteWorkspace(): DeleteWorkspace {
    return new DeleteWorkspace(this.workspaces, this.confirm);
  }

  provideCreateWorkspace(): CreateWorkspace {
    return new CreateWorkspace(this.workspaces);
  }

  provideApplyWorkspaceSettings(server: ChatGateway | null): ApplyWorkspaceSettings {
    return new ApplyWorkspaceSettings(this.workspaces, server);
  }

  provideCheckForUpdate(): CheckForUpdate {
    return new CheckForUpdate(this.updates);
  }

  provideInstallUpdate(): InstallUpdate {
    return new InstallUpdate(this.updates);
  }

  provideChatGateway(server: ServerInfo): ChatServer {
    return createChatGateway(server);
  }
}
