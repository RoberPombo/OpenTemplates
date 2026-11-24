//! Contextos de opencode: un proceso por huella de configuración.
//!
//! La huella resume todo lo que opencode carga al arrancar (MCPs, plugins,
//! allowlist de skills, AGENTS.md combinado y la raíz del proyecto). Dos
//! workspaces con la misma huella comparten directorio de config, DB y servidor;
//! solo se diferencian en la sesión y el agente que eligen.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Versión del algoritmo de huella. Se sube cuando cambia su entrada, para que
/// ningún contexto antiguo se reutilice por error.
pub const FINGERPRINT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMeta {
    pub version: u32,
    pub hash: String,
    pub root: String,
    #[serde(default)]
    pub workspaces: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

pub fn contexts_root(data_dir: &Path) -> PathBuf {
    data_dir.join("contexts")
}

pub fn context_dir(data_dir: &Path, hash: &str) -> PathBuf {
    contexts_root(data_dir).join(hash)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Huella estable de un contexto: raíz + config renderizada + AGENTS.md combinado.
pub fn fingerprint(root: &str, config: &Value, agents_md: &str) -> String {
    let payload = serde_json::json!({
        "version": FINGERPRINT_VERSION,
        "root": root,
        "config": config,
        "agents": agents_md,
    });
    let bytes = serde_json::to_vec(&payload).unwrap_or_default();
    let digest = Sha256::digest(&bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Huella del contexto tal como se comparte entre perfiles: el modelo no entra,
/// porque se elige por sesión (`session.create` acepta `model`) y no cambia lo
/// que opencode carga al arrancar.
pub fn fingerprint_without_model(root: &str, config: &Value, agents_md: &str) -> String {
    let mut config = config.clone();
    if let Some(object) = config.as_object_mut() {
        object.remove("model");
    }
    fingerprint(root, &config, agents_md)
}

/// Crea (si hace falta) la carpeta del contexto y deja constancia de la raíz.
pub fn ensure(data_dir: &Path, hash: &str, root: &str) -> Result<PathBuf, String> {
    let dir = context_dir(data_dir, hash);
    for sub in ["xdg/opencode", "logs"] {
        let path = dir.join(sub);
        fs::create_dir_all(&path)
            .map_err(|e| format!("No se pudo crear {}: {e}", path.display()))?;
    }
    let now = now_ms();
    let mut meta = read_meta(&dir).unwrap_or_else(|| ContextMeta {
        version: FINGERPRINT_VERSION,
        hash: hash.to_string(),
        root: root.to_string(),
        workspaces: Vec::new(),
        created_at: now,
        updated_at: now,
    });
    meta.hash = hash.to_string();
    meta.root = root.to_string();
    meta.updated_at = now;
    write_meta(&dir, &meta)?;
    Ok(dir)
}

pub fn read_meta(dir: &Path) -> Option<ContextMeta> {
    let raw = fs::read_to_string(dir.join("context.json")).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_meta(dir: &Path, meta: &ContextMeta) -> Result<(), String> {
    let path = dir.join("context.json");
    let pretty = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("No se pudo serializar {}: {e}", path.display()))?;
    fs::write(&path, pretty).map_err(|e| format!("No se pudo escribir {}: {e}", path.display()))
}

/// Asocia un workspace al contexto y devuelve cuántos quedan.
pub fn attach(
    data_dir: &Path,
    hash: &str,
    root: &str,
    workspace_id: &str,
) -> Result<usize, String> {
    let dir = ensure(data_dir, hash, root)?;
    let mut meta = read_meta(&dir).unwrap_or_else(|| ContextMeta {
        version: FINGERPRINT_VERSION,
        hash: hash.to_string(),
        root: root.to_string(),
        workspaces: Vec::new(),
        created_at: now_ms(),
        updated_at: now_ms(),
    });
    if !meta.workspaces.iter().any(|id| id == workspace_id) {
        meta.workspaces.push(workspace_id.to_string());
    }
    meta.updated_at = now_ms();
    write_meta(&dir, &meta)?;
    Ok(meta.workspaces.len())
}

/// Desasocia un workspace y devuelve cuántos quedan.
pub fn detach(data_dir: &Path, hash: &str, workspace_id: &str) -> Result<usize, String> {
    let dir = context_dir(data_dir, hash);
    let Some(mut meta) = read_meta(&dir) else {
        return Ok(0);
    };
    meta.workspaces.retain(|id| id != workspace_id);
    meta.updated_at = now_ms();
    write_meta(&dir, &meta)?;
    Ok(meta.workspaces.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fingerprint_is_stable_and_sensitive_to_every_input() {
        let config = json!({ "model": "a/b", "permissions": [] });
        let base = fingerprint("/repo", &config, "# AGENTS");

        assert_eq!(base, fingerprint("/repo", &config, "# AGENTS"));
        assert_ne!(base, fingerprint("/otro", &config, "# AGENTS"));
        assert_ne!(
            base,
            fingerprint(
                "/repo",
                &json!({ "model": "c/d", "permissions": [] }),
                "# AGENTS"
            )
        );
        assert_ne!(base, fingerprint("/repo", &config, "# Otro AGENTS"));
    }

    #[test]
    fn model_does_not_change_the_shared_fingerprint() {
        let first = json!({ "model": "anthropic/a", "permissions": [] });
        let second = json!({ "model": "openai/b", "permissions": [] });

        assert_eq!(
            fingerprint_without_model("/repo", &first, "# AGENTS"),
            fingerprint_without_model("/repo", &second, "# AGENTS")
        );
        assert_ne!(
            fingerprint_without_model("/repo", &first, "# AGENTS"),
            fingerprint_without_model(
                "/repo",
                &json!({ "model": "anthropic/a", "permissions": [{"action":"skill"}] }),
                "# AGENTS"
            )
        );
    }

    #[test]
    fn attach_and_detach_keep_a_reference_count() {
        let dir = std::env::temp_dir().join(format!(
            "opentemplates-context-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let hash = "abc123";

        assert_eq!(attach(&dir, hash, "/repo", "w1").unwrap(), 1);
        assert_eq!(attach(&dir, hash, "/repo", "w2").unwrap(), 2);
        assert_eq!(attach(&dir, hash, "/repo", "w2").unwrap(), 2);
        assert_eq!(detach(&dir, hash, "w1").unwrap(), 1);
        assert_eq!(detach(&dir, hash, "w2").unwrap(), 0);

        let meta = read_meta(&context_dir(&dir, hash)).unwrap();
        assert_eq!(meta.root, "/repo");
        assert!(meta.workspaces.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }
}
