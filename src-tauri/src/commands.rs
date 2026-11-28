use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::config;
use crate::context;
use crate::git;
use crate::library;
use crate::model::{
    AppSettings, Bootstrap, ConfigOutcome, CreatePullRequestInput, CreateWorkspaceInput, Feature,
    FeatureArtifact, FeatureDeleteOutcome, FeatureDeletePreview, FeatureProvisionOutcome, GhStatus,
    GitCommitResult, GitCommitSummary, GitHubIssue, GitMergeResult, GitPushResult, GitStatusOutput,
    Library, McpInfo, ModelCost, ModelDetail, ModelLimit, ProfileManifest, PullRequestCheck,
    PullRequestInfo, Repo, ServerInfo, SkillInfo, SkillRef, Workspace, WorkspaceMode,
    WorktreeStatus,
};
use crate::preview::{self, PreviewProbe};
use crate::profiles;
use crate::runner::{self, Owner};
use crate::server;
use crate::state::{AppState, SessionFileMode, ensure_workspace_dir, expand_tilde};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn find_opencode_bin() -> Option<PathBuf> {
    runner::find_opencode_bin()
}

fn info_of(workspace_id: &str, handle: &mut server::ServerHandle) -> Option<ServerInfo> {
    runner::info_for(&Owner::Workspace(workspace_id.to_string()), handle)
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
        bootstrap: Vec::new(),
        created_at: now,
        updated_at: now,
    })
}

fn materialize_workspace(
    state: &AppState,
    workspace: &Workspace,
    workspace_dir: &Path,
) -> Result<(String, config::Materialized), String> {
    let root = project_root(state, workspace);
    let context = runner::materialize(&state.data_dir, workspace, workspace_dir, &root)?;
    let mut materialized = context.materialized;
    // Los workspaces anteriores guardaban su DB en workspaces/<id>. La primera
    // vez que entran en un contexto se copia para no perder sus sesiones.
    migrate_legacy_db(
        state,
        &workspace.id,
        &context.dir,
        &mut materialized.warnings,
    );
    Ok((context.hash, materialized))
}

fn migrate_legacy_db(
    state: &AppState,
    workspace_id: &str,
    context_dir: &Path,
    warnings: &mut Vec<String>,
) {
    if context_dir.join("opencode.db").exists() {
        return;
    }
    let legacy_dir = state.data_dir.join("workspaces").join(workspace_id);
    let Ok(entries) = fs::read_dir(&legacy_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("opencode.db") {
            continue;
        }
        let target = context_dir.join(&name);
        if let Err(error) = fs::copy(entry.path(), &target) {
            warnings.push(format!(
                "No se pudo migrar {name} al contexto compartido: {error}"
            ));
        }
    }
}

fn materialize_and_remember(
    state: &AppState,
    workspace: &Workspace,
    workspace_dir: &Path,
) -> Result<(Workspace, config::Materialized), String> {
    let (hash, materialized) = materialize_workspace(state, workspace, workspace_dir)?;
    let refreshed = remember_context(state, &workspace.id, &hash)?;
    Ok((refreshed, materialized))
}

/// Raíz estable del proyecto: el checkout principal del repo, no el worktree.
/// Así dos worktrees del mismo repo comparten contexto si su huella coincide.
fn project_root(state: &AppState, workspace: &Workspace) -> String {
    if let Some(repo_id) = workspace.repo_id.as_deref()
        && let Ok(repos) = state.repos.lock()
        && let Some(repo) = repos.iter().find(|repo| repo.id == repo_id)
    {
        return std::fs::canonicalize(&repo.path)
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|_| repo.path.clone());
    }
    std::fs::canonicalize(&workspace.project_path)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| workspace.project_path.clone())
}

