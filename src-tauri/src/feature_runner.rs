//! Runner de la feature: materializa la config de un perfil en su propio
//! contexto y arranca un servidor sin crear un workspace. El coordinador vive
//! en la raíz de la feature; cada paso vive en su worktree y conserva el lock
//! de su perfil por separado para no pisar el del coordinador.
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config;
use crate::context;
use crate::model::{
    Feature, FeatureRunnerInfo, FeatureStep, ProfileManifest, Workspace, WorkspaceMode,
};
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

/// Raíz estable para la huella: checkout principal del metarepo o la carpeta
/// que se pase (la carpeta de la feature o el worktree sin raíz).
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

fn sanitize_step_id(step_id: &str) -> String {
    let mut safe = String::new();
    let mut dash = false;
    for ch in step_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            safe.push(ch);
            dash = false;
        } else if !dash {
            safe.push('-');
            dash = true;
        }
    }
    let trimmed = safe.trim_matches('-');
    if trimmed.is_empty() {
        "step".into()
    } else {
        trimmed.chars().take(96).collect()
    }
}

fn step_state_dir(data_dir: &Path, feature_id: &str, step_id: &str) -> PathBuf {
    runner_state_dir(data_dir, feature_id)
        .join("steps")
        .join(sanitize_step_id(step_id))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerState {
    context_hash: String,
}

fn runner_state_path(data_dir: &Path, feature_id: &str) -> PathBuf {
    runner_state_dir(data_dir, feature_id).join("runner.json")
}

fn write_runner_hash(data_dir: &Path, feature_id: &str, hash: &str) -> Result<(), String> {
    let dir = runner_state_dir(data_dir, feature_id);
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    let path = runner_state_path(data_dir, feature_id);
    let raw = serde_json::to_string_pretty(&RunnerState {
        context_hash: hash.to_string(),
    })
    .map_err(|e| format!("No se pudo serializar {}: {e}", path.display()))?;
    fs::write(&path, raw).map_err(|e| format!("No se pudo escribir {}: {e}", path.display()))
}

fn read_runner_hash(data_dir: &Path, feature_id: &str) -> Option<String> {
    let raw = fs::read_to_string(runner_state_path(data_dir, feature_id)).ok()?;
    serde_json::from_str::<RunnerState>(&raw)
        .ok()
        .map(|state| state.context_hash)
}

/// Worktree donde corre un paso: el target si lo tiene; la raíz para los pasos
/// de feature. El scope no cambia el `cwd`, va en el encargo.
pub(crate) fn step_directory(feature: &Feature, step: &FeatureStep) -> Result<PathBuf, String> {
    if let Some(target_id) = step.target_id.as_deref() {
        let target = feature
            .targets
            .iter()
            .find(|target| target.id == target_id)
            .ok_or_else(|| format!("El target '{target_id}' no existe en la feature"))?;
        return crate::features::safe_join(Path::new(&feature.directory), &target.relative_path);
    }
    Ok(coordinator_directory(feature))
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
    let coordinate = feature
        .steps
        .iter()
        .find(|step| step.step_type == "coordinate");
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

fn step_profile_id(
    state: &AppState,
    feature: &Feature,
    step: &FeatureStep,
    requested: Option<&str>,
) -> Result<Option<String>, String> {
    let exists = |id: &str| {
        state
            .profiles
            .lock()
            .map(|profiles| profiles.iter().any(|profile| profile.id == id))
            .unwrap_or(false)
    };
    if let Some(id) = requested.filter(|id| exists(id)) {
        return Ok(Some(id.to_string()));
    }
    if let Some(id) = step.profile_id.as_deref().filter(|id| exists(id)) {
        return Ok(Some(id.to_string()));
    }
    coordinator_id(state, feature, None)
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

fn feature_workspace(
    feature: &Feature,
    directory: &Path,
    profile_id: Option<&str>,
    name: String,
    branch: Option<String>,
) -> Workspace {
    Workspace {
        id: feature.id.clone(),
        name,
        repo_id: feature.root.as_ref().and_then(|root| root.repo_id.clone()),
        project_path: directory.to_string_lossy().to_string(),
        mode: WorkspaceMode::Worktree,
        branch,
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

async fn start_runner(
    state: &AppState,
    feature: &Feature,
    mut workspace: Workspace,
    workspace_dir: &Path,
    session_directory: &Path,
    state_dir: &Path,
    chosen: Option<String>,
) -> Result<FeatureRunnerInfo, String> {
    let profile_id =
        chosen.ok_or_else(|| "Crea un perfil antes de lanzar la sesión.".to_string())?;
    let manifest = manifest_of(state, &profile_id)?
        .ok_or_else(|| format!("El perfil '{profile_id}' no existe"))?;
    let (lock, mut warnings) = profiles::freeze(&manifest, &state.profiles_root())?;
    apply_lock(&mut workspace, &manifest, &lock);
    profiles::write_lock(state_dir, &lock)?;

    let (global, global_error) = config::read_global_config();
    let global_dir = config::global_config_dir();
    let root = fingerprint_root(feature, workspace_dir);
    let plan = config::plan_with_lock(&workspace, Some(lock), &global_dir, &global);
    let hash = context::fingerprint_without_model(&root, &plan.config, &plan.agents_md);
    let context_dir = context::ensure(&state.data_dir, &hash, &root)?;
    let materialized = config::write_plan(&workspace, state_dir, &context_dir, &plan)?;
    warnings.extend(materialized.warnings);
    if let Some(error) = global_error {
        warnings.push(error);
    }
    context::attach(&state.data_dir, &hash, &root, &feature.id)?;

    let mut info = runner::ensure_server(
        state,
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
        feature_id: feature.id.clone(),
        profile_id: workspace.profile_id,
        directory: session_directory.to_string_lossy().to_string(),
        context_hash: hash,
        server: info,
        warnings,
    })
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
    let state_dir = runner_state_dir(&state.data_dir, &feature.id);
    fs::create_dir_all(&state_dir)
        .map_err(|e| format!("No se pudo crear {}: {e}", state_dir.display()))?;

    let chosen = coordinator_id(&state, &feature, profile_id.as_deref())?;
    let workspace = feature_workspace(
        &feature,
        &directory,
        chosen.as_deref(),
        format!("{} · coordinador", feature.name),
        feature.root.as_ref().map(|root| root.branch.clone()),
    );
    let info = start_runner(
        &state, &feature, workspace, &directory, &directory, &state_dir, chosen,
    )
    .await?;
    write_runner_hash(&state.data_dir, &feature.id, &info.context_hash)?;
    Ok(info)
}

/// Arranca el runner de un paso concreto. Puede compartir servidor con el
/// coordinador si el perfil produce la misma huella; si no, añade otro servidor
/// al mismo dueño. El lock del paso nunca pisa el del coordinador.
#[tauri::command]
pub async fn start_feature_step_runner(
    state: State<'_, AppState>,
    feature_id: String,
    step_id: String,
    profile_id: Option<String>,
) -> Result<FeatureRunnerInfo, String> {
    let feature = feature_of(&state, &feature_id)?;
    let step = feature
        .steps
        .iter()
        .find(|step| step.id == step_id)
        .cloned()
        .ok_or_else(|| format!("El paso '{step_id}' no existe en la feature"))?;
    let directory = step_directory(&feature, &step)?;
    if !directory.is_dir() {
        return Err(format!(
            "Prepara los worktrees de la feature antes de lanzar el paso ({}).",
            directory.display()
        ));
    }
    let state_dir = step_state_dir(&state.data_dir, &feature.id, &step.id);
    fs::create_dir_all(&state_dir)
        .map_err(|e| format!("No se pudo crear {}: {e}", state_dir.display()))?;

    let chosen = step_profile_id(&state, &feature, &step, profile_id.as_deref())?;
    let branch = step
        .target_id
        .as_ref()
        .and_then(|target_id| {
            feature
                .targets
                .iter()
                .find(|target| &target.id == target_id)
        })
        .map(|target| target.branch.clone())
        .or_else(|| feature.root.as_ref().map(|root| root.branch.clone()));
    // Con raíz, el contexto se comparte con el coordinador aunque la sesión viva
    // en el worktree del target; sin raíz, cada repo tiene su propio servidor.
    let workspace_dir = if feature.root.is_some() {
        coordinator_directory(&feature)
    } else {
        directory.clone()
    };
    if !workspace_dir.is_dir() {
        return Err(format!(
            "Prepara el worktree de la raíz antes de lanzar el paso ({}).",
            workspace_dir.display()
        ));
    }
    let workspace = feature_workspace(
        &feature,
        &workspace_dir,
        chosen.as_deref(),
        format!("{} · {}", feature.name, step.step_type),
        branch,
    );
    start_runner(
        &state,
        &feature,
        workspace,
        &workspace_dir,
        &directory,
        &state_dir,
        chosen,
    )
    .await
}

#[tauri::command]
pub fn feature_runner_status(
    state: State<'_, AppState>,
    feature_id: String,
) -> Result<Option<FeatureRunnerInfo>, String> {
    let feature = feature_of(&state, &feature_id)?;
    let hash = read_runner_hash(&state.data_dir, &feature.id);
    if feature.flow != "standard" && hash.is_none() {
        return Ok(None);
    }
    let Some(mut server) =
        runner::status_for_owner_hash(&state, &Owner::Feature(feature.id.clone()), hash.as_deref())
    else {
        return Ok(None);
    };
    let coordinate = feature
        .steps
        .iter()
        .find(|step| step.step_type == "coordinate");
    // La sesión puede compartir servidor con otros dueños; el modelo del
    // coordinador se lee de su lock congelado, no del handle compartido.
    if let Some(lock) = profiles::read_lock(&runner_state_dir(&state.data_dir, &feature.id)) {
        server.model = lock.model.clone();
        server.models = lock.models.clone();
    }
    let directory = coordinator_directory(&feature)
        .to_string_lossy()
        .to_string();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{FeatureRoot, FeatureScope, FeatureTarget};

    fn feature_and_steps() -> (Feature, FeatureStep, FeatureStep) {
        let feature = Feature {
            id: "feat-1".into(),
            name: "Demo".into(),
            kind: "feature".into(),
            flow: "standard".into(),
            status: "running".into(),
            brief: "demo".into(),
            issue: None,
            directory: "/data/features/feat-1".into(),
            root: Some(FeatureRoot {
                repo_id: None,
                name: "Meta".into(),
                repo_path: "/repos/meta".into(),
                base_branch: "main".into(),
                branch: "feature/demo".into(),
                relative_path: "meta".into(),
                bootstrap: Vec::new(),
            }),
            targets: vec![FeatureTarget {
                id: "target-web".into(),
                repo_id: None,
                name: "Web".into(),
                repo_path: "/repos/web".into(),
                base_branch: "main".into(),
                branch: "feature/demo".into(),
                relative_path: "meta/repos/web".into(),
                scopes: vec![FeatureScope {
                    id: "scope-front".into(),
                    path: "front".into(),
                }],
                bootstrap: Vec::new(),
            }],
            steps: Vec::new(),
            created_at: 1,
            updated_at: 1,
        };
        let coordinate = FeatureStep {
            id: "feat-1:coordinate".into(),
            step_type: "coordinate".into(),
            target_id: None,
            scope_id: None,
            profile_id: Some("coord".into()),
            agent_id: None,
            depends_on: Vec::new(),
            status: "done".into(),
            session_id: None,
            context_hash: None,
        };
        let implement = FeatureStep {
            id: "feat-1:implement:target-web:scope-front".into(),
            step_type: "implement".into(),
            target_id: Some("target-web".into()),
            scope_id: Some("scope-front".into()),
            profile_id: None,
            agent_id: None,
            depends_on: Vec::new(),
            status: "pending".into(),
            session_id: None,
            context_hash: None,
        };
        (feature, coordinate, implement)
    }

    #[test]
    fn el_paso_de_target_usa_su_worktree_y_el_de_feature_la_raiz() {
        let (feature, coordinate, implement) = feature_and_steps();
        assert_eq!(
            step_directory(&feature, &coordinate).unwrap(),
            PathBuf::from("/data/features/feat-1/meta")
        );
        assert_eq!(
            step_directory(&feature, &implement).unwrap(),
            PathBuf::from("/data/features/feat-1/meta/repos/web")
        );
    }

    #[test]
    fn el_lock_de_un_paso_no_es_el_del_coordinador() {
        let data = Path::new("/data");
        let coordinator = runner_state_dir(data, "feat-1").join("profile.lock.json");
        let step = step_state_dir(data, "feat-1", "feat-1:implement:web:scope-front")
            .join("profile.lock.json");
        assert_ne!(step, coordinator);
        assert!(step.starts_with("/data/features/feat-1/.runner/steps"));
    }

    #[test]
    fn el_id_del_paso_se_sanea_para_la_ruta() {
        assert_eq!(
            sanitize_step_id("feat-1:implement:target-web:scope-front"),
            "feat-1-implement-target-web-scope-front"
        );
        assert_eq!(sanitize_step_id("::::"), "step");
        assert!(!sanitize_step_id(&"x".repeat(200)).contains('/'));
        assert!(sanitize_step_id(&"x".repeat(200)).len() <= 96);
    }
}
