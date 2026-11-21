use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::config;
use crate::git;
use crate::library;
use crate::model::{
    AppSettings, Bootstrap, ConfigOutcome, CreateWorkspaceInput, Library, McpInfo, Repo,
    ServerInfo, SkillInfo, SkillRef, TemplateManifest, Workspace, WorkspaceMode, WorktreeStatus,
};
use crate::server::{self, ServerHandle};
use crate::state::{AppState, ensure_workspace_dir, expand_tilde};
use crate::templates;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn find_opencode_bin() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("OPENCODE_BIN") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Ok(path) = which::which("opencode") {
        return Some(path);
    }
    let fallback = dirs::home_dir()?.join(".local/bin/opencode");
    fallback.is_file().then_some(fallback)
}

fn info_of(workspace_id: &str, handle: &mut ServerHandle) -> Option<ServerInfo> {
    Some(ServerInfo {
        workspace_id: workspace_id.to_string(),
        base_url: format!("http://127.0.0.1:{}", handle.port),
        password: handle.password.clone(),
        port: handle.port,
        pid: handle.child.id().unwrap_or(0),
    })
}

fn repo_of(state: &AppState, id: &str) -> Result<Repo, String> {
    state
        .repos
        .lock()
        .map_err(|_| "estado bloqueado".to_string())?
        .iter()
        .find(|repo| repo.id == id)
        .cloned()
        .ok_or_else(|| format!("El repositorio '{id}' no existe"))
}

fn repo_from_path(path: &Path) -> Result<Repo, String> {
    let toplevel = git::toplevel(path)?;
    let remote = git::remote_url(&toplevel);
    let name = toplevel
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| toplevel.to_string_lossy().to_string());
    let now = now_ms();
    Ok(Repo {
        id: uuid::Uuid::new_v4().simple().to_string(),
        name,
        path: toplevel.to_string_lossy().to_string(),
        provider: git::provider(remote.as_deref()),
        remote,
        main_branch: git::main_branch(&toplevel),
        created_at: now,
        updated_at: now,
    })
}

fn materialize_workspace(
    workspace: &Workspace,
    workspace_dir: &Path,
) -> Result<config::Materialized, String> {
    let (global, error) = config::read_global_config();
    let global_dir = config::global_config_dir();
    let mut materialized = config::materialize(config::MaterializeInput {
        workspace,
        workspace_dir,
        global_dir: &global_dir,
        global_config: &global,
    })?;
    if let Some(error) = error {
        materialized.warnings.push(error);
    }
    Ok(materialized)
}

fn outcome(workspace: Workspace, materialized: config::Materialized) -> ConfigOutcome {
    ConfigOutcome {
        workspace,
        config_path: materialized.config_path.to_string_lossy().to_string(),
        agents_path: materialized.agents_path.to_string_lossy().to_string(),
        warnings: materialized.warnings,
    }
}

fn conflicts(workspaces: &[Workspace], candidate: &Workspace) -> Vec<String> {
    let mut warnings = Vec::new();
    for other in workspaces {
        if other.id == candidate.id {
            continue;
        }
        if other.project_path == candidate.project_path {
            warnings.push(format!(
                "Ya hay un workspace «{}» sobre esta misma carpeta. Para trabajar en paralelo, crea un worktree.",
                other.name
            ));
            continue;
        }
        let same_repo = candidate.repo_id.is_some() && other.repo_id == candidate.repo_id;
        if same_repo
            && candidate.mode == WorkspaceMode::Principal
            && other.mode == WorkspaceMode::Principal
        {
            warnings.push(format!(
                "Ya hay un workspace «{}» sobre el checkout principal de este repositorio. Dos procesos sobre la misma carpeta comparten ficheros y estado git; usa un worktree.",
                other.name
            ));
        }
    }
    warnings
}

