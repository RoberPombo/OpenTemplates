//! Runner del coordinador: materializa la config de una feature en su propio
//! contexto y arranca un servidor sin crear un workspace. El coordinador vive
//! en la raíz de la feature y usa el perfil barato que elija la UI.
use std::fs;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::config;
use crate::context;
use crate::model::{Feature, FeatureRunnerInfo, ProfileManifest, Workspace, WorkspaceMode};
use crate::profiles;
use crate::runner::{self, Owner};
use crate::state::AppState;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn feature_of(state: &AppState, id: &str) -> Result<Feature, String> {
    state
        .features
        .lock()
        .map_err(|_| "estado bloqueado")?
        .iter()
        .find(|feature| feature.id == id)
        .cloned()
        .ok_or_else(|| format!("La feature '{id}' no existe"))
}

/// Carpeta de trabajo del coordinador: el worktree de la raíz si existe; si no,
/// la carpeta de la feature (repos sueltos).
pub fn coordinator_directory(feature: &Feature) -> PathBuf {
    match &feature.root {
        Some(root) => Path::new(&feature.directory).join(&root.relative_path),
        None => PathBuf::from(&feature.directory),
    }
}

/// Raíz estable para la huella: checkout principal del metarepo o la carpeta de
/// la feature.
fn fingerprint_root(feature: &Feature, directory: &Path) -> String {
    let seed = feature
        .root
        .as_ref()
        .map(|root| PathBuf::from(&root.repo_path))
        .unwrap_or_else(|| directory.to_path_buf());
    fs::canonicalize(&seed)
        .unwrap_or(seed)
        .to_string_lossy()
        .to_string()
}

/// Directorio interno del runner: lock de perfil separado de los artefactos y
/// de los worktrees de la feature.
fn runner_state_dir(data_dir: &Path, feature_id: &str) -> PathBuf {
    data_dir.join("features").join(feature_id).join(".runner")
}

fn coordinator_id(
    state: &AppState,
    feature: &Feature,
    requested: Option<&str>,
) -> Result<Option<String>, String> {
    let profiles = state.profiles.lock().map_err(|_| "estado bloqueado")?;
    let exists = |id: &str| profiles.iter().any(|profile| profile.id == id);
    if let Some(id) = requested.filter(|id| exists(id)) {
        return Ok(Some(id.to_string()));
    }
    let coordinate = feature.steps.iter().find(|step| step.step_type == "coordinate");
    if let Some(id) = coordinate.and_then(|step| step.profile_id.as_deref())
        && exists(id)
    {
        return Ok(Some(id.to_string()));
    }
    if let Some(named) = profiles.iter().find(|profile| {
        let label = format!("{} {}", profile.id, profile.name).to_lowercase();
        label.contains("coordinador") || label.contains("coordinator")
    }) {
        return Ok(Some(named.id.clone()));
    }
    let default = state
        .settings
        .lock()
        .ok()
        .and_then(|settings| settings.default_profile_id.clone());
    if let Some(id) = default.filter(|id| exists(id)) {
        return Ok(Some(id));
    }
    Ok(profiles.first().map(|profile| profile.id.clone()))
}

fn manifest_of(state: &AppState, id: &str) -> Result<Option<ProfileManifest>, String> {
    Ok(state
        .profiles
        .lock()
        .map_err(|_| "estado bloqueado")?
        .iter()
        .find(|profile| profile.id == id)
        .cloned())
}

fn coordinator_workspace(
    feature: &Feature,
    directory: &Path,
    profile_id: Option<&str>,
) -> Workspace {
    Workspace {
        id: feature.id.clone(),
        name: format!("{} · coordinador", feature.name),
        repo_id: feature.root.as_ref().and_then(|root| root.repo_id.clone()),
        project_path: directory.to_string_lossy().to_string(),
        mode: WorkspaceMode::Worktree,
        branch: feature.root.as_ref().map(|root| root.branch.clone()),
        worktree_path: Some(directory.to_string_lossy().to_string()),
        profile_id: profile_id.map(|id| id.to_string()),
        issue: feature.issue.clone(),
        created_at: now_ms(),
        updated_at: now_ms(),
        ..Workspace::default()
    }
}

