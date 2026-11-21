export type SkillRef = {
  id: string;
  path: string;
};

export type AssetRef = {
  id: string;
  path: string;
  source: string;
};

export type WorkspaceMode = "adhoc" | "principal" | "worktree";

export type IssueRef = {
  number: number;
  title: string;
  url?: string | null;
};

export type Workspace = {
  id: string;
  name: string;
  repoId?: string | null;
  projectPath: string;
  mode: WorkspaceMode;
  branch?: string | null;
  worktreePath?: string | null;
  templateId?: string | null;
  templateVersion?: number | null;
  issue?: IssueRef | null;
  mcpNames: string[];
  disabledMcps: string[];
  skills: SkillRef[];
  disabledSkills: string[];
  agents: AssetRef[];
  commands: AssetRef[];
  plugins: AssetRef[];
  model?: string | null;
  models: string[];
  createdAt: number;
  updatedAt: number;
  missing?: boolean;
};

export type Repo = {
  id: string;
  name: string;
  path: string;
  remote?: string | null;
  provider: string;
  mainBranch: string;
  createdAt: number;
  updatedAt: number;
};

export type TemplateManifest = {
  id: string;
  name: string;
  description: string;
  version: number;
  agents: string[];
  skills: string[];
  mcps: string[];
  commands: string[];
  plugins: string[];
  models: string[];
  model?: string | null;
  tools?: unknown;
  permissions: unknown[];
  createdAt: number;
  updatedAt: number;
};

export type McpInfo = {
  name: string;
  config: Record<string, unknown>;
  source: string;
};

export type SkillInfo = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: string;
};

export type AssetInfo = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: string;
};

export type Library = {
  agents: AssetInfo[];
  commands: AssetInfo[];
  plugins: AssetInfo[];
  skills: SkillInfo[];
  mcps: McpInfo[];
};

export type AppSettings = {
  version: number;
  worktreesRoot?: string | null;
  defaultTemplateId?: string | null;
};

export type ServerInfo = {
  workspaceId: string;
  baseUrl: string;
  password: string;
  port: number;
  pid: number;
};

export type WorktreeStatus = {
  exists: boolean;
  dirty: boolean;
  branch?: string | null;
  path: string;
};

export type ProcessUsage = {
  pid: number;
  memoryBytes: number;
  cpuPercent: number;
};

export type SystemUsage = {
  cores: number;
  cpuPercent: number;
  memoryTotalBytes: number;
  memoryUsedBytes: number;
};

export type ResourceUsage = {
  app: ProcessUsage | null;
  workspace: ProcessUsage | null;
  system: SystemUsage;
};

export type Bootstrap = {
  workspaces: Workspace[];
  repos: Repo[];
  templates: TemplateManifest[];
  settings: AppSettings;
  worktreesRoot: string;
  running: ServerInfo[];
  dataDir: string;
  opencodeBin: string | null;
  error: string | null;
  notices: string[];
};

export type ConfigOutcome = {
  workspace: Workspace;
  configPath: string;
  agentsPath: string;
  warnings: string[];
};

export type CreateWorkspaceInput = {
  name: string;
  repoId?: string | null;
  projectPath?: string | null;
  templateId?: string | null;
  mode?: WorkspaceMode;
  branch?: string | null;
  base?: string | null;
  worktreePath?: string | null;
  useExistingBranch?: boolean;
  fetch?: boolean;
  issue?: IssueRef | null;
  mcpNames?: string[];
  skills?: SkillRef[];
  model?: string | null;
};
