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
    #[serde(default, alias = "templateId")]
    pub profile_id: Option<String>,
    #[serde(default, alias = "templateVersion")]
    pub profile_version: Option<u32>,
    #[serde(default)]
    pub issue: Option<IssueRef>,
    #[serde(default)]
    pub mcp_names: Vec<String>,
    /// MCPs seleccionados que no se cargan en el servidor (fuera del contexto).
    #[serde(default)]
    pub disabled_mcps: Vec<String>,
    #[serde(default)]
    pub skills: Vec<SkillRef>,
    /// Skills seleccionadas que no se cargan en el servidor (fuera del contexto).
    #[serde(default)]
    pub disabled_skills: Vec<String>,
    #[serde(default)]
    pub agents: Vec<AssetRef>,
    #[serde(default)]
    pub commands: Vec<AssetRef>,
    #[serde(default)]
    pub plugins: Vec<AssetRef>,
    #[serde(default)]
    pub model: Option<String>,
    /// Modelos que ofrece el selector del chat (congelados del template).
    #[serde(default)]
    pub models: Vec<String>,
    /// Huella del contexto materializado que usa el workspace. `None` hasta que
    /// se materializa por primera vez (workspaces migrados desde el modelo anterior).
    #[serde(default)]
    pub context_hash: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// Solo en memoria: la carpeta del workspace ya no existe.
    #[serde(skip)]
    pub missing: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapEntry {
    pub path: String,
    /// `auto`, `copy`, `link` o `clone`.
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub required: bool,
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
    /// Ficheros/dirs ignorados que se traen al worktree de una feature.
    #[serde(default)]
    pub bootstrap: Vec<BootstrapEntry>,
    pub created_at: u64,
    pub updated_at: u64,
}