fn apply_lock(
    workspace: &mut Workspace,
    manifest: &ProfileManifest,
    lock: &crate::model::ProfileLock,
) {
    workspace.mcp_names = manifest.mcps.clone();
    workspace.skills = lock.skills.clone();
    workspace.agents = lock.agents.clone();
    workspace.commands = lock.commands.clone();
    workspace.plugins = lock.plugins.clone();
    workspace.model = lock.model.clone();
    workspace.models = lock.models.clone();
}

#[tauri::command]
pub async fn start_feature_runner(
    state: State<'_, AppState>,
    feature_id: String,
    profile_id: Option<String>,
) -> Result<FeatureRunnerInfo, String> {
    let feature = feature_of(&state, &feature_id)?;
    if feature.flow != "standard" {
        return Err("El flujo rápido no tiene coordinador.".into());
    }
    let directory = coordinator_directory(&feature);
    if !directory.is_dir() {
        return Err(format!(
            "Prepara los worktrees de la feature antes de abrir el coordinador ({}).",
            directory.display()
        ));
    }
    let root = fingerprint_root(&feature, &directory);
    let mut workspace = coordinator_workspace(&feature, &directory, profile_id.as_deref());
    let state_dir = runner_state_dir(&state.data_dir, &feature.id);
    fs::create_dir_all(&state_dir).map_err(|e| format!("No se pudo crear {}: {e}", state_dir.display()))?;

    let chosen = coordinator_id(&state, &feature, profile_id.as_deref())?;
    let manifest = match chosen.as_deref() {
        Some(id) => manifest_of(&state, id)?.ok_or_else(|| format!("El perfil '{id}' no existe"))?,
        None => {
            return Err("Crea un perfil de coordinador antes de lanzar la sesión.".into());
        }
    };
    let (lock, mut warnings) = profiles::freeze(&manifest, &state.profiles_root())?;
    apply_lock(&mut workspace, &manifest, &lock);
    profiles::write_lock(&state_dir, &lock)?;

    let (global, global_error) = config::read_global_config();
    let global_dir = config::global_config_dir();
    let plan = config::plan_with_lock(&workspace, Some(lock), &global_dir, &global);
    let hash = context::fingerprint_without_model(&root, &plan.config, &plan.agents_md);
    let context_dir = context::ensure(&state.data_dir, &hash, &root)?;
    let materialized = config::write_plan(&workspace, &state_dir, &context_dir, &plan)?;
    warnings.extend(materialized.warnings);
    if let Some(error) = global_error {
        warnings.push(error);
    }
    context::attach(&state.data_dir, &hash, &root, &feature.id)?;

    let mut info = runner::ensure_server(
        &state,
        &workspace,
        &hash,
        &context_dir,
        Owner::Feature(feature.id.clone()),
    )
    .await?;
    info.model = workspace.model.clone();
    info.models = workspace.models.clone();
    for warning in &warnings {
        eprintln!("[opentemplates] {}", warning);
    }

    Ok(FeatureRunnerInfo {
        feature_id: feature.id,
        profile_id: workspace.profile_id,
        directory: directory.to_string_lossy().to_string(),
        context_hash: hash,
        server: info,
        warnings,
    })
}

#[tauri::command]
pub fn feature_runner_status(
    state: State<'_, AppState>,
    feature_id: String,
) -> Result<Option<FeatureRunnerInfo>, String> {
    let feature = feature_of(&state, &feature_id)?;
    let Some(mut server) = runner::status_for_owner(&state, &Owner::Feature(feature.id.clone()))
    else {
        return Ok(None);
    };
    let coordinate = feature.steps.iter().find(|step| step.step_type == "coordinate");
    // La sesión puede compartir servidor con otros dueños; el modelo del
    // coordinador se lee de su lock congelado, no del handle compartido.
    if let Some(lock) = profiles::read_lock(&runner_state_dir(&state.data_dir, &feature.id)) {
        server.model = lock.model.clone();
        server.models = lock.models.clone();
    }
    let directory = coordinator_directory(&feature).to_string_lossy().to_string();
    Ok(Some(FeatureRunnerInfo {
        feature_id: feature.id,
        profile_id: coordinate.and_then(|step| step.profile_id.clone()),
        directory,
        context_hash: server.context_hash.clone(),
        server,
        warnings: Vec::new(),
    }))
}

#[tauri::command]
pub async fn stop_feature_runner(
    state: State<'_, AppState>,
    feature_id: String,
) -> Result<(), String> {
    runner::stop_owner(state, Owner::Feature(feature_id)).await
}
