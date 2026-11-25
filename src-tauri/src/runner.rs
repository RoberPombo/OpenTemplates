//! Motor compartido de contextos y servidores opencode.
//!
//! Un contexto se materializa a partir de un `Workspace` (real o sintético) y
//! una raíz estable. El servidor se reutiliza por huella y admite varios dueños:
//! workspaces y features. Así el coordinador no necesita un workspace propio ni
//! aparece en las listas de workspaces.
use std::path::{Path, PathBuf};

use tauri::State;

use crate::config;
use crate::context;
use crate::model::{ServerInfo, Workspace};
use crate::server::{self, ServerHandle};
use crate::state::AppState;

/// Dueño de un contexto/servidor arrancado.
#[derive(Debug, Clone)]
pub enum Owner {
    Workspace(String),
    Feature(String),
}

impl Owner {
    pub fn id(&self) -> &str {
        match self {
            Owner::Workspace(id) | Owner::Feature(id) => id,
        }
    }

    fn is_feature(&self) -> bool {
        matches!(self, Owner::Feature(_))
    }

    fn attach(&self, handle: &mut ServerHandle) {
        let list = if self.is_feature() {
            &mut handle.features
        } else {
            &mut handle.workspaces
        };
        if !list.iter().any(|id| id == self.id()) {
            list.push(self.id().to_string());
        }
    }

    /// Quita el dueño; devuelve `true` si el servidor se queda sin dueños.
    fn detach(&self, handle: &mut ServerHandle) -> bool {
        if self.is_feature() {
            handle.features.retain(|id| id != self.id());
        } else {
            handle.workspaces.retain(|id| id != self.id());
        }
        handle.features.is_empty() && handle.workspaces.is_empty()
    }
}

pub struct MaterializedContext {
    pub hash: String,
    pub dir: PathBuf,
    pub materialized: config::Materialized,
}

pub fn find_opencode_bin() -> Option<PathBuf> {
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

/// Materializa la config de un `Workspace` en su contexto y devuelve la huella.
pub fn materialize(
    data_dir: &Path,
    workspace: &Workspace,
    workspace_dir: &Path,
    root: &str,
) -> Result<MaterializedContext, String> {
    let (global, error) = config::read_global_config();
    let global_dir = config::global_config_dir();
    let plan = config::plan(workspace, workspace_dir, &global_dir, &global);
    let hash = context::fingerprint_without_model(root, &plan.config, &plan.agents_md);
    let dir = context::ensure(data_dir, &hash, root)?;
    let mut materialized = config::write_plan(workspace, workspace_dir, &dir, &plan)?;
    if let Some(error) = error {
        materialized.warnings.push(error);
    }
    Ok(MaterializedContext {
        hash,
        dir,
        materialized,
    })
}

pub fn info_for(owner: &Owner, handle: &mut ServerHandle) -> Option<ServerInfo> {
    Some(ServerInfo {
        workspace_id: owner.id().to_string(),
        context_hash: handle.context_hash.clone(),
        base_url: format!("http://127.0.0.1:{}", handle.port),
        password: handle.password.clone(),
        port: handle.port,
        pid: handle.child.id().unwrap_or(0),
        model: handle.model.clone(),
        models: handle.models.clone(),
    })
}

/// Arranca (o reutiliza) el servidor del contexto y registra al dueño.
pub async fn ensure_server(
    state: &AppState,
    workspace: &Workspace,
    hash: &str,
    context_dir: &Path,
    owner: Owner,
) -> Result<ServerInfo, String> {
    let mut dead = None;
    {
        let mut servers = state.servers.lock().map_err(|_| "estado bloqueado")?;
        let alive = servers.get_mut(hash).map(server::is_alive).unwrap_or(false);
        if alive {
            let handle = servers.get_mut(hash).expect("servidor comprobado");
            owner.attach(handle);
            return info_for(&owner, handle).ok_or_else(|| "El servidor no tiene PID".into());
        }
        if servers.contains_key(hash) {
            dead = servers.remove(hash);
        }
    }
    if let Some(handle) = dead {
        server::stop(handle).await;
    }

    let bin = find_opencode_bin()
        .ok_or("No se encontró el binario de opencode. Define OPENCODE_BIN.")?;
    let (mut handle, _) = server::spawn(workspace, context_dir, &bin, hash).await?;
    owner.attach(&mut handle);
    let info = info_for(&owner, &mut handle).ok_or("El servidor no tiene PID")?;
    state
        .servers
        .lock()
        .map_err(|_| "estado bloqueado")?
        .insert(hash.to_string(), handle);
    Ok(info)
}

/// Estado del servidor si el dueño está enganchado a uno vivo.
pub fn status_for_owner(state: &AppState, owner: &Owner) -> Option<ServerInfo> {
    let mut servers = state.servers.lock().ok()?;
    for handle in servers.values_mut() {
        let attached = if owner.is_feature() {
            handle.features.iter().any(|id| id == owner.id())
        } else {
            handle.workspaces.iter().any(|id| id == owner.id())
        };
        if attached && server::is_alive(handle) {
            return info_for(owner, handle);
        }
    }
    None
}

/// Suelta al dueño y para el proceso solo si ya no queda nadie usándolo.
pub async fn stop_owner(state: State<'_, AppState>, owner: Owner) -> Result<(), String> {
    let mut stopped = None;
    let mut hashes = Vec::new();
    {
        let mut servers = state.servers.lock().map_err(|_| "estado bloqueado")?;
        let keys: Vec<String> = servers
            .iter()
            .filter(|(_, handle)| {
                if owner.is_feature() {
                    handle.features.iter().any(|id| id == owner.id())
                } else {
                    handle.workspaces.iter().any(|id| id == owner.id())
                }
            })
            .map(|(key, _)| key.clone())
            .collect();
        for key in keys {
            hashes.push(key.clone());
            let mut empty = false;
            if let Some(handle) = servers.get_mut(&key) {
                empty = owner.detach(handle);
            }
            if empty {
                stopped = servers.remove(&key);
            }
        }
    }
    if let Some(handle) = stopped {
        server::stop(handle).await;
    }
    for hash in hashes {
        let _ = context::detach(&state.data_dir, &hash, owner.id());
    }
    Ok(())
}
