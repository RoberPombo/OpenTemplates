use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::model::{AppSettings, ProfileManifest, ProfileStore, RepoStore, WorkspaceStore};

pub const STORE_VERSION: u32 = 2;

pub const WORKSPACES_FILE: &str = "workspaces.json";
pub const REPOS_FILE: &str = "repos.json";
pub const PROFILES_FILE: &str = "profiles.json";
const LEGACY_PROFILES_FILE: &str = "templates.json";
const LEGACY_PROFILES_DIR: &str = "templates";
pub const SETTINGS_FILE: &str = "settings.json";

fn now_stamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Escritura atómica con temporal en el mismo directorio.
pub fn write_json<T: Serialize>(dir: &Path, file: &str, value: &T) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    let raw = serde_json::to_string_pretty(value)
        .map_err(|e| format!("No se pudo serializar {file}: {e}"))?;
    let tmp = dir.join(format!(".{file}.tmp"));
    let path = dir.join(file);
    fs::write(&tmp, raw).map_err(|e| format!("No se pudo escribir {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("No se pudo guardar {file}: {e}"))?;
    Ok(())
}

fn backup(path: &Path, suffix: &str) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let target = path.with_file_name(format!("{name}.{suffix}"));
    fs::rename(path, &target).ok()?;
    Some(target)
}

/// Carga `workspaces.json` y migra el store v1 al v2.
///
/// Si el fichero no se puede interpretar se aparta (`.broken-<ts>`) y se empieza
/// vacío: el store v1 no tenía datos que merezca la pena rescatar a mano.
pub fn load_workspaces(data_dir: &Path) -> (Vec<crate::model::Workspace>, Vec<String>) {
    let path = data_dir.join(WORKSPACES_FILE);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return (Vec::new(), Vec::new()),
    };
    let parsed: WorkspaceStore = match serde_json::from_str(&raw) {
        Ok(parsed) => parsed,
        Err(err) => {
            let backup = backup(&path, &format!("broken-{}", now_stamp()));
            let note = match backup {
                Some(backup) => format!(
                    "workspaces.json inválido ({err}); se apartó en {}",
                    backup.display()
                ),
                None => format!("workspaces.json inválido ({err}); se ignoró"),
            };
            return (Vec::new(), vec![note]);
        }
    };

    let mut warnings = Vec::new();
    if parsed.version < STORE_VERSION {
        if let Some(backup) = backup(&path, "v1.bak") {
            warnings.push(format!(
                "Store v1 detectado; copia en {}. Migrado a v{}.",
                backup.display(),
                STORE_VERSION
            ));
        } else {
            warnings.push(format!("Store v1 detectado; migrado a v{}.", STORE_VERSION));
        }
        let store = WorkspaceStore {
            version: STORE_VERSION,
            workspaces: parsed.workspaces.clone(),
        };
        if let Err(err) = write_json(data_dir, WORKSPACES_FILE, &store) {
            warnings.push(format!("No se pudo reescribir el store migrado: {err}"));
        }
    } else if parsed.version != STORE_VERSION {
        warnings.push(format!(
            "workspaces.json tiene versión {} (esperada {STORE_VERSION})",
            parsed.version
        ));
    }
    (parsed.workspaces, warnings)
}

pub fn load_repos(data_dir: &Path) -> Vec<crate::model::Repo> {
    read_json::<RepoStore>(&data_dir.join(REPOS_FILE))
        .map(|store| store.repos)
        .unwrap_or_default()
}

pub fn load_profiles(data_dir: &Path) -> (Vec<ProfileManifest>, Vec<String>) {
    let current = data_dir.join(PROFILES_FILE);
    let legacy = data_dir.join(LEGACY_PROFILES_FILE);
    let migrated = !current.exists() && legacy.exists();
    let mut profiles = read_json::<ProfileStore>(&current)
        .or_else(|| read_json::<ProfileStore>(&legacy))
        .map(|store| store.profiles)
        .unwrap_or_default();
    let mut warnings = Vec::new();

    // Migra el directorio anterior la primera vez y conserva sus manifiestos.
    let mut root = data_dir.join("profiles");
    let legacy_root = data_dir.join(LEGACY_PROFILES_DIR);
    if !root.exists() && legacy_root.exists() {
        let _ = fs::rename(&legacy_root, &root);
    }
    if !root.exists() && legacy_root.exists() {
        root = legacy_root;
    }
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let profile_manifest = entry.path().join("profile.json");
            let manifest_path = if profile_manifest.exists() {
                profile_manifest
            } else {
                entry.path().join("template.json")
            };
            let Some(manifest) = read_json::<ProfileManifest>(&manifest_path) else {
                continue;
            };
            if !crate::profiles::is_safe_id(&manifest.id) {
                continue;
            }
            if profiles.iter().any(|item| item.id == manifest.id) {
                continue;
            }
            warnings.push(format!("Perfil '{}' recuperado desde disco", manifest.id));
            profiles.push(manifest);
        }
    }
    profiles.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    if migrated {
        let store = ProfileStore {
            version: STORE_VERSION,
            profiles: profiles.clone(),
        };
        let _ = write_json(data_dir, PROFILES_FILE, &store);
    }
    (profiles, warnings)
}