fn default_main_branch() -> String {
    "main".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileManifest {
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
    /// Modelos que aparecen en el selector del chat, en el orden dado.
    #[serde(default)]
    pub models: Vec<String>,
    /// Modelo por defecto; se aplica a los agentes sin modelo asignado.
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileLock {
    #[serde(default, alias = "templateId")]
    pub profile_id: Option<String>,
    #[serde(default, alias = "templateVersion")]
    pub profile_version: Option<u32>,
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
    pub models: Vec<String>,
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
    #[serde(default, alias = "defaultTemplateId")]
    pub default_profile_id: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: 2,
            worktrees_root: None,
            default_profile_id: None,
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
    /// Huella del contexto que sirve este proceso.
    #[serde(default)]
    pub context_hash: String,
    pub base_url: String,
    pub password: String,
    pub port: u16,
    pub pid: u32,
    /// Modelo por defecto del contexto; la sesión lo recibe al crearse.
    #[serde(default)]
    pub model: Option<String>,
    /// Modelos que ofrece el perfil de este contexto.
    #[serde(default)]
    pub models: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub workspaces: Vec<Workspace>,
    pub repos: Vec<Repo>,
    pub profiles: Vec<ProfileManifest>,
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
    #[serde(default, alias = "templateId")]
    pub profile_id: Option<String>,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCost {
    #[serde(default)]
    pub input: Option<f64>,
    #[serde(default)]
    pub output: Option<f64>,
    #[serde(default)]
    pub cache_read: Option<f64>,
    #[serde(default)]
    pub cache_write: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLimit {
    #[serde(default)]
    pub context: Option<u64>,
    #[serde(default)]
    pub input: Option<u64>,
    #[serde(default)]
    pub output: Option<u64>,
}

/// Ficha de un modelo accesible: lo que expone el CLI de opencode cruzado con
/// el catálogo de models.dev que opencode mantiene en caché.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDetail {
    pub key: String,
    pub provider_id: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub reasoning: Option<bool>,
    #[serde(default)]
    pub tools: Option<bool>,
    #[serde(default)]
    pub attachment: Option<bool>,
    #[serde(default)]
    pub temperature: Option<bool>,
    #[serde(default)]
    pub input_modalities: Vec<String>,
    #[serde(default)]
    pub output_modalities: Vec<String>,
    #[serde(default)]
    pub cost: Option<ModelCost>,
    #[serde(default)]
    pub limit: Option<ModelLimit>,
    #[serde(default)]
    pub knowledge: Option<String>,
    #[serde(default)]
    pub release_date: Option<String>,
    #[serde(default)]
    pub last_updated: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub open_weights: Option<bool>,
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
pub struct ProfileStore {
    #[serde(default)]
    pub version: u32,
    #[serde(default, alias = "templates")]
    pub profiles: Vec<ProfileManifest>,
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureScope {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureRoot {
    #[serde(default)]
    pub repo_id: Option<String>,
    pub name: String,
    pub repo_path: String,
    pub base_branch: String,
    pub branch: String,
    pub relative_path: String,
    #[serde(default)]
    pub bootstrap: Vec<BootstrapEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureTarget {
    pub id: String,
    #[serde(default)]
    pub repo_id: Option<String>,
    pub name: String,
    pub repo_path: String,
    pub base_branch: String,
    pub branch: String,
    pub relative_path: String,
    #[serde(default)]
    pub scopes: Vec<FeatureScope>,
    #[serde(default)]
    pub bootstrap: Vec<BootstrapEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureStep {
    pub id: String,
    #[serde(rename = "type")]
    pub step_type: String,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub scope_id: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    pub status: String,
    #[serde(default)]
    pub session_id: Option<String>,
}

/// Feature persistida. El dominio y la expansión de flujos viven en el frontend;
/// Rust solo guarda y materializa worktrees.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub flow: String,
    pub status: String,
    #[serde(default)]
    pub brief: String,
    #[serde(default)]
    pub issue: Option<IssueRef>,
    pub directory: String,
    #[serde(default)]
    pub root: Option<FeatureRoot>,
    #[serde(default)]
    pub targets: Vec<FeatureTarget>,
    #[serde(default)]
    pub steps: Vec<FeatureStep>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureStore {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub features: Vec<Feature>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureArtifact {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionedWorktree {    /// `root` o `target`.
    pub role: String,
    pub repo_path: String,
    pub path: String,
    pub branch: String,
    pub base: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureProvisionOutcome {
    pub feature: Feature,
    pub worktrees: Vec<ProvisionedWorktree>,
    pub warnings: Vec<String>,
    /// Fallos de bootstrap obligatorio; si hay alguno, `blocked` es `true`.
    #[serde(default)]
    pub errors: Vec<String>,
    /// Entradas de bootstrap aplicadas (para mostrar progreso).
    #[serde(default)]
    pub applied: Vec<String>,
    pub blocked: bool,
}

/// Líneas de un fichero no rastreado, calculadas por Rust al leerlo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUntrackedStat {
    pub path: String,
    pub additions: u64,
    pub binary: bool,
}

/// Salida cruda de `git status` y su contexto. El frontend parsea el
/// porcelain y el numstat en `domain/workspace/git.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusOutput {
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub upstream: Option<String>,
    #[serde(default)]
    pub ahead_behind: Option<String>,
    #[serde(default)]
    pub remote: Option<String>,
    pub main_branch: String,
    pub porcelain: String,
    pub numstat: String,
    #[serde(default)]
    pub untracked_stats: Vec<GitUntrackedStat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub oid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub branch: String,
    pub remote: String,
    #[serde(default)]
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub hash: String,
    pub subject: String,
    #[serde(default)]
    pub body: String,
}

/// Estado de GitHub CLI para tarjeta y acciones de pull request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhStatus {
    pub installed: bool,
    pub authenticated: bool,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    pub docs_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReview {
    #[serde(default)]
    pub author: String,
    pub state: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub submitted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestComment {
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestInfo {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
    #[serde(default)]
    pub is_draft: bool,
    pub base_branch: String,
    pub head_branch: String,
    #[serde(default)]
    pub review_decision: Option<String>,
    #[serde(default)]
    pub reviews: Vec<PullRequestReview>,
    #[serde(default)]
    pub comments: Vec<PullRequestComment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCheck {
    pub name: String,
    pub state: String,
    /// `passed`, `failed`, `pending` o `skipped`.
    pub bucket: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub workflow: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePullRequestInput {
    pub project_path: String,
    pub base: String,
    pub head: String,
    pub title: String,
    pub body: String,
}
