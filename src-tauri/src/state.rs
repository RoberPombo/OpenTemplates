use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use crate::model::{AppSettings, Feature, ProfileManifest, Repo, Workspace};
use crate::server::ServerHandle;
use crate::store;

/// Un ticket de sesión solo sirve para la operación y la ruta exactas que el
/// usuario eligió en el diálogo nativo. Caduca para no dejar autorizaciones
/// vivas si la UI se queda a medias.
pub const SESSION_TICKET_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionFileMode {
    Read,
    Write,
}

impl SessionFileMode {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "read" => Some(Self::Read),
            "write" => Some(Self::Write),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
struct SessionFileTicket {
    mode: SessionFileMode,
    path: PathBuf,
    expires_at: SystemTime,
}

pub struct AppState {
    pub data_dir: PathBuf,
    pub workspaces: Mutex<Vec<Workspace>>,
    pub repos: Mutex<Vec<Repo>>,
    pub features: Mutex<Vec<Feature>>,
    pub profiles: Mutex<Vec<ProfileManifest>>,
    pub settings: Mutex<AppSettings>,
    pub servers: Mutex<HashMap<String, ServerHandle>>,
    pub notices: Mutex<Vec<String>>,
    session_tickets: Mutex<HashMap<String, SessionFileTicket>>,
}

impl AppState {
    pub fn load(data_dir: PathBuf) -> Self {
        let (workspaces, mut notices) = store::load_workspaces(&data_dir);
        let repos = store::load_repos(&data_dir);
        let (features, feature_notices) = store::load_features(&data_dir);
        notices.extend(feature_notices);
        let (profiles, profile_notices) = store::load_profiles(&data_dir);
        notices.extend(profile_notices);
        let settings = store::load_settings(&data_dir);
        Self {
            data_dir,
            workspaces: Mutex::new(workspaces),
            repos: Mutex::new(repos),
            features: Mutex::new(features),
            profiles: Mutex::new(profiles),
            settings: Mutex::new(settings),
            servers: Mutex::new(HashMap::new()),
            notices: Mutex::new(notices),
            session_tickets: Mutex::new(HashMap::new()),
        }
    }

    /// Emite un token de un solo uso para la ruta canónica elegida en el
    /// diálogo nativo. Se guarda en memoria y no se persiste en disco.
    pub fn issue_session_ticket(
        &self,
        mode: SessionFileMode,
        path: PathBuf,
    ) -> Result<String, String> {
        let now = SystemTime::now();
        let mut tickets = self
            .session_tickets
            .lock()
            .map_err(|_| "estado bloqueado")?;
        tickets.retain(|_, ticket| ticket.expires_at > now);
        let token = uuid::Uuid::new_v4().simple().to_string();
        tickets.insert(
            token.clone(),
            SessionFileTicket {
                mode,
                path,
                expires_at: now + SESSION_TICKET_TTL,
            },
        );
        Ok(token)
    }

    /// Consume el token y comprueba que corresponde a esta operación y a la
    /// misma ruta canónica. Se elimina siempre, incluso si no valida, para que
    /// un token no se pueda reintentar.
    pub fn consume_session_ticket(
        &self,
        token: &str,
        mode: SessionFileMode,
        path: &Path,
    ) -> Result<(), String> {
        let mut tickets = self
            .session_tickets
            .lock()
            .map_err(|_| "estado bloqueado")?;
        let Some(ticket) = tickets.remove(token) else {
            return Err("Token de sesión inválido o ya usado".into());
        };
        if ticket.expires_at <= SystemTime::now() {
            return Err("El token de sesión ha caducado".into());
        }
        if ticket.mode != mode {
            return Err("El token no autoriza esta operación".into());
        }
        if ticket.path != path {
            return Err("La ruta no coincide con la elegida en el diálogo".into());
        }
        Ok(())
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
        let features = self
            .features
            .lock()
            .map_err(|_| "estado bloqueado")?
            .clone();
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
        store::save_features(&self.data_dir, &features)?;
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