#[tauri::command]
pub fn bootstrap(state: State<'_, AppState>) -> Bootstrap {
    let mut running = Vec::new();
    if let Ok(mut servers) = state.servers.lock() {
        let dead: Vec<String> = servers
            .iter_mut()
            .filter_map(|(id, handle)| (!server::is_alive(handle)).then(|| id.clone()))
            .collect();
        for id in dead {
            servers.remove(&id);
        }
        for (id, handle) in servers.iter_mut() {
            if let Some(info) = info_of(id, handle) {
                running.push(info);
            }
        }
    }

    let mut workspaces = state
        .workspaces
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default();
    for workspace in &mut workspaces {
        workspace.missing = !Path::new(&workspace.project_path).is_dir();
    }
    let repos = state
        .repos
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default();
    let mut templates = state
        .templates
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default();
    templates.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let settings = state
        .settings
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default();
    let worktrees_root = state.worktrees_root().to_string_lossy().to_string();
    let notices = state
        .notices
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default();
    let bin = find_opencode_bin();

    Bootstrap {
        workspaces,
        repos,
        templates,
        settings,
        worktrees_root,
        running,
        data_dir: state.data_dir.to_string_lossy().to_string(),
        opencode_bin: bin.as_ref().map(|p| p.to_string_lossy().to_string()),
        error: bin
            .is_none()
            .then(|| "No se encontró el binario de opencode. Define OPENCODE_BIN.".to_string()),
        notices,
    }
}

#[tauri::command]
pub fn list_library() -> Library {
    library::scan()
}

#[tauri::command]
pub fn list_mcps() -> Vec<McpInfo> {
    config::list_mcps()
}