/// Recuerda en el workspace la huella que acaba de materializarse.
fn remember_context(state: &AppState, workspace_id: &str, hash: &str) -> Result<Workspace, String> {
    let mut workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
    let workspace = workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("Workspace '{workspace_id}' no existe"))?;
    workspace.context_hash = Some(hash.to_string());
    workspace.updated_at = now_ms();
    Ok(workspace.clone())
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
        for (_, handle) in servers.iter_mut() {
            let workspace_ids = handle.workspaces.clone();
            for workspace_id in workspace_ids {
                if let Some(info) = info_of(&workspace_id, handle) {
                    running.push(info);
                }
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
    let mut profiles = state
        .profiles
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default();
    profiles.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
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
        profiles,
        settings,
        worktrees_root,
        running,
        data_dir: state.data_dir.to_string_lossy().to_string(),
        opencode_bin: bin.as_ref().map(|p| p.to_string_lossy().to_string()),
        error: bin.is_none().then(runner::bin_error),
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

fn json_text(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn json_flag(value: Option<&serde_json::Value>) -> Option<bool> {
    value.and_then(serde_json::Value::as_bool)
}

fn json_count(value: Option<&serde_json::Value>) -> Option<u64> {
    value.and_then(serde_json::Value::as_u64)
}

fn json_amount(value: Option<&serde_json::Value>) -> Option<f64> {
    value.and_then(serde_json::Value::as_f64)
}

fn json_texts(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn model_detail(key: &str, registry: &serde_json::Value) -> ModelDetail {
    let (provider_id, id) = key.split_once('/').unwrap_or((key, key));
    let entry = registry
        .get(provider_id)
        .and_then(|provider| provider.get("models"))
        .and_then(|models| models.get(id));

    let cost = entry.and_then(|model| model.get("cost")).and_then(|value| {
        let input = json_amount(value.get("input"));
        let output = json_amount(value.get("output"));
        let cache_read = json_amount(value.get("cache_read"));
        let cache_write = json_amount(value.get("cache_write"));
        (input.is_some() || output.is_some() || cache_read.is_some() || cache_write.is_some())
            .then_some(ModelCost {
                input,
                output,
                cache_read,
                cache_write,
            })
    });
    let limit = entry
        .and_then(|model| model.get("limit"))
        .and_then(|value| {
            let context = json_count(value.get("context"));
            let input = json_count(value.get("input"));
            let output = json_count(value.get("output"));
            (context.is_some() || input.is_some() || output.is_some()).then_some(ModelLimit {
                context,
                input,
                output,
            })
        });
    let modalities = entry.and_then(|model| model.get("modalities"));

    ModelDetail {
        key: key.to_string(),
        provider_id: provider_id.to_string(),
        id: id.to_string(),
        name: entry
            .and_then(|model| json_text(model.get("name")))
            .unwrap_or_else(|| id.to_string()),
        description: entry.and_then(|model| json_text(model.get("description"))),
        family: entry.and_then(|model| json_text(model.get("family"))),
        reasoning: entry.and_then(|model| json_flag(model.get("reasoning"))),
        tools: entry.and_then(|model| json_flag(model.get("tool_call"))),
        attachment: entry.and_then(|model| json_flag(model.get("attachment"))),
        temperature: entry.and_then(|model| json_flag(model.get("temperature"))),
        input_modalities: json_texts(modalities.and_then(|value| value.get("input"))),
        output_modalities: json_texts(modalities.and_then(|value| value.get("output"))),
        cost,
        limit,
        knowledge: entry.and_then(|model| json_text(model.get("knowledge"))),
        release_date: entry.and_then(|model| json_text(model.get("release_date"))),
        last_updated: entry.and_then(|model| json_text(model.get("last_updated"))),
        status: entry.and_then(|model| json_text(model.get("status"))),
        open_weights: entry.and_then(|model| json_flag(model.get("open_weights"))),
    }
}

/// Modelos a los que dan acceso las suscripciones y proveedores configurados
/// en opencode, con la ficha que opencode cachea de models.dev.
#[tauri::command]
pub async fn list_available_models() -> Result<Vec<ModelDetail>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let bin = find_opencode_bin().ok_or_else(runner::bin_error)?;
        let output = std::process::Command::new(bin)
            .arg("models")
            .env_remove("OPENCODE_CONFIG")
            .env_remove("OPENCODE_CONFIG_CONTENT")
            .env_remove("OPENCODE_CONFIG_DIR")
            .env_remove("OPENCODE_SESSION_ID")
            .env_remove("OPENCODE_PASSWORD")
            .env_remove("OPENCODE_SERVER_PASSWORD")
            .output()
            .map_err(|e| format!("No se pudo ejecutar opencode models: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = stderr.trim();
            return Err(if detail.is_empty() {
                format!("opencode models terminó con {}", output.status)
            } else {
                detail.to_string()
            });
        }
        let registry = dirs::cache_dir()
            .map(|dir| dir.join("opencode").join("models.json"))
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .unwrap_or(serde_json::Value::Null);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut models: Vec<String> = stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && line.contains('/'))
            .map(str::to_string)
            .collect();
        models.sort();
        models.dedup();
        Ok(models
            .iter()
            .map(|key| model_detail(key, &registry))
            .collect())
    })
    .await
    .map_err(|e| format!("No se pudo listar los modelos: {e}"))?
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

/// Candidatos de configuración ignorada del checkout de un repo registrado.
/// Solo devuelve rutas y tipo; nunca contenido.
#[tauri::command]
pub fn detect_bootstrap_candidates(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<crate::bootstrap_candidates::BootstrapDetection, String> {
    let repo = repo_of(&state, &repo_id)?;
    crate::bootstrap_candidates::detect(Path::new(&repo.path))
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

fn normalize_profile_id(raw: &str) -> Result<String, String> {
    let id = raw.trim();
    if id.is_empty() || id == "." || id == ".." {
        return Err("El perfil necesita un identificador".into());
    }
    if !id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
        || id.contains("..")
    {
        return Err(
            "El identificador del perfil solo admite letras, números, guiones, guiones bajos y puntos"
                .into(),
        );
    }
    Ok(id.to_string())
}

#[tauri::command]
pub fn list_profiles(state: State<'_, AppState>) -> Vec<ProfileManifest> {
    let mut items = state
        .profiles
        .lock()
        .map(|profiles| profiles.clone())
        .unwrap_or_default();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    items
}

#[tauri::command]
pub fn save_profile(
    state: State<'_, AppState>,
    manifest: ProfileManifest,
) -> Result<ProfileManifest, String> {
    let mut manifest = manifest;
    manifest.id = normalize_profile_id(&manifest.id)?;
    manifest.name = manifest.name.trim().to_string();
    if manifest.name.is_empty() {
        return Err("El perfil necesita un nombre".into());
    }
    manifest.version = manifest.version.max(1);
    let mut models: Vec<String> = Vec::new();
    for model in manifest.models.drain(..) {
        let model = model.trim().to_string();
        if !model.is_empty() && !models.contains(&model) {
            models.push(model);
        }
    }
    manifest.models = models;
    manifest.model = manifest
        .model
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty());
    if let Some(model) = manifest.model.clone()
        && !manifest.models.contains(&model)
    {
        manifest.models.insert(0, model);
    }
    if manifest.model.is_none() {
        manifest.model = manifest.models.first().cloned();
    }
    let root = state.profiles_root();
    let existing = profiles::read_manifest(&root, &manifest.id);
    manifest.created_at = existing
        .as_ref()
        .map(|item| item.created_at)
        .unwrap_or_else(now_ms);
    manifest.updated_at = now_ms();
    profiles::save_manifest(&root, &manifest)?;

    {
        let mut stored = state.profiles.lock().map_err(|_| "estado bloqueado")?;
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
pub fn delete_profile(state: State<'_, AppState>, id: String) -> Result<(), String> {
    profiles::remove_profile_dir(&state.profiles_root(), &id)?;
    {
        let mut stored = state.profiles.lock().map_err(|_| "estado bloqueado")?;
        stored.retain(|item| item.id != id);
    }
    state.save()
}

#[tauri::command]
pub fn profile_agents_md(state: State<'_, AppState>, id: String) -> String {
    profiles::read_agents_md(&state.profiles_root(), &id)
}

#[tauri::command]
pub fn save_profile_agents_md(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<String, String> {
    profiles::write_agents_md(&state.profiles_root(), &id, &content)?;
    Ok(content)
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_features(state: State<'_, AppState>) -> Vec<Feature> {
    state
        .features
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default()
}

/// Upsert de una feature. El dominio (tipos, flujo y pasos) vive en el frontend;
/// aquí solo se valida lo mínimo y se persiste.
#[tauri::command]
pub fn save_feature(state: State<'_, AppState>, feature: Feature) -> Result<Feature, String> {
    if feature.id.trim().is_empty() {
        return Err("La feature necesita un identificador".into());
    }
    if feature.name.trim().is_empty() {
        return Err("Ponle un nombre a la feature".into());
    }
    crate::artifacts::ensure_issue(&feature)?;
    {
        let mut features = state.features.lock().map_err(|_| "estado bloqueado")?;
        match features.iter_mut().find(|item| item.id == feature.id) {
            Some(existing) => *existing = feature.clone(),
            None => features.push(feature.clone()),
        }
    }
    state.save()?;
    Ok(feature)
}

/// Plan de borrado sin efectos: worktrees, ramas y motivos de protección.
#[tauri::command]
pub fn feature_delete_preview(
    state: State<'_, AppState>,
    id: String,
) -> Result<FeatureDeletePreview, String> {
    let feature = feature_of(&state, &id)?;
    crate::feature_delete::preview(&feature)
}

/// Borra de verdad una feature. Para primero sus servidores (coordinador y
/// pasos) y solo quita el registro si la limpieza terminó sin errores.
#[tauri::command]
pub async fn delete_feature(
    state: State<'_, AppState>,
    id: String,
    force_dirty: bool,
) -> Result<FeatureDeleteOutcome, String> {
    let feature = feature_of(&state, &id)?;
    runner::stop_owner(state.clone(), Owner::Feature(id.clone())).await?;
    delete_feature_inner(&state, feature, force_dirty)
}

fn delete_feature_inner(
    state: &AppState,
    feature: Feature,
    force_dirty: bool,
) -> Result<FeatureDeleteOutcome, String> {
    let outcome = crate::feature_delete::delete(&feature, force_dirty, &state.data_dir)?;
    if !outcome.feature_deleted {
        return Ok(outcome);
    }

    let previous = {
        let mut features = state.features.lock().map_err(|_| "estado bloqueado")?;
        let previous = features.clone();
        let before = features.len();
        features.retain(|item| item.id != feature.id);
        if features.len() == before {
            return Err(format!("La feature '{}' no existe", feature.id));
        }
        previous
    };
    if let Err(err) = state.save() {
        let mut features = state.features.lock().map_err(|_| "estado bloqueado")?;
        *features = previous;
        return Err(format!(
            "La feature se limpió, pero no se pudo guardar features.json: {err}"
        ));
    }
    Ok(outcome)
}

/// Crea los worktrees de la feature (metarepo y subrepos). Idempotente.
#[tauri::command]
pub fn provision_feature(
    state: State<'_, AppState>,
    id: String,
) -> Result<FeatureProvisionOutcome, String> {
    let feature = feature_of(&state, &id)?;

    let (worktrees, warnings, errors, applied) = {
        let report = crate::features::provision(&feature)?;
        (
            report.worktrees,
            report.warnings,
            report.errors,
            report.applied,
        )
    };
    let blocked = !errors.is_empty();
    let mut feature = feature;
    if blocked {
        feature.status = "blocked".into();
    } else if feature.status == "blocked" {
        feature.status = "confirmed".into();
    }
    feature.updated_at = now_ms();
    {
        let mut features = state.features.lock().map_err(|_| "estado bloqueado")?;
        match features.iter_mut().find(|item| item.id == feature.id) {
            Some(existing) => *existing = feature.clone(),
            None => features.push(feature.clone()),
        }
    }
    state.save()?;
    Ok(FeatureProvisionOutcome {
        feature,
        worktrees,
        warnings,
        errors,
        applied,
        blocked,
    })
}

fn feature_of(state: &AppState, id: &str) -> Result<Feature, String> {
    state
        .features
        .lock()
        .map_err(|_| "estado bloqueado")?
        .iter()
        .find(|item| item.id == id)
        .cloned()
        .ok_or_else(|| format!("La feature '{id}' no existe"))
}

/// Artefactos compartidos de la feature (`BRIEF.md`, `DECOMPOSITION.md`…).
#[tauri::command]
pub fn feature_artifacts(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<FeatureArtifact>, String> {
    let feature = feature_of(&state, &id)?;
    Ok(crate::artifacts::list(&feature))
}

#[tauri::command]
pub fn write_feature_artifact(
    state: State<'_, AppState>,
    id: String,
    name: String,
    content: String,
) -> Result<FeatureArtifact, String> {
    let feature = feature_of(&state, &id)?;
    crate::artifacts::write(&feature, &name, &content)
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
    let profiles_root = state.profiles_root();
    let manifest = match input.profile_id.as_deref().filter(|id| !id.is_empty()) {
        Some(id) => Some(
            state
                .profiles
                .lock()
                .map_err(|_| "estado bloqueado")?
                .iter()
                .find(|template| template.id == id)
                .cloned()
                .ok_or_else(|| format!("El perfil '{id}' no existe"))?,
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
        profile_id: manifest.as_ref().map(|manifest| manifest.id.clone()),
        profile_version: None,
        issue: input.issue.clone(),
        mcp_names: input.mcp_names.clone(),
        disabled_mcps: Vec::new(),
        skills: input.skills.clone(),
        disabled_skills: Vec::new(),
        agents: Vec::new(),
        commands: Vec::new(),
        plugins: Vec::new(),
        model: input.model.clone().filter(|model| !model.trim().is_empty()),
        models: Vec::new(),
        context_hash: None,
        created_at: now,
        updated_at: now,
        missing: false,
    };

    let workspace_dir = ensure_workspace_dir(&state.data_dir, &id);
    let lock = if let Some(manifest) = &manifest {
        match profiles::freeze(manifest, &profiles_root) {
            Ok((lock, freeze_warnings)) => {
                warnings.extend(freeze_warnings);
                workspace.profile_version = Some(manifest.version);
                workspace.mcp_names = manifest.mcps.clone();
                workspace.skills = lock.skills.clone();
                workspace.agents = lock.agents.clone();
                workspace.commands = lock.commands.clone();
                workspace.plugins = lock.plugins.clone();
                workspace.model = lock.model.clone();
                workspace.models = lock.models.clone();
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
        && let Err(err) = profiles::write_lock(&workspace_dir, lock)
    {
        rollback_worktree(&repo, &worktree_path);
        return Err(err);
    }

    {
        let workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        warnings.extend(conflicts(&workspaces, &workspace));
    }

    let (hash, materialized) = match materialize_workspace(&state, &workspace, &workspace_dir) {
        Ok(materialized) => materialized,
        Err(err) => {
            rollback_worktree(&repo, &worktree_path);
            return Err(err);
        }
    };
    workspace.context_hash = Some(hash);
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
    if let Some(mut lock) = profiles::read_lock(&workspace_dir) {
        let global = config::list_mcps();
        let (mcps, mcp_warnings) = profiles::resolve_mcps(
            &workspace.mcp_names,
            workspace.profile_id.as_deref(),
            &state.profiles_root(),
            &global,
        );
        lock.mcps = mcps;
        lock.skills = workspace.skills.clone();
        lock.model = workspace.model.clone();
        warnings.extend(mcp_warnings);
        profiles::write_lock(&workspace_dir, &lock)?;
    }

    let (workspace, materialized) = materialize_and_remember(&state, &workspace, &workspace_dir)?;
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
    let (workspace, materialized) = materialize_and_remember(&state, &workspace, &workspace_dir)?;
    let outcome = outcome(workspace, materialized);
    state.save()?;
    Ok(outcome)
}

#[tauri::command]
pub fn reapply_profile(state: State<'_, AppState>, id: String) -> Result<ConfigOutcome, String> {
    let workspace = {
        let workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        workspaces
            .iter()
            .find(|workspace| workspace.id == id)
            .cloned()
            .ok_or_else(|| format!("Workspace '{id}' no existe"))?
    };
    let profile_id = workspace
        .profile_id
        .clone()
        .ok_or("Este workspace no usa ningún perfil")?;
    let manifest = state
        .profiles
        .lock()
        .map_err(|_| "estado bloqueado")?
        .iter()
        .find(|template| template.id == profile_id)
        .cloned()
        .ok_or_else(|| format!("El perfil '{profile_id}' ya no existe"))?;

    let workspace_dir = ensure_workspace_dir(&state.data_dir, &id);
    let (lock, mut warnings) = profiles::freeze(&manifest, &state.profiles_root())?;
    profiles::write_lock(&workspace_dir, &lock)?;

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
        workspace.profile_version = Some(manifest.version);
        workspace.model = lock.model.clone();
        workspace.models = lock.models.clone();
        workspace.updated_at = now_ms();
        workspace.clone()
    };

    let (refreshed, materialized) = materialize_and_remember(&state, &refreshed, &workspace_dir)?;
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

    let mut stopped = Vec::new();
    let mut detached = Vec::new();
    if let Ok(mut servers) = state.servers.lock() {
        let keys: Vec<String> = servers
            .iter()
            .filter(|(_, handle)| handle.workspaces.iter().any(|workspace| workspace == &id))
            .map(|(key, _)| key.clone())
            .collect();
        for key in keys {
            detached.push(key.clone());
            let mut empty = false;
            if let Some(handle) = servers.get_mut(&key) {
                handle.workspaces.retain(|workspace| workspace != &id);
                empty = handle.is_empty();
            }
            if empty && let Some(handle) = servers.remove(&key) {
                stopped.push(handle);
            }
        }
    }
    for handle in stopped {
        server::stop(handle).await;
    }

    if let Some(hash) = workspace.context_hash.as_deref()
        && !detached.iter().any(|key| key == hash)
    {
        detached.push(hash.to_string());
    }
    for hash in detached {
        let _ = context::detach(&state.data_dir, &hash, &id);
    }

    if let Some((repo_path, path)) = worktree {
        if path.exists() {
            git::worktree_remove(&repo_path, &path, force.unwrap_or(false))?;
        }
        git::worktree_prune(&repo_path);
    }

    let workspace_dir = state.data_dir.join("workspaces").join(&id);
    if delete_db.unwrap_or(false) {
        if let Ok(entries) = fs::read_dir(&workspace_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("opencode.db") {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        // La DB del contexto es compartida: solo se borra si no queda ningún
        // workspace ni feature enganchado a ese contexto.
        if let Some(hash) = workspace.context_hash.as_deref() {
            let context_dir = context::context_dir(&state.data_dir, hash);
            let shared = state
                .workspaces
                .lock()
                .map(|workspaces| {
                    workspaces
                        .iter()
                        .any(|other| other.id != id && other.context_hash.as_deref() == Some(hash))
                })
                .unwrap_or(true)
                || context::read_meta(&context_dir)
                    .map(|meta| !meta.workspaces.is_empty())
                    .unwrap_or(false);
            if !shared && let Ok(entries) = fs::read_dir(&context_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("opencode.db") {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
    }

    {
        let mut workspaces = state.workspaces.lock().map_err(|_| "estado bloqueado")?;
        workspaces.retain(|workspace| workspace.id != id);
    }
    state.save()
}

/// Materializa y arranca un perfil distinto del perfil por defecto del
/// workspace, sin cambiar la selección congelada de este. La sesión que se cree
/// contra el servidor devuelto llevará ese perfil (contexto).
#[tauri::command]
pub async fn start_profile(
    state: State<'_, AppState>,
    workspace_id: String,
    profile_id: String,
) -> Result<ServerInfo, String> {
    let workspace = state
        .workspaces
        .lock()
        .map_err(|_| "estado bloqueado")?
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .cloned()
        .ok_or_else(|| format!("Workspace '{workspace_id}' no existe"))?;

    if workspace.profile_id.as_deref() == Some(profile_id.as_str()) {
        return start_workspace(state, workspace_id).await;
    }

    let manifest = state
        .profiles
        .lock()
        .map_err(|_| "estado bloqueado")?
        .iter()
        .find(|profile| profile.id == profile_id)
        .cloned()
        .ok_or_else(|| format!("El perfil '{profile_id}' no existe"))?;
    let (lock, mut warnings) = profiles::freeze(&manifest, &state.profiles_root())?;

    let mut applied = workspace.clone();
    applied.mcp_names = manifest.mcps.clone();
    applied.skills = lock.skills.clone();
    applied.agents = lock.agents.clone();
    applied.commands = lock.commands.clone();
    applied.plugins = lock.plugins.clone();
    applied.model = lock.model.clone();
    applied.models = lock.models.clone();

    let (global, global_error) = config::read_global_config();
    let global_dir = config::global_config_dir();
    let plan = config::plan_with_lock(&applied, Some(lock.clone()), &global_dir, &global);
    let root = project_root(&state, &applied);
    let hash = context::fingerprint_without_model(&root, &plan.config, &plan.agents_md);
    let context_dir = context::ensure(&state.data_dir, &hash, &root)?;
    let workspace_dir = ensure_workspace_dir(&state.data_dir, &workspace_id);
    let materialized = config::write_plan(&applied, &workspace_dir, &context_dir, &plan)?;
    profiles::write_lock(&context_dir, &lock)?;
    warnings.extend(materialized.warnings);
    if let Some(error) = global_error {
        warnings.push(error);
    }
    for warning in &warnings {
        eprintln!("[opentemplates] {}", warning);
    }
    context::attach(&state.data_dir, &hash, &root, &workspace_id)?;
    let mut info = runner::ensure_server(
        &state,
        &applied,
        &hash,
        &context_dir,
        Owner::Workspace(workspace_id.clone()),
    )
    .await?;
    // Dos perfiles pueden compartir huella y diferir solo en el modelo.
    info.model = applied.model.clone();
    info.models = applied.models.clone();
    Ok(info)
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

    let workspace_dir = ensure_workspace_dir(&state.data_dir, &id);
    let (hash, materialized) = materialize_workspace(&state, &workspace, &workspace_dir)?;
    for warning in &materialized.warnings {
        eprintln!("[opentemplates] {}", warning);
    }
    let workspace = remember_context(&state, &id, &hash)?;
    let root = project_root(&state, &workspace);
    context::attach(&state.data_dir, &hash, &root, &id)?;

    // Si el workspace cambió de huella (reaplicar, cambiar selección), se
    // desengancha de los contextos anteriores antes de usar el nuevo.
    let mut stale = Vec::new();
    {
        let mut servers = state.servers.lock().map_err(|_| "estado bloqueado")?;
        let previous: Vec<String> = servers
            .iter()
            .filter(|(key, handle)| {
                key.as_str() != hash && handle.workspaces.iter().any(|workspace| workspace == &id)
            })
            .map(|(key, _)| key.clone())
            .collect();
        for key in previous {
            let mut empty = false;
            if let Some(handle) = servers.get_mut(&key) {
                handle.workspaces.retain(|workspace| workspace != &id);
                empty = handle.is_empty();
            }
            if empty && let Some(handle) = servers.remove(&key) {
                stale.push(handle);
            }
        }
    }
    for handle in stale {
        server::stop(handle).await;
    }

    let context_dir = context::context_dir(&state.data_dir, &hash);
    let info = runner::ensure_server(
        &state,
        &workspace,
        &hash,
        &context_dir,
        Owner::Workspace(id.clone()),
    )
    .await?;
    state.save()?;
    Ok(info)
}

#[tauri::command]
pub async fn stop_workspace(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut stopped = Vec::new();
    let mut hashes = Vec::new();
    {
        let mut servers = state.servers.lock().map_err(|_| "estado bloqueado")?;
        let keys: Vec<String> = servers
            .iter()
            .filter(|(_, handle)| handle.workspaces.iter().any(|workspace| workspace == &id))
            .map(|(key, _)| key.clone())
            .collect();
        for key in keys {
            hashes.push(key.clone());
            let mut empty = false;
            if let Some(handle) = servers.get_mut(&key) {
                handle.workspaces.retain(|workspace| workspace != &id);
                empty = handle.is_empty();
            }
            if empty && let Some(handle) = servers.remove(&key) {
                stopped.push(handle);
            }
        }
    }
    for handle in stopped {
        server::stop(handle).await;
    }
    if hashes.is_empty()
        && let Some(hash) = state.workspaces.lock().ok().and_then(|workspaces| {
            workspaces
                .iter()
                .find(|workspace| workspace.id == id)
                .and_then(|workspace| workspace.context_hash.clone())
        })
    {
        hashes.push(hash);
    }
    for hash in hashes {
        let _ = context::detach(&state.data_dir, &hash, &id);
    }
    Ok(())
}

#[tauri::command]
pub fn workspace_status(state: State<'_, AppState>) -> Result<Vec<ServerInfo>, String> {
    let mut servers = state.servers.lock().map_err(|_| "estado bloqueado")?;
    let dead: Vec<String> = servers
        .iter_mut()
        .filter_map(|(hash, handle)| (!server::is_alive(handle)).then(|| hash.clone()))
        .collect();
    for hash in dead {
        servers.remove(&hash);
    }
    let mut result = Vec::new();
    for (_, handle) in servers.iter_mut() {
        let workspace_ids = handle.workspaces.clone();
        for workspace_id in workspace_ids {
            if let Some(info) = info_of(&workspace_id, handle) {
                result.push(info);
            }
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
    let hash = state
        .servers
        .lock()
        .ok()
        .and_then(|servers| {
            servers
                .values()
                .find(|handle| handle.workspaces.iter().any(|workspace| workspace == &id))
                .map(|handle| handle.context_hash.clone())
        })
        .or_else(|| {
            state.workspaces.lock().ok().and_then(|workspaces| {
                workspaces
                    .iter()
                    .find(|workspace| workspace.id == id)
                    .and_then(|workspace| workspace.context_hash.clone())
            })
        });
    let path = match hash {
        Some(hash) => context::context_dir(&state.data_dir, &hash).join("logs/server.log"),
        None => state
            .data_dir
            .join("workspaces")
            .join(&id)
            .join("logs/server.log"),
    };
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

// ---------------------------------------------------------------------------
// Ficheros de sesión
// ---------------------------------------------------------------------------

/// Tope de escritura y lectura: un export con muchas herramientas crece, pero
/// no debe permitir cargar ni volcar un fichero arbitrario en memoria.
const SESSION_FILE_MAX_BYTES: u64 = 32 * 1024 * 1024;

/// Ticket devuelto al abrir el diálogo nativo. La ruta es la canónica y el
/// token solo autoriza una operación sobre esa ruta exacta.
#[derive(Debug, serde::Serialize)]
pub struct SessionFileTicket {
    path: String,
    token: String,
}

fn session_file_extension_ok(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("No se permiten enlaces simbólicos para los ficheros de sesión".into());
    }
    Ok(())
}

/// Valida la ruta cruda y devuelve la ruta canónica que se usará de verdad.
///
/// Se exige ruta absoluta, extensión `.json` y ningún componente `..`. Para
/// lectura se resuelve el fichero completo (que debe existir y no ser un
/// enlace simbólico); para escritura se resuelve la carpeta padre y se une el
/// nombre, de modo que la ruta devuelta no pueda salirse de esa carpeta.
fn resolve_session_file(raw: &str, mode: SessionFileMode) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err("La ruta del archivo está vacía".into());
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("La ruta del archivo debe ser absoluta".into());
    }
    if path
        .components()
        .any(|component| component == Component::ParentDir)
    {
        return Err("La ruta del archivo no puede contener '..'".into());
    }
    if !session_file_extension_ok(&path) {
        return Err("El archivo debe tener extensión .json".into());
    }

    match mode {
        SessionFileMode::Read => {
            let metadata = fs::symlink_metadata(&path)
                .map_err(|e| format!("No se pudo leer {}: {e}", path.display()))?;
            reject_symlink(&path)?;
            if !metadata.file_type().is_file() {
                return Err("El archivo de sesión no es un fichero regular".into());
            }
            fs::canonicalize(&path)
                .map_err(|e| format!("No se pudo resolver {}: {e}", path.display()))
        }
        SessionFileMode::Write => {
            let parent = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .ok_or_else(|| format!("La ruta {} no tiene carpeta padre", path.display()))?;
            let name = path
                .file_name()
                .ok_or_else(|| format!("La ruta {} no tiene nombre de archivo", path.display()))?;
            let canonical_parent = fs::canonicalize(parent)
                .map_err(|e| format!("No se pudo resolver {}: {e}", parent.display()))?;
            let target = canonical_parent.join(name);
            match fs::symlink_metadata(&target) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() {
                        return Err(
                            "No se permiten enlaces simbólicos para los ficheros de sesión".into(),
                        );
                    }
                    if !metadata.file_type().is_file() {
                        return Err("El archivo de sesión no es un fichero regular".into());
                    }
                    fs::canonicalize(&target)
                        .map_err(|e| format!("No se pudo resolver {}: {e}", target.display()))
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(target),
                Err(err) => Err(format!("No se pudo leer {}: {err}", target.display())),
            }
        }
    }
}

/// Abre el diálogo nativo desde Rust y emite el ticket de un solo uso. El
/// webview nunca elige la ruta: solo recibe la que el usuario confirmó.
#[tauri::command]
pub async fn begin_session_file(
    app: AppHandle,
    state: State<'_, AppState>,
    mode: String,
    suggested_name: Option<String>,
) -> Result<Option<SessionFileTicket>, String> {
    let mode = SessionFileMode::parse(&mode)
        .ok_or_else(|| "Modo de fichero de sesión desconocido".to_string())?;

    let builder = app
        .dialog()
        .file()
        .add_filter("Sesión de OpenTemplates", &["json"]);
    let builder = match mode {
        SessionFileMode::Read => builder.set_title("Importar sesión"),
        SessionFileMode::Write => {
            let builder = builder.set_title("Exportar sesión");
            let suggested = suggested_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .and_then(|name| Path::new(name).file_name())
                .map(|name| name.to_string_lossy().into_owned());
            match suggested {
                Some(name) => builder.set_file_name(name),
                None => builder,
            }
        }
    };

    let picked = match mode {
        SessionFileMode::Read => builder.blocking_pick_file(),
        SessionFileMode::Write => builder.blocking_save_file(),
    };
    let Some(picked) = picked else {
        return Ok(None);
    };
    let picked = picked
        .into_path()
        .map_err(|e| format!("Ruta no válida: {e}"))?;
    let raw = picked.to_string_lossy();
    let path = resolve_session_file(&raw, mode)?;
    let token = state.issue_session_ticket(mode, path.clone())?;
    Ok(Some(SessionFileTicket {
        path: path.to_string_lossy().into_owned(),
        token,
    }))
}

fn write_session_file(
    state: &AppState,
    path: &str,
    contents: &str,
    overwrite: bool,
    token: &str,
) -> Result<bool, String> {
    if contents.len() as u64 > SESSION_FILE_MAX_BYTES {
        return Err(format!(
            "El archivo supera el máximo de {} MiB",
            SESSION_FILE_MAX_BYTES / (1024 * 1024)
        ));
    }
    let resolved = resolve_session_file(path, SessionFileMode::Write)?;
    state.consume_session_ticket(token, SessionFileMode::Write, &resolved)?;
    if resolved.exists() && !overwrite {
        return Ok(false);
    }
    fs::write(&resolved, contents)
        .map_err(|e| format!("No se pudo escribir {}: {e}", resolved.display()))?;
    Ok(true)
}

fn read_session_file(state: &AppState, path: &str, token: &str) -> Result<String, String> {
    let resolved = resolve_session_file(path, SessionFileMode::Read)?;
    state.consume_session_ticket(token, SessionFileMode::Read, &resolved)?;
    let metadata = fs::metadata(&resolved)
        .map_err(|e| format!("No se pudo leer {}: {e}", resolved.display()))?;
    if metadata.len() > SESSION_FILE_MAX_BYTES {
        return Err(format!(
            "El archivo supera el máximo de {} MiB",
            SESSION_FILE_MAX_BYTES / (1024 * 1024)
        ));
    }
    fs::read_to_string(&resolved)
        .map_err(|e| format!("No se pudo leer {}: {e}", resolved.display()))
}

/// Escribe un export de sesión. Devuelve `false` si el fichero ya existe y no
/// se pidió sobrescribir: el frontend pregunta y reintenta con una nueva
/// elección en el diálogo (y por tanto un nuevo token).
#[tauri::command]
pub fn write_text_file(
    state: State<'_, AppState>,
    path: String,
    contents: String,
    overwrite: bool,
    token: String,
) -> Result<bool, String> {
    write_session_file(&state, &path, &contents, overwrite, &token)
}

/// Lee un export de sesión. La ruta y el token deben ser los que emitió Rust
/// al abrir el diálogo nativo.
#[tauri::command]
pub fn read_text_file(
    state: State<'_, AppState>,
    path: String,
    token: String,
) -> Result<String, String> {
    read_session_file(&state, &path, &token)
}

/// Comprueba la URL del preview desde Rust, sin CORS ni DOM del webview.
#[tauri::command]
pub fn preview_probe(url: String) -> PreviewProbe {
    preview::probe(&url)
}

/// Abre una URL http(s) en el navegador externo del sistema.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    preview::open_external(&url)
}

/// Estado del árbol de trabajo para el panel de commit (salida cruda de git).
#[tauri::command]
pub fn git_status(project_path: String) -> Result<GitStatusOutput, String> {
    git::status(Path::new(&project_path))
}

/// Prepara ficheros concretos y devuelve el estado ya actualizado.
#[tauri::command]
pub fn git_stage(project_path: String, paths: Vec<String>) -> Result<GitStatusOutput, String> {
    let repo = Path::new(&project_path);
    git::stage(repo, &paths)?;
    git::status(repo)
}

/// Quita ficheros del índice y devuelve el estado ya actualizado.
#[tauri::command]
pub fn git_unstage(project_path: String, paths: Vec<String>) -> Result<GitStatusOutput, String> {
    let repo = Path::new(&project_path);
    git::unstage(repo, &paths)?;
    git::status(repo)
}

/// Diff unificado; `staged` decide entre el índice y el árbol de trabajo.
#[tauri::command]
pub fn git_diff(project_path: String, staged: bool) -> Result<String, String> {
    git::diff(Path::new(&project_path), staged)
}

/// Aplica los cambios del worktree de una corrida sobre el workspace.
#[tauri::command]
pub fn git_merge_worktree(
    destination: String,
    source: String,
    base: Option<String>,
) -> Result<GitMergeResult, String> {
    git::merge_worktree(Path::new(&destination), Path::new(&source), base.as_deref())
}

#[tauri::command]
pub fn git_commit(project_path: String, message: String) -> Result<GitCommitResult, String> {
    git::commit(Path::new(&project_path), &message)
}

#[tauri::command]
pub fn git_push(
    project_path: String,
    branch: String,
    set_upstream: bool,
) -> Result<GitPushResult, String> {
    git::push(Path::new(&project_path), &branch, set_upstream)
}

#[tauri::command]
pub fn git_commits(
    project_path: String,
    base: String,
    limit: Option<usize>,
) -> Result<Vec<GitCommitSummary>, String> {
    git::commits(Path::new(&project_path), &base, limit)
}

#[tauri::command]
pub fn gh_status() -> GhStatus {
    crate::gh::status()
}

#[tauri::command]
pub fn gh_pr_view(project_path: String) -> Result<Option<PullRequestInfo>, String> {
    crate::gh::pr_view(Path::new(&project_path))
}

#[tauri::command]
pub fn gh_pr_checks(project_path: String) -> Result<Vec<PullRequestCheck>, String> {
    crate::gh::pr_checks(Path::new(&project_path))
}

#[tauri::command]
pub fn gh_pr_create(input: CreatePullRequestInput) -> Result<String, String> {
    crate::gh::pr_create(&input)
}

#[tauri::command]
pub fn gh_issue_list(
    project_path: String,
    search: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<GitHubIssue>, String> {
    crate::gh::issue_list(Path::new(&project_path), search.as_deref(), limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "opentemplates-sesion-{label}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    fn session_state(label: &str) -> AppState {
        AppState::load(temp_dir(label))
    }

    /// Emite un ticket igual que lo haría el diálogo nativo, pero sin abrirlo.
    fn issue(state: &AppState, mode: SessionFileMode, raw: &str) -> (String, String) {
        let canonical = resolve_session_file(raw, mode).unwrap();
        let token = state.issue_session_ticket(mode, canonical.clone()).unwrap();
        (canonical.to_string_lossy().into_owned(), token)
    }

    #[test]
    fn escribe_y_lee_un_json_con_ticket() {
        let dir = temp_dir("escribe");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sesion.json");
        let raw = path.to_string_lossy().into_owned();
        let contents = "{\"hola\":\"mundo\"}\n".to_string();
        let state = session_state("escribe");

        let (write_path, write_token) = issue(&state, SessionFileMode::Write, &raw);
        assert_eq!(
            write_session_file(&state, &write_path, &contents, false, &write_token),
            Ok(true)
        );

        let (read_path, read_token) = issue(&state, SessionFileMode::Read, &raw);
        assert_eq!(
            read_session_file(&state, &read_path, &read_token),
            Ok(contents)
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn no_sobrescribe_sin_permiso_y_el_token_es_de_un_solo_uso() {
        let dir = temp_dir("sobrescribe");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sesion.json");
        fs::write(&path, "previo").unwrap();
        let raw = path.to_string_lossy().into_owned();
        let state = session_state("sobrescribe");

        let (write_path, write_token) = issue(&state, SessionFileMode::Write, &raw);
        assert_eq!(
            write_session_file(&state, &write_path, "nuevo", false, &write_token),
            Ok(false)
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "previo");
        // El token ya se consumió, incluso sin haber escrito.
        assert!(write_session_file(&state, &write_path, "nuevo", true, &write_token).is_err());

        let (retry_path, retry_token) = issue(&state, SessionFileMode::Write, &raw);
        assert_eq!(
            write_session_file(&state, &retry_path, "nuevo", true, &retry_token),
            Ok(true)
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "nuevo");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rechaza_extensiones_que_no_son_json() {
        let dir = temp_dir("extension");
        fs::create_dir_all(&dir).unwrap();
        let state = session_state("extension");
        let raw = dir.join("sesion.txt").to_string_lossy().into_owned();

        assert!(resolve_session_file(&raw, SessionFileMode::Write).is_err());
        assert!(resolve_session_file(&raw, SessionFileMode::Read).is_err());
        assert!(write_session_file(&state, &raw, "{}", false, "token").is_err());
        assert!(read_session_file(&state, &raw, "token").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rechaza_token_ausente_invalido_o_de_otra_operacion() {
        let dir = temp_dir("token");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sesion.json");
        let raw = path.to_string_lossy().into_owned();
        let state = session_state("token");

        // Sin token o con uno inventado no se escribe nada.
        assert!(write_session_file(&state, &raw, "{}", false, "").is_err());
        assert!(write_session_file(&state, &raw, "{}", false, "inventado").is_err());
        assert!(!path.exists());

        // Un token de lectura no sirve para escribir.
        fs::write(&path, "{}").unwrap();
        let (_, read_token) = issue(&state, SessionFileMode::Read, &raw);
        assert!(write_session_file(&state, &raw, "{}", true, &read_token).is_err());

        // Escritura correcta y lectura posterior con el token de escritura.
        let (write_path, write_token) = issue(&state, SessionFileMode::Write, &raw);
        assert_eq!(
            write_session_file(&state, &write_path, "{}", true, &write_token),
            Ok(true)
        );
        assert!(read_session_file(&state, &write_path, &write_token).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rechaza_rutas_fuera_de_la_raiz_autorizada() {
        let dir = temp_dir("fuera");
        let root = dir.join("root");
        fs::create_dir_all(&root).unwrap();
        let state = session_state("fuera");
        let allowed = root.join("permitido.json");
        let (_, token) = issue(&state, SessionFileMode::Write, &allowed.to_string_lossy());

        // Otra ruta con el mismo token.
        let other = root.join("otro.json").to_string_lossy().into_owned();
        assert!(write_session_file(&state, &other, "{}", false, &token).is_err());
        assert!(!root.join("otro.json").exists());

        // Intento de salir con `..`, aunque el fichero quede junto a la raíz.
        let escape = root.join("../fuera.json").to_string_lossy().into_owned();
        assert!(write_session_file(&state, &escape, "{}", false, "token").is_err());
        assert!(resolve_session_file(&escape, SessionFileMode::Write).is_err());
        assert!(!dir.join("fuera.json").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rechaza_ficheros_que_superan_el_tope() {
        let dir = temp_dir("tamano");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("grande.json");
        fs::File::create(&path)
            .unwrap()
            .set_len(SESSION_FILE_MAX_BYTES + 1)
            .unwrap();
        let raw = path.to_string_lossy().into_owned();
        let state = session_state("tamano");

        let (read_path, token) = issue(&state, SessionFileMode::Read, &raw);
        let err = read_session_file(&state, &read_path, &token).unwrap_err();
        assert!(err.contains("máximo"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lee_extension_en_mayusculas() {
        let dir = temp_dir("mayusculas");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sesion.JSON");
        let raw = path.to_string_lossy().into_owned();
        let state = session_state("mayusculas");

        let (write_path, write_token) = issue(&state, SessionFileMode::Write, &raw);
        assert_eq!(
            write_session_file(&state, &write_path, "{}", false, &write_token),
            Ok(true)
        );
        let (read_path, read_token) = issue(&state, SessionFileMode::Read, &raw);
        assert_eq!(
            read_session_file(&state, &read_path, &read_token),
            Ok("{}".to_string())
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rechaza_enlaces_simbolicos() {
        use std::os::unix::fs::symlink;

        let dir = temp_dir("symlink");
        let real = dir.join("real");
        fs::create_dir_all(&real).unwrap();
        let outside = dir.join("fuera.json");
        fs::write(&outside, "{}").unwrap();
        let link = real.join("enlace.json");
        symlink(&outside, &link).unwrap();

        assert!(resolve_session_file(&link.to_string_lossy(), SessionFileMode::Read).is_err());
        assert!(resolve_session_file(&link.to_string_lossy(), SessionFileMode::Write).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn feature_record(data_dir: &Path) -> Feature {
        use crate::model::FeatureRoot;

        Feature {
            id: "feat-borrar".into(),
            name: "Borrar".into(),
            kind: "feature".into(),
            flow: "standard".into(),
            status: "confirmed".into(),
            brief: "demo".into(),
            issue: None,
            directory: data_dir
                .join("features/feat-borrar")
                .to_string_lossy()
                .to_string(),
            root: Some(FeatureRoot {
                repo_id: None,
                name: "Repo".into(),
                repo_path: data_dir.join("repo").to_string_lossy().to_string(),
                base_branch: "main".into(),
                branch: "feature/demo".into(),
                relative_path: "meta".into(),
                bootstrap: Vec::new(),
            }),
            targets: Vec::new(),
            steps: Vec::new(),
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn el_registro_se_queda_si_falla_la_limpieza_y_se_va_al_reintentar() {
        let data_dir = temp_dir("borrar-feature");
        fs::create_dir_all(&data_dir).unwrap();
        let state = AppState::load(data_dir.clone());
        let feature = feature_record(&data_dir);
        // Carpeta existente pero no registrada como worktree: limpieza fallida.
        fs::create_dir_all(Path::new(&feature.directory).join("meta")).unwrap();
        state.features.lock().unwrap().push(feature.clone());

        let failed = delete_feature_inner(&state, feature.clone(), false).unwrap();
        assert!(!failed.feature_deleted);
        assert_eq!(state.features.lock().unwrap().len(), 1);

        fs::remove_dir_all(Path::new(&feature.directory).join("meta")).unwrap();
        let retried = delete_feature_inner(&state, feature, false).unwrap();
        assert!(retried.feature_deleted, "{:?}", retried.errors);
        assert!(state.features.lock().unwrap().is_empty());
        assert!(!Path::new(&data_dir.join("features/feat-borrar")).exists());

        fs::remove_dir_all(&data_dir).ok();
    }
}
