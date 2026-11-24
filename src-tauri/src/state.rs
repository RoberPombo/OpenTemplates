use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::model::{AppSettings, ProfileManifest, Repo, Workspace};
use crate::server::ServerHandle;
use crate::store;

pub struct AppState {
    pub data_dir: PathBuf,
    pub workspaces: Mutex<Vec<Workspace>>,
    pub repos: Mutex<Vec<Repo>>,
    pub profiles: Mutex<Vec<ProfileManifest>>,
    pub settings: Mutex<AppSettings>,
    pub servers: Mutex<HashMap<String, ServerHandle>>,
    pub notices: Mutex<Vec<String>>,
}

impl AppState {
    pub fn load(data_dir: PathBuf) -> Self {
        let (workspaces, mut notices) = store::load_workspaces(&data_dir);
        let repos = store::load_repos(&data_dir);
        let (profiles, profile_notices) = store::load_profiles(&data_dir);
        notices.extend(profile_notices);
        let settings = store::load_settings(&data_dir);
        Self {
            data_dir,
            workspaces: Mutex::new(workspaces),
            repos: Mutex::new(repos),
            profiles: Mutex::new(profiles),
            settings: Mutex::new(settings),
            servers: Mutex::new(HashMap::new()),
            notices: Mutex::new(notices),
        }
    }

    pub fn profiles_root(&self) -> PathBuf {
        crate::profiles::profiles_dir(&self.data_dir)
    }

    /// Raíz configurable de worktrees; por defecto `<appdata>/worktrees`.
    pub fn worktrees_root(&self) -> PathBuf {
        let configured = self
            .settings
            .lock()
            .ok()
            .and_then(|settings| settings.worktrees_root.clone())
            .filter(|root| !root.trim().is_empty());
        let root = match configured {
            Some(root) => expand_tilde(&root),
            None => self.data_dir.join("worktrees"),
        };
        let _ = fs::create_dir_all(&root);
        root
    }

    pub fn save(&self) -> Result<(), String> {
        let workspaces = self
            .workspaces
            .lock()
            .map_err(|_| "estado bloqueado")?
            .clone();
        let repos = self.repos.lock().map_err(|_| "estado bloqueado")?.clone();
        let profiles = self
            .profiles
            .lock()
            .map_err(|_| "estado bloqueado")?
            .clone();
        let settings = self
            .settings
            .lock()
            .map_err(|_| "estado bloqueado")?
            .clone();

        store::save_workspaces(&self.data_dir, &workspaces)?;
        store::save_repos(&self.data_dir, &repos)?;
        store::save_profiles(&self.data_dir, &profiles)?;
        store::save_settings(&self.data_dir, &settings)?;
        Ok(())
    }

    pub fn kill_all(&self) {
        if let Ok(mut servers) = self.servers.lock() {
            for (_, mut handle) in servers.drain() {
                crate::server::terminate(&mut handle.child);
            }
        }
    }
}

pub fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/")
        && let Some(home) = dirs::home_dir()
    {
        return home.join(rest);
    }
    PathBuf::from(path)
}

pub fn ensure_workspace_dir(data_dir: &Path, id: &str) -> PathBuf {
    let dir = data_dir.join("workspaces").join(id);
    let _ = fs::create_dir_all(dir.join("xdg/opencode"));
    let _ = fs::create_dir_all(dir.join("logs"));
    dir
}