#[tauri::command]
pub fn list_skills(project_path: Option<String>) -> Vec<SkillInfo> {
    library::list_skills(project_path.as_deref())
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_repos(state: State<'_, AppState>) -> Vec<Repo> {
    state
        .repos
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn add_repo(state: State<'_, AppState>, path: String) -> Result<Repo, String> {
    let repo = repo_from_path(&expand_tilde(path.trim()))?;
    {
        let repos = state.repos.lock().map_err(|_| "estado bloqueado")?;
        if let Some(existing) = repos.iter().find(|item| item.path == repo.path) {
            return Err(format!(
                "Esa carpeta ya está añadida como repositorio «{}».",
                existing.name
            ));
        }
    }
    state
        .repos
        .lock()
        .map_err(|_| "estado bloqueado")?
        .push(repo.clone());
    state.save()?;
    Ok(repo)
}

#[tauri::command]
pub fn refresh_repo(state: State<'_, AppState>, id: String) -> Result<Repo, String> {
    let mut repos = state.repos.lock().map_err(|_| "estado bloqueado")?;
    let index = repos
        .iter()
        .position(|repo| repo.id == id)
        .ok_or_else(|| format!("El repositorio '{id}' no existe"))?;
    let path = PathBuf::from(&repos[index].path);
    let remote = git::remote_url(&path);
    repos[index].remote = remote.clone();
    repos[index].provider = git::provider(remote.as_deref());
    repos[index].main_branch = git::main_branch(&path);
    repos[index].updated_at = now_ms();
    let repo = repos[index].clone();
    drop(repos);
    state.save()?;
    Ok(repo)
}

#[tauri::command]
pub fn remove_repo(state: State<'_, AppState>, id: String) -> Result<(), String> {
    {
        let workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        let count = workspaces
            .iter()
            .filter(|workspace| workspace.repo_id.as_deref() == Some(id.as_str()))
            .count();
        if count > 0 {
            return Err(format!(
                "No se puede quitar el repositorio: tiene {count} workspace(s). Elimínalos primero."
            ));
        }
    }
    {
        let mut repos = state.repos.lock().map_err(|_| "estado bloqueado")?;
        let before = repos.len();
        repos.retain(|repo| repo.id != id);
        if repos.len() == before {
            return Err(format!("El repositorio '{id}' no existe"));
        }
    }
    state.save()
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

fn normalize_template_id(raw: &str) -> Result<String, String> {
    let id = raw.trim();
    if id.is_empty() || id == "." || id == ".." {
        return Err("El template necesita un identificador".into());
    }
    if !id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
        || id.contains("..")
    {
        return Err(
            "El identificador del template solo admite letras, números, guiones, guiones bajos y puntos"
                .into(),
        );
    }
    Ok(id.to_string())
}

#[tauri::command]
pub fn list_templates(state: State<'_, AppState>) -> Vec<TemplateManifest> {
    let mut items = state
        .templates
        .lock()
        .map(|templates| templates.clone())
        .unwrap_or_default();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    items
}

#[tauri::command]
pub fn save_template(
    state: State<'_, AppState>,
    manifest: TemplateManifest,
) -> Result<TemplateManifest, String> {
    let mut manifest = manifest;
    manifest.id = normalize_template_id(&manifest.id)?;
    manifest.name = manifest.name.trim().to_string();
    if manifest.name.is_empty() {
        return Err("El template necesita un nombre".into());
    }
    manifest.version = manifest.version.max(1);
    let root = state.templates_root();
    let existing = templates::read_manifest(&root, &manifest.id);
    manifest.created_at = existing
        .as_ref()
        .map(|item| item.created_at)
        .unwrap_or_else(now_ms);
    manifest.updated_at = now_ms();
    templates::save_manifest(&root, &manifest)?;

    {
        let mut stored = state.templates.lock().map_err(|_| "estado bloqueado")?;
        match stored.iter_mut().find(|item| item.id == manifest.id) {
            Some(item) => *item = manifest.clone(),
            None => stored.push(manifest.clone()),
        }
        stored.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    }
    state.save()?;
    Ok(manifest)
}

#[tauri::command]
pub fn delete_template(state: State<'_, AppState>, id: String) -> Result<(), String> {
    templates::remove_template_dir(&state.templates_root(), &id)?;
    {
        let mut stored = state.templates.lock().map_err(|_| "estado bloqueado")?;
        stored.retain(|item| item.id != id);
    }
    state.save()
}

#[tauri::command]
pub fn template_agents_md(state: State<'_, AppState>, id: String) -> String {
    templates::read_agents_md(&state.templates_root(), &id)
}

#[tauri::command]
pub fn save_template_agents_md(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<String, String> {
    templates::write_agents_md(&state.templates_root(), &id, &content)?;
    Ok(content)
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_workspace(
    state: State<'_, AppState>,
    input: CreateWorkspaceInput,
) -> Result<ConfigOutcome, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("El nombre del workspace no puede estar vacío".into());
    }
    let mode = match input.mode.as_deref().unwrap_or("adhoc") {
        "principal" => WorkspaceMode::Principal,
        "worktree" => WorkspaceMode::Worktree,
        "adhoc" | "" => WorkspaceMode::Adhoc,
        other => return Err(format!("Modo de workspace desconocido: '{other}'")),
    };

    let repo = match input.repo_id.as_deref().filter(|id| !id.is_empty()) {
        Some(id) => Some(repo_of(&state, id)?),
        None => None,
    };
    if mode != WorkspaceMode::Adhoc && repo.is_none() {
        return Err("Elige un repositorio para este workspace".into());
    }

    let mut warnings: Vec<String> = Vec::new();
    let templates_root = state.templates_root();
    let manifest = match input.template_id.as_deref().filter(|id| !id.is_empty()) {
        Some(id) => Some(
            state
                .templates
                .lock()
                .map_err(|_| "estado bloqueado")?
                .iter()
                .find(|template| template.id == id)
                .cloned()
                .ok_or_else(|| format!("El template '{id}' no existe"))?,
        ),
        None => None,
    };

    let mut branch = input
        .branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let mut worktree_path: Option<PathBuf> = None;
    let project_path: PathBuf;

    match mode {
        WorkspaceMode::Principal => {
            let repo = repo.as_ref().expect("repo validado");
            project_path = PathBuf::from(&repo.path);
            branch = branch.or_else(|| git::current_branch(&project_path));
        }
        WorkspaceMode::Worktree => {
            let repo = repo.as_ref().expect("repo validado");
            let slug = git::slugify(&name);
            let default_branch = match &input.issue {
                Some(issue) => format!("{}-{}", issue.number, slug),
                None => slug.clone(),
            };
            let branch_name = branch.clone().unwrap_or(default_branch);
            let worktrees_root = state.worktrees_root();
            let default_path = worktrees_root.join(git::slugify(&repo.name)).join(&slug);
            let path = match input
                .worktree_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                Some(raw) => {
                    let raw = expand_tilde(raw);
                    if raw.is_absolute() {
                        raw
                    } else {
                        worktrees_root.join(raw)
                    }
                }
                None => default_path,
            };
            if path.exists() {
                return Err(format!(
                    "La ruta '{}' ya existe. Elige otra para el worktree.",
                    path.display()
                ));
            }
            if input.fetch {
                git::fetch(&PathBuf::from(&repo.path))?;
            }
            let branch_exists = git::local_branch_exists(&PathBuf::from(&repo.path), &branch_name);
            if input.use_existing_branch {
                if !branch_exists {
                    return Err(format!("La rama '{branch_name}' no existe en el repo."));
                }
            } else if branch_exists {
                return Err(format!(
                    "La rama '{branch_name}' ya existe. Cambia el nombre del workspace o marca «usar la rama existente»."
                ));
            }
            let repo_path = PathBuf::from(&repo.path);
            let base = match input
                .base
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                Some(base) => base.to_string(),
                None => {
                    if git::remote_url(&repo_path).is_some()
                        && git::remote_branch_exists(&repo_path, &repo.main_branch)
                    {
                        format!("origin/{}", repo.main_branch)
                    } else {
                        repo.main_branch.clone()
                    }
                }
            };
            git::worktree_add(
                &repo_path,
                &path,
                &branch_name,
                &base,
                input.use_existing_branch,
            )?;
            warnings.push(format!(
                "Worktree creado en {} (rama '{branch_name}', base '{base}').",
                path.display()
            ));
            worktree_path = Some(path.clone());
            project_path = path;
            branch = Some(branch_name);
        }
        WorkspaceMode::Adhoc => {
            let raw = input
                .project_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or("Elige la carpeta del proyecto")?;
            let project = fs::canonicalize(expand_tilde(raw))
                .map_err(|e| format!("No se pudo abrir '{raw}': {e}"))?;
            if !project.is_dir() {
                return Err(format!("'{}' no es una carpeta", project.display()));
            }
            project_path = project;
        }
    }

    let id = uuid::Uuid::new_v4().simple().to_string();
    let now = now_ms();
    let mut workspace = Workspace {
        id: id.clone(),
        name,
        repo_id: repo.as_ref().map(|repo| repo.id.clone()),
        project_path: project_path.to_string_lossy().to_string(),
        mode,
        branch,
        worktree_path: worktree_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        template_id: manifest.as_ref().map(|manifest| manifest.id.clone()),
        template_version: None,
        issue: input.issue.clone(),
        mcp_names: input.mcp_names.clone(),
        disabled_mcps: Vec::new(),
        skills: input.skills.clone(),
        disabled_skills: Vec::new(),
        agents: Vec::new(),
        commands: Vec::new(),
        plugins: Vec::new(),
        model: input.model.clone().filter(|model| !model.trim().is_empty()),
        created_at: now,
        updated_at: now,
        missing: false,
    };

    let workspace_dir = ensure_workspace_dir(&state.data_dir, &id);
    let lock = if let Some(manifest) = &manifest {
        match templates::freeze(manifest, &templates_root) {
            Ok((lock, freeze_warnings)) => {
                warnings.extend(freeze_warnings);
                workspace.template_version = Some(manifest.version);
                workspace.mcp_names = manifest.mcps.clone();
                workspace.skills = lock.skills.clone();
                workspace.agents = lock.agents.clone();
                workspace.commands = lock.commands.clone();
                workspace.plugins = lock.plugins.clone();
                workspace.model = lock.model.clone();
                Some(lock)
            }
            Err(err) => {
                rollback_worktree(&repo, &worktree_path);
                return Err(err);
            }
        }
    } else {
        None
    };
    if let Some(lock) = &lock
        && let Err(err) = templates::write_lock(&workspace_dir, lock)
    {
        rollback_worktree(&repo, &worktree_path);
        return Err(err);
    }

    {
        let workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        warnings.extend(conflicts(&workspaces, &workspace));
    }

    let materialized = match materialize_workspace(&workspace, &workspace_dir) {
        Ok(materialized) => materialized,
        Err(err) => {
            rollback_worktree(&repo, &worktree_path);
            return Err(err);
        }
    };
    let mut outcome = outcome(workspace.clone(), materialized);
    warnings.append(&mut outcome.warnings);
    outcome.warnings = warnings;

    state
        .workspaces
        .lock()
        .map_err(|_| "estado bloqueado")?
        .push(workspace);
    state.save()?;

    Ok(outcome)
}

fn rollback_worktree(repo: &Option<Repo>, worktree_path: &Option<PathBuf>) {
    if let (Some(repo), Some(path)) = (repo, worktree_path) {
        let _ = git::worktree_remove(&PathBuf::from(&repo.path), path, true);
        git::worktree_prune(&PathBuf::from(&repo.path));
    }
}

#[tauri::command]
pub fn update_workspace(
    state: State<'_, AppState>,
    id: String,
    mcp_names: Vec<String>,
    skills: Vec<SkillRef>,
    model: Option<String>,
) -> Result<ConfigOutcome, String> {
    let workspace = {
        let mut workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        let workspace = workspaces
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or_else(|| format!("Workspace '{id}' no existe"))?;
        workspace.mcp_names = mcp_names;
        workspace.skills = skills;
        workspace.model = model.filter(|m| !m.trim().is_empty());
        workspace
            .disabled_mcps
            .retain(|name| workspace.mcp_names.contains(name));
        workspace
            .disabled_skills
            .retain(|id| workspace.skills.iter().any(|skill| &skill.id == id));
        workspace.updated_at = now_ms();
        workspace.clone()
    };

    let workspace_dir = ensure_workspace_dir(&state.data_dir, &id);
    let mut warnings = Vec::new();

    // El lock congela la definición de los MCPs y la selección de skills.
    if let Some(mut lock) = templates::read_lock(&workspace_dir) {
        let global = config::list_mcps();
        let (mcps, mcp_warnings) = templates::resolve_mcps(
            &workspace.mcp_names,
            workspace.template_id.as_deref(),
            &state.templates_root(),
            &global,
        );
        lock.mcps = mcps;
        lock.skills = workspace.skills.clone();
        lock.model = workspace.model.clone();
        warnings.extend(mcp_warnings);
        templates::write_lock(&workspace_dir, &lock)?;
    }

    let materialized = materialize_workspace(&workspace, &workspace_dir)?;
    let mut outcome = outcome(workspace, materialized);
    warnings.append(&mut outcome.warnings);
    outcome.warnings = warnings;
    state.save()?;
    Ok(outcome)
}

#[tauri::command]
pub fn set_workspace_disabled(
    state: State<'_, AppState>,
    id: String,
    disabled_mcps: Vec<String>,
    disabled_skills: Vec<String>,
) -> Result<ConfigOutcome, String> {
    let workspace = {
        let mut workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        let workspace = workspaces
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or_else(|| format!("Workspace '{id}' no existe"))?;
        workspace.disabled_mcps = disabled_mcps
            .into_iter()
            .filter(|name| workspace.mcp_names.contains(name))
            .collect();
        workspace.disabled_skills = disabled_skills
            .into_iter()
            .filter(|skill_id| workspace.skills.iter().any(|skill| &skill.id == skill_id))
            .collect();
        workspace.updated_at = now_ms();
        workspace.clone()
    };

    let workspace_dir = ensure_workspace_dir(&state.data_dir, &id);
    let materialized = materialize_workspace(&workspace, &workspace_dir)?;
    let outcome = outcome(workspace, materialized);
    state.save()?;
    Ok(outcome)
}

#[tauri::command]
pub fn reapply_template(state: State<'_, AppState>, id: String) -> Result<ConfigOutcome, String> {
    let workspace = {
        let workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        workspaces
            .iter()
            .find(|workspace| workspace.id == id)
            .cloned()
            .ok_or_else(|| format!("Workspace '{id}' no existe"))?
    };
    let template_id = workspace
        .template_id
        .clone()
        .ok_or("Este workspace no usa ningún template")?;
    let manifest = state
        .templates
        .lock()
        .map_err(|_| "estado bloqueado")?
        .iter()
        .find(|template| template.id == template_id)
        .cloned()
        .ok_or_else(|| format!("El template '{template_id}' ya no existe"))?;

    let workspace_dir = ensure_workspace_dir(&state.data_dir, &id);
    let (lock, mut warnings) = templates::freeze(&manifest, &state.templates_root())?;
    templates::write_lock(&workspace_dir, &lock)?;

    let refreshed = {
        let mut workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        let workspace = workspaces
            .iter_mut()
            .find(|workspace| workspace.id == id)
            .ok_or_else(|| format!("Workspace '{id}' no existe"))?;
        workspace.mcp_names = manifest.mcps.clone();
        workspace.skills = lock.skills.clone();
        workspace.agents = lock.agents.clone();
        workspace.commands = lock.commands.clone();
        workspace.plugins = lock.plugins.clone();
        workspace.template_version = Some(manifest.version);
        workspace.model = lock.model.clone();
        workspace.updated_at = now_ms();
        workspace.clone()
    };

    let materialized = materialize_workspace(&refreshed, &workspace_dir)?;
    let mut outcome = outcome(refreshed, materialized);
    warnings.append(&mut outcome.warnings);
    outcome.warnings = warnings;
    state.save()?;
    Ok(outcome)
}

#[tauri::command]
pub async fn delete_workspace(
    state: State<'_, AppState>,
    id: String,
    remove_worktree: Option<bool>,
    force: Option<bool>,
    delete_db: Option<bool>,
) -> Result<(), String> {
    let workspace = {
        let workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        workspaces
            .iter()
            .find(|workspace| workspace.id == id)
            .cloned()
            .ok_or_else(|| format!("Workspace '{id}' no existe"))?
    };

    // Validar el worktree antes de tocar nada.
    let worktree = if workspace.mode == WorkspaceMode::Worktree && remove_worktree.unwrap_or(true) {
        let path = PathBuf::from(
            workspace
                .worktree_path
                .clone()
                .unwrap_or_else(|| workspace.project_path.clone()),
        );
        let repo_path = match workspace.repo_id.as_deref().and_then(|repo_id| {
            state
                .repos
                .lock()
                .ok()
                .and_then(|repos| repos.iter().find(|repo| repo.id == repo_id).cloned())
        }) {
            Some(repo) => PathBuf::from(repo.path),
            None => git::toplevel(&path).map_err(|_| {
                format!(
                    "No se pudo localizar el repo del worktree '{}'",
                    path.display()
                )
            })?,
        };
        if path.exists() && git::is_dirty(&path) && !force.unwrap_or(false) {
            return Err(
                "El worktree tiene cambios sin commitear. Confirma el borrado forzado para eliminarlo; la rama se conservará."
                    .into(),
            );
        }
        Some((repo_path, path))
    } else {
        None
    };

    let handle = state
        .servers
        .lock()
        .map_err(|_| "estado bloqueado")?
        .remove(&id);
    if let Some(handle) = handle {
        server::stop(handle).await;
    }

    if let Some((repo_path, path)) = worktree {
        if path.exists() {
            git::worktree_remove(&repo_path, &path, force.unwrap_or(false))?;
        }
        git::worktree_prune(&repo_path);
    }

    let workspace_dir = state.data_dir.join("workspaces").join(&id);
    if delete_db.unwrap_or(false)
        && let Ok(entries) = fs::read_dir(&workspace_dir)
    {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("opencode.db") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    {
        let mut workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        workspaces.retain(|workspace| workspace.id != id);
    }
    state.save()
}

#[tauri::command]
pub async fn start_workspace(state: State<'_, AppState>, id: String) -> Result<ServerInfo, String> {
    let workspace = state
        .workspaces
        .lock()
        .map_err(|_| "estado bloqueado")?
        .iter()
        .find(|w| w.id == id)
        .cloned()
        .ok_or_else(|| format!("Workspace '{id}' no existe"))?;

    let existing = state
        .servers
        .lock()
        .map_err(|_| "estado bloqueado")?
        .remove(&id);

    if let Some(mut handle) = existing
        && server::is_alive(&mut handle)
    {
        let info = info_of(&id, &mut handle).ok_or("El servidor no tiene PID")?;
        state
            .servers
            .lock()
            .map_err(|_| "estado bloqueado")?
            .insert(id, handle);
        return Ok(info);
    }

    let bin =
        find_opencode_bin().ok_or("No se encontró el binario de opencode. Define OPENCODE_BIN.")?;
    let workspace_dir = ensure_workspace_dir(&state.data_dir, &id);
    let materialized = materialize_workspace(&workspace, &workspace_dir)?;
    for warning in &materialized.warnings {
        eprintln!("[openconf] {}", warning);
    }

    let (handle, info) = server::spawn(&workspace, &workspace_dir, &bin).await?;
    state
        .servers
        .lock()
        .map_err(|_| "estado bloqueado")?
        .insert(id, handle);
    Ok(info)
}

#[tauri::command]
pub async fn stop_workspace(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let handle = state
        .servers
        .lock()
        .map_err(|_| "estado bloqueado")?
        .remove(&id);
    if let Some(handle) = handle {
        server::stop(handle).await;
    }
    Ok(())
}

#[tauri::command]
pub fn workspace_status(state: State<'_, AppState>) -> Result<Vec<ServerInfo>, String> {
    let mut servers = state.servers.lock().map_err(|_| "estado bloqueado")?;
    let dead: Vec<String> = servers
        .iter_mut()
        .filter_map(|(id, handle)| (!server::is_alive(handle)).then(|| id.clone()))
        .collect();
    for id in dead {
        servers.remove(&id);
    }
    let mut result = Vec::new();
    for (id, handle) in servers.iter_mut() {
        if let Some(info) = info_of(id, handle) {
            result.push(info);
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn worktree_status(state: State<'_, AppState>, id: String) -> Result<WorktreeStatus, String> {
    let workspace = state
        .workspaces
        .lock()
        .map_err(|_| "estado bloqueado")?
        .iter()
        .find(|workspace| workspace.id == id)
        .cloned()
        .ok_or_else(|| format!("Workspace '{id}' no existe"))?;
    let path = workspace
        .worktree_path
        .clone()
        .unwrap_or_else(|| workspace.project_path.clone());
    let exists = Path::new(&path).is_dir();
    Ok(WorktreeStatus {
        exists,
        dirty: exists && git::is_dirty(Path::new(&path)),
        branch: workspace.branch,
        path,
    })
}

#[tauri::command]
pub fn workspace_log(state: State<'_, AppState>, id: String, lines: Option<usize>) -> String {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return String::new();
    }
    let path = state
        .data_dir
        .join("workspaces")
        .join(&id)
        .join("logs/server.log");
    let Ok(raw) = fs::read_to_string(path) else {
        return String::new();
    };
    let take = lines.unwrap_or(200);
    let all: Vec<&str> = raw.lines().collect();
    all[all.len().saturating_sub(take)..].join("\n")
}

// ---------------------------------------------------------------------------
// Recursos
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn resources(pid: Option<u32>) -> crate::resources::ResourceUsage {
    crate::resources::snapshot(pid).await
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppSettings {
    let mut settings = state
        .settings
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default();
    settings.worktrees_root = Some(state.worktrees_root().to_string_lossy().to_string());
    settings
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let root = settings
        .worktrees_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(expand_tilde);
    if let Some(root) = &root {
        if !root.is_absolute() {
            return Err("La raíz de worktrees debe ser una ruta absoluta".into());
        }
        fs::create_dir_all(root)
            .map_err(|e| format!("No se pudo crear {}: {e}", root.display()))?;
    }
    let mut stored = settings;
    stored.version = crate::store::STORE_VERSION;
    stored.worktrees_root = root.map(|root| root.to_string_lossy().to_string());
    {
        let mut current = state.settings.lock().map_err(|_| "estado bloqueado")?;
        *current = stored.clone();
    }
    state.save()?;
    Ok(stored)
}
