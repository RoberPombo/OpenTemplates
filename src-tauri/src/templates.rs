use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::library;
use crate::model::{AssetRef, Library, McpInfo, SkillRef, TemplateLock, TemplateManifest};

pub fn templates_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("templates")
}

/// Un id de template nunca puede salir de `templates/`.
pub fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && !id.contains('/')
        && !id.contains('\\')
        && !id.contains("..")
}

pub fn template_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

pub fn manifest_path(root: &Path, id: &str) -> PathBuf {
    template_dir(root, id).join("template.json")
}

pub fn ensure_template_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(id) {
        return Err(format!("Identificador de template no válido: '{id}'"));
    }
    let dir = template_dir(root, id);
    for child in ["", "agents", "commands", "skills", "plugins"] {
        let path = if child.is_empty() {
            dir.clone()
        } else {
            dir.join(child)
        };
        fs::create_dir_all(&path)
            .map_err(|e| format!("No se pudo crear {}: {e}", path.display()))?;
    }
    Ok(dir)
}

pub fn save_manifest(root: &Path, manifest: &TemplateManifest) -> Result<(), String> {
    ensure_template_dir(root, &manifest.id)?;
    let path = manifest_path(root, &manifest.id);
    let raw = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("No se pudo serializar el template: {e}"))?;
    let tmp = path.with_file_name(".template.json.tmp");
    fs::write(&tmp, raw).map_err(|e| format!("No se pudo escribir {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("No se pudo guardar el template: {e}"))?;
    Ok(())
}

pub fn read_manifest(root: &Path, id: &str) -> Option<TemplateManifest> {
    let raw = fs::read_to_string(manifest_path(root, id)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn read_agents_md(root: &Path, id: &str) -> String {
    fs::read_to_string(template_dir(root, id).join("AGENTS.md")).unwrap_or_default()
}

pub fn write_agents_md(root: &Path, id: &str, content: &str) -> Result<(), String> {
    let dir = ensure_template_dir(root, id)?;
    let path = dir.join("AGENTS.md");
    fs::write(&path, content).map_err(|e| format!("No se pudo escribir {}: {e}", path.display()))
}

pub fn remove_template_dir(root: &Path, id: &str) -> Result<(), String> {
    if !is_safe_id(id) {
        return Err(format!("Identificador de template no válido: '{id}'"));
    }
    let dir = template_dir(root, id);
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|e| format!("No se pudo borrar {}: {e}", dir.display()))?;
    }
    Ok(())
}

pub fn lock_path(workspace_dir: &Path) -> PathBuf {
    workspace_dir.join("template.lock.json")
}

pub fn read_lock(workspace_dir: &Path) -> Option<TemplateLock> {
    let raw = fs::read_to_string(lock_path(workspace_dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn write_lock(workspace_dir: &Path, lock: &TemplateLock) -> Result<(), String> {
    fs::create_dir_all(workspace_dir)
        .map_err(|e| format!("No se pudo crear {}: {e}", workspace_dir.display()))?;
    let path = lock_path(workspace_dir);
    let raw = serde_json::to_string_pretty(lock)
        .map_err(|e| format!("No se pudo serializar template.lock.json: {e}"))?;
    let tmp = workspace_dir.join(".template.lock.json.tmp");
    fs::write(&tmp, raw).map_err(|e| format!("No se pudo escribir {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("No se pudo guardar template.lock.json: {e}"))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn resolve_assets(
    ids: &[String],
    own_dir: &Path,
    extension: &str,
    global: &[crate::model::AssetInfo],
    kind: &str,
    warnings: &mut Vec<String>,
) -> Vec<AssetRef> {
    let mut refs = Vec::new();
    for id in ids {
        let own = own_dir.join(format!("{id}.{extension}"));
        if own.is_file() {
            refs.push(AssetRef {
                id: id.clone(),
                path: own.to_string_lossy().to_string(),
                source: "template".into(),
            });
            continue;
        }
        match library::find_asset(global, id) {
            Some(asset) => refs.push(AssetRef {
                id: id.clone(),
                path: asset.path.clone(),
                source: asset.source.clone(),
            }),
            None => warnings.push(format!("El {kind} '{id}' no existe en la biblioteca")),
        }
    }
    refs
}

const PLUGIN_EXTENSIONS: [&str; 5] = ["ts", "tsx", "js", "mjs", "cjs"];

fn resolve_plugins(
    ids: &[String],
    own_dir: &Path,
    global: &[crate::model::AssetInfo],
    warnings: &mut Vec<String>,
) -> Vec<AssetRef> {
    let mut refs = Vec::new();
    for id in ids {
        let own = PLUGIN_EXTENSIONS
            .iter()
            .map(|ext| own_dir.join(format!("{id}.{ext}")))
            .find(|path| path.is_file());
        if let Some(own) = own {
            refs.push(AssetRef {
                id: id.clone(),
                path: own.to_string_lossy().to_string(),
                source: "template".into(),
            });
            continue;
        }
        match library::find_asset(global, id) {
            Some(asset) => refs.push(AssetRef {
                id: id.clone(),
                path: asset.path.clone(),
                source: asset.source.clone(),
            }),
            None => warnings.push(format!("El plugin '{id}' no existe en la biblioteca")),
        }
    }
    refs
}

fn resolve_skills(
    ids: &[String],
    own_dir: &Path,
    global: &[crate::model::SkillInfo],
    warnings: &mut Vec<String>,
) -> Vec<SkillRef> {
    let mut refs = Vec::new();
    for id in ids {
        let own = own_dir.join(id);
        if own.join("SKILL.md").is_file() {
            refs.push(SkillRef {
                id: id.clone(),
                path: own.to_string_lossy().to_string(),
            });
            continue;
        }
        match library::find_skill(global, id) {
            Some(skill) => refs.push(SkillRef {
                id: id.clone(),
                path: skill.path.clone(),
            }),
            None => warnings.push(format!("La skill '{id}' no existe en la biblioteca")),
        }
    }
    refs
}

fn template_mcps(dir: &Path) -> BTreeMap<String, Value> {
    let Ok(raw) = fs::read_to_string(dir.join("mcps.json")) else {
        return BTreeMap::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return BTreeMap::new();
    };
    let Some(object) = value.as_object() else {
        return BTreeMap::new();
    };
    if let Some(servers) = object.get("servers").and_then(Value::as_object) {
        return servers
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
    }
    object
        .iter()
        .filter(|(_, value)| {
            value.is_object()
                && (value.get("type").is_some()
                    || value.get("command").is_some()
                    || value.get("url").is_some())
        })
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect()
}

pub fn resolve_mcps(
    names: &[String],
    template_id: Option<&str>,
    templates_root: &Path,
    global: &[McpInfo],
) -> (BTreeMap<String, Value>, Vec<String>) {
    let own = template_id
        .map(|id| template_mcps(&template_dir(templates_root, id)))
        .unwrap_or_default();
    let mut resolved = BTreeMap::new();
    let mut warnings = Vec::new();
    for name in names {
        if let Some(config) = own.get(name) {
            resolved.insert(name.clone(), config.clone());
            continue;
        }
        match library::find_mcp(global, name) {
            Some(mcp) => {
                resolved.insert(name.clone(), mcp.config.clone());
            }
            None => warnings.push(format!(
                "El MCP '{name}' no existe ni en el template ni en la config global"
            )),
        }
    }
    (resolved, warnings)
}

/// Congela la selección del template para un workspace.
pub fn freeze(
    manifest: &TemplateManifest,
    templates_root: &Path,
) -> Result<(TemplateLock, Vec<String>), String> {
    let lib = library::scan();
    freeze_with(manifest, templates_root, &lib)
}

pub fn freeze_with(
    manifest: &TemplateManifest,
    templates_root: &Path,
    lib: &Library,
) -> Result<(TemplateLock, Vec<String>), String> {
    let dir = ensure_template_dir(templates_root, &manifest.id)?;
    let mut warnings = Vec::new();

    let agents = resolve_assets(
        &manifest.agents,
        &dir.join("agents"),
        "md",
        &lib.agents,
        "agente",
        &mut warnings,
    );
    let commands = resolve_assets(
        &manifest.commands,
        &dir.join("commands"),
        "md",
        &lib.commands,
        "comando",
        &mut warnings,
    );
    let plugins = resolve_plugins(
        &manifest.plugins,
        &dir.join("plugins"),
        &lib.plugins,
        &mut warnings,
    );
    let skills = resolve_skills(
        &manifest.skills,
        &dir.join("skills"),
        &lib.skills,
        &mut warnings,
    );
    let (mcps, mcp_warnings) = resolve_mcps(
        &manifest.mcps,
        Some(&manifest.id),
        templates_root,
        &lib.mcps,
    );
    warnings.extend(mcp_warnings);

    let lock = TemplateLock {
        template_id: Some(manifest.id.clone()),
        template_version: Some(manifest.version),
        frozen_at: now_ms(),
        agents,
        commands,
        plugins,
        skills,
        mcps,
        models: manifest.models.clone(),
        model: manifest
            .model
            .clone()
            .or_else(|| manifest.models.first().cloned()),
        tools: manifest.tools.clone(),
        permissions: manifest.permissions.clone(),
        agents_md: Some(read_agents_md(templates_root, &manifest.id))
            .filter(|text| !text.is_empty()),
    };
    Ok((lock, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AssetInfo, Library, McpInfo, SkillInfo};
    use serde_json::json;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "openconf-template-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn library() -> Library {
        Library {
            agents: vec![AssetInfo {
                id: "reviewer".into(),
                name: "reviewer".into(),
                description: String::new(),
                path: "/global/agents/reviewer.md".into(),
                source: "global".into(),
            }],
            commands: vec![],
            plugins: vec![],
            skills: vec![SkillInfo {
                id: "testing".into(),
                name: "testing".into(),
                description: String::new(),
                path: "/global/skills/testing".into(),
                source: "global".into(),
            }],
            mcps: vec![McpInfo {
                name: "context-mode".into(),
                config: json!({ "type": "local", "command": ["context-mode"] }),
                source: "global".into(),
            }],
        }
    }

    fn manifest() -> TemplateManifest {
        TemplateManifest {
            id: "backend".into(),
            name: "Backend".into(),
            description: String::new(),
            version: 3,
            agents: vec!["reviewer".into()],
            skills: vec!["testing".into(), "missing".into()],
            mcps: vec!["context-mode".into(), "remote".into()],
            commands: vec![],
            plugins: vec![],
            models: vec!["provider/model".into()],
            model: Some("provider/model".into()),
            tools: None,
            permissions: vec![],
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn template_assets_win_over_the_global_library() {
        let root = temp_dir("freeze");
        let dir = ensure_template_dir(&root, "backend").unwrap();
        fs::write(dir.join("agents/reviewer.md"), "# propio").unwrap();
        fs::write(dir.join("AGENTS.md"), "instrucciones del template").unwrap();
        fs::write(
            dir.join("mcps.json"),
            r#"{"remote": {"type": "remote", "url": "https://x"}}"#,
        )
        .unwrap();

        let (lock, warnings) = freeze_with(&manifest(), &root, &library()).unwrap();

        assert_eq!(lock.template_version, Some(3));
        assert_eq!(
            lock.agents[0].path,
            dir.join("agents/reviewer.md").to_string_lossy()
        );
        assert_eq!(lock.agents[0].source, "template");
        assert_eq!(lock.skills[0].path, "/global/skills/testing");
        assert!(lock.mcps.contains_key("remote"));
        assert!(lock.mcps.contains_key("context-mode"));
        assert_eq!(
            lock.agents_md.as_deref(),
            Some("instrucciones del template")
        );
        assert!(
            warnings.iter().any(|warning| warning.contains("missing")),
            "{warnings:?}"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn lock_roundtrips_through_the_workspace_dir() {
        let root = temp_dir("lock");
        let workspace = root.join("ws");
        let (lock, _) = freeze_with(&manifest(), &root, &library()).unwrap();

        write_lock(&workspace, &lock).unwrap();
        let read = read_lock(&workspace).expect("lock");

        assert_eq!(read.template_id.as_deref(), Some("backend"));
        assert_eq!(read.skills.len(), 1);
        fs::remove_dir_all(root).ok();
    }
}
