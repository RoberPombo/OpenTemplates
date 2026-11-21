use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Skill de la biblioteca global o de un template, con su ruta concreta.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRef {
    pub id: String,
    pub path: String,
}

/// Agente, comando o plugin resuelto a un fichero concreto.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRef {
    pub id: String,
    pub path: String,
    /// `global` o `template`.
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceMode {
    /// Workspace suelto sobre una carpeta, como en la v1.
    #[default]
    Adhoc,
    /// Checkout principal del repo.
    Principal,
    /// Worktree creado por la app.
    Worktree,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueRef {
    pub number: u64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub repo_id: Option<String>,
    /// Carpeta de trabajo (`cwd` del servidor).
    pub project_path: String,
    #[serde(default)]
    pub mode: WorkspaceMode,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
    #[serde(default)]
    pub template_id: Option<String>,
    #[serde(default)]
    pub template_version: Option<u32>,
    #[serde(default)]
    pub issue: Option<IssueRef>,
    #[serde(default)]
    pub mcp_names: Vec<String>,
    #[serde(default)]
    pub skills: Vec<SkillRef>,
    #[serde(default)]
    pub agents: Vec<AssetRef>,
    #[serde(default)]
    pub commands: Vec<AssetRef>,
    #[serde(default)]
    pub plugins: Vec<AssetRef>,
    #[serde(default)]
    pub model: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// Solo en memoria: la carpeta del workspace ya no existe.
    #[serde(skip)]
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub id: String,
    pub name: String,
    /// Ruta canónica del checkout principal (`git rev-parse --show-toplevel`).
    pub path: String,
    #[serde(default)]
    pub remote: Option<String>,
    /// `github`, `gitlab`, `other` o `none`.
    #[serde(default)]
    pub provider: String,
    #[serde(default = "default_main_branch")]
    pub main_branch: String,
    pub created_at: u64,
    pub updated_at: u64,
}

fn default_main_branch() -> String {
    "main".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub agents: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub mcps: Vec<String>,
    #[serde(default)]
    pub commands: Vec<String>,
    #[serde(default)]
    pub plugins: Vec<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub tools: Option<Value>,
    #[serde(default)]
    pub permissions: Vec<Value>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

fn default_version() -> u32 {
    1
}

/// Selección congelada de un template para un workspace concreto.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateLock {
    #[serde(default)]
    pub template_id: Option<String>,
    #[serde(default)]
    pub template_version: Option<u32>,
    #[serde(default)]
    pub frozen_at: u64,
    #[serde(default)]
    pub agents: Vec<AssetRef>,
    #[serde(default)]
    pub commands: Vec<AssetRef>,
    #[serde(default)]
    pub plugins: Vec<AssetRef>,
    #[serde(default)]
    pub skills: Vec<SkillRef>,
    #[serde(default)]
    pub mcps: BTreeMap<String, Value>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub tools: Option<Value>,
    #[serde(default)]
    pub permissions: Vec<Value>,
    /// Contenido del AGENTS.md del template en el momento de congelar.
    #[serde(default)]
    pub agents_md: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub version: u32,
    /// Raíz configurable de worktrees; `None` = `<appdata>/worktrees`.
    #[serde(default)]
    pub worktrees_root: Option<String>,
    #[serde(default)]
    pub default_template_id: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: 2,
            worktrees_root: None,
            default_template_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInfo {
    pub name: String,
    pub config: Value,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String,
}

/// Agente, comando o plugin de la biblioteca global.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub agents: Vec<AssetInfo>,
    pub commands: Vec<AssetInfo>,
    pub plugins: Vec<AssetInfo>,
    pub skills: Vec<SkillInfo>,
    pub mcps: Vec<McpInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub workspace_id: String,
    pub base_url: String,
    pub password: String,
    pub port: u16,
    pub pid: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub workspaces: Vec<Workspace>,
    pub repos: Vec<Repo>,
    pub templates: Vec<TemplateManifest>,
    pub settings: AppSettings,
    pub worktrees_root: String,
    pub running: Vec<ServerInfo>,
    pub data_dir: String,
    pub opencode_bin: Option<String>,
    pub error: Option<String>,
    pub notices: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOutcome {
    pub workspace: Workspace,
    pub config_path: String,
    pub agents_path: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceInput {
    pub name: String,
    #[serde(default)]
    pub repo_id: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub template_id: Option<String>,
    /// `principal`, `worktree` o `adhoc`.
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub base: Option<String>,
    #[serde(default)]
    pub worktree_path: Option<String>,
    #[serde(default)]
    pub use_existing_branch: bool,
    #[serde(default)]
    pub fetch: bool,
    #[serde(default)]
    pub issue: Option<IssueRef>,
    #[serde(default)]
    pub mcp_names: Vec<String>,
    #[serde(default)]
    pub skills: Vec<SkillRef>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    pub exists: bool,
    pub dirty: bool,
    pub branch: Option<String>,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStore {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStore {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub repos: Vec<Repo>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateStore {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub templates: Vec<TemplateManifest>,
}