pub fn load_settings(data_dir: &Path) -> AppSettings {
    read_json::<AppSettings>(&data_dir.join(SETTINGS_FILE)).unwrap_or_else(|| {
        let settings = AppSettings::default();
        let _ = write_json(data_dir, SETTINGS_FILE, &settings);
        settings
    })
}

pub fn save_workspaces(
    data_dir: &Path,
    workspaces: &[crate::model::Workspace],
) -> Result<(), String> {
    let store = WorkspaceStore {
        version: STORE_VERSION,
        workspaces: workspaces.to_vec(),
    };
    write_json(data_dir, WORKSPACES_FILE, &store)
}

pub fn save_repos(data_dir: &Path, repos: &[crate::model::Repo]) -> Result<(), String> {
    let store = RepoStore {
        version: STORE_VERSION,
        repos: repos.to_vec(),
    };
    write_json(data_dir, REPOS_FILE, &store)
}

pub fn save_profiles(data_dir: &Path, profiles: &[ProfileManifest]) -> Result<(), String> {
    let store = ProfileStore {
        version: STORE_VERSION,
        profiles: profiles.to_vec(),
    };
    write_json(data_dir, PROFILES_FILE, &store)
}

pub fn save_settings(data_dir: &Path, settings: &AppSettings) -> Result<(), String> {
    write_json(data_dir, SETTINGS_FILE, settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::WorkspaceMode;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "opentemplates-store-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn migrates_a_v1_workspace_store() {
        let dir = temp_dir("migrate");
        let v1 = serde_json::json!({
            "version": 1,
            "workspaces": [{
                "id": "abc",
                "name": "programar",
                "projectPath": "/tmp/project",
                "mcpNames": ["alpha"],
                "skills": [],
                "model": null,
                "createdAt": 1,
                "updatedAt": 2
            }]
        });
        fs::write(
            dir.join(WORKSPACES_FILE),
            serde_json::to_string_pretty(&v1).unwrap(),
        )
        .unwrap();

        let (workspaces, warnings) = load_workspaces(&dir);

        assert_eq!(workspaces.len(), 1);
        assert_eq!(workspaces[0].name, "programar");
        assert_eq!(workspaces[0].mcp_names, vec!["alpha".to_string()]);
        assert_eq!(workspaces[0].mode, WorkspaceMode::Adhoc);
        assert!(!warnings.is_empty());
        assert!(dir.join("workspaces.json.v1.bak").is_file());

        let migrated: WorkspaceStore =
            read_json(&dir.join(WORKSPACES_FILE)).expect("store migrado");
        assert_eq!(migrated.version, STORE_VERSION);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn backs_up_a_broken_store_instead_of_failing() {
        let dir = temp_dir("broken");
        fs::write(dir.join(WORKSPACES_FILE), "{not json").unwrap();

        let (workspaces, warnings) = load_workspaces(&dir);

        assert!(workspaces.is_empty());
        assert_eq!(warnings.len(), 1);
        let backups = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains(".broken-"))
            .count();
        assert_eq!(backups, 1);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn imports_profile_manifests_from_disk() {
        let dir = temp_dir("profiles");
        let tpl = dir.join("profiles").join("backend");
        fs::create_dir_all(&tpl).unwrap();
        fs::write(
            tpl.join("template.json"),
            serde_json::json!({ "id": "backend", "name": "Backend" }).to_string(),
        )
        .unwrap();

        let (profiles, warnings) = load_profiles(&dir);

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].version, 1);
        assert_eq!(warnings.len(), 1);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn migrates_the_legacy_templates_file_to_profiles() {
        let dir = temp_dir("legacy-profiles");
        fs::write(
            dir.join(LEGACY_PROFILES_FILE),
            serde_json::json!({
                "version": STORE_VERSION,
                "templates": [{ "id": "backend", "name": "Backend" }]
            })
            .to_string(),
        )
        .unwrap();

        let (profiles, _) = load_profiles(&dir);

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "backend");
        assert!(dir.join(PROFILES_FILE).exists());
        fs::remove_dir_all(dir).ok();
    }
}
