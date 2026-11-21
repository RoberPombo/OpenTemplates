use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};
use walkdir::WalkDir;

use crate::library;
use crate::model::{McpInfo, SkillRef, TemplateLock, Workspace};
use crate::templates;

pub fn global_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("opencode")
}

pub fn global_config_path() -> Option<PathBuf> {
    let dir = global_config_dir();
    for name in ["opencode.jsonc", "opencode.json"] {
        let path = dir.join(name);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

pub fn read_global_config() -> (Value, Option<String>) {
    let Some(path) = global_config_path() else {
        return (json!({}), None);
    };
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) => {
            return (
                json!({}),
                Some(format!("No se pudo leer {}: {err}", path.display())),
            );
        }
    };
    match json5::from_str::<Value>(&raw) {
        Ok(value) if value.is_object() => (value, None),
        Ok(_) => (
            json!({}),
            Some("La configuración global no es un objeto".into()),
        ),
        Err(err) => (
            json!({}),
            Some(format!("JSON inválido en {}: {err}", path.display())),
        ),
    }
}

pub fn mcp_map(global: &Value) -> Map<String, Value> {
    let Some(mcp) = global.get("mcp") else {
        return Map::new();
    };
    if let Some(servers) = mcp.get("servers").and_then(Value::as_object) {
        return servers.clone();
    }
    let Some(direct) = mcp.as_object() else {
        return Map::new();
    };
    direct
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

pub fn list_mcps() -> Vec<McpInfo> {
    let (global, _) = read_global_config();
    let mut items: Vec<McpInfo> = mcp_map(&global)
        .into_iter()
        .map(|(name, config)| McpInfo {
            name,
            config,
            source: "global".into(),
        })
        .collect();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    items
}

/// Config aislada del workspace antes de escribirla a disco.
pub fn render_config(
    workspace: &Workspace,
    lock: Option<&TemplateLock>,
    global: &Value,
) -> (Value, Vec<String>) {
    let mut warnings = Vec::new();
    let available = mcp_map(global);
    let mut root = if global.is_object() {
        global.clone()
    } else {
        json!({})
    };
    if let Some(obj) = root.as_object_mut() {
        for key in [
            "mcp",
            "skills",
            "instructions",
            "agents",
            "agent",
            "commands",
            "plugins",
        ] {
            obj.remove(key);
        }
        if lock.is_some() {
            obj.remove("plugin");
        }
        obj.entry("$schema")
            .or_insert_with(|| json!("https://opencode.ai/config.json"));
    }

    let mut servers = Map::new();
    match lock {
        Some(lock) => {
            for (name, config) in &lock.mcps {
                let mut config = config.clone();
                if let Some(obj) = config.as_object_mut() {
                    obj.insert(
                        "disabled".into(),
                        Value::Bool(workspace.disabled_mcps.contains(name)),
                    );
                }
                servers.insert(name.clone(), config);
            }
        }
        None => {
            for name in &workspace.mcp_names {
                match available.get(name) {
                    Some(config) => {
                        let mut config = config.clone();
                        if let Some(obj) = config.as_object_mut() {
                            obj.insert(
                                "disabled".into(),
                                Value::Bool(workspace.disabled_mcps.contains(name)),
                            );
                        }
                        servers.insert(name.clone(), config);
                    }
                    None => {
                        warnings.push(format!("El MCP '{name}' ya no existe en la config global"))
                    }
                }
            }
        }
    }
    root["mcp"] = json!({ "servers": servers });

    let mut skill_refs: Vec<&SkillRef> = match lock {
        Some(lock) => lock.skills.iter().collect(),
        None => workspace.skills.iter().collect(),
    };
    skill_refs.retain(|skill| !workspace.disabled_skills.contains(&skill.id));
    let mut skill_roots: Vec<String> = Vec::new();
    for skill in &skill_refs {
        let path = PathBuf::from(&skill.path);
        let root_dir = path.parent().unwrap_or(path.as_path());
        let root_dir = root_dir.to_string_lossy().to_string();
        if !skill_roots.contains(&root_dir) {
            skill_roots.push(root_dir);
        }
    }
    root["skills"] = json!(skill_roots);

    let mut permissions = root
        .get("permissions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    permissions.retain(|rule| rule.get("action").and_then(Value::as_str) != Some("skill"));
    if let Some(lock) = lock {
        for rule in &lock.permissions {
            if rule.get("action").and_then(Value::as_str) != Some("skill") {
                permissions.push(rule.clone());
            }
        }
    }
    permissions.push(json!({ "action": "skill", "resource": "*", "effect": "deny" }));
    let mut allowed: Vec<String> = skill_refs.iter().map(|s| s.id.clone()).collect();
    for builtin in ["opencode", "report"] {
        if !allowed.iter().any(|id| id == builtin) {
            allowed.push(builtin.to_string());
        }
    }
    for id in allowed {
        permissions.push(json!({ "action": "skill", "resource": id, "effect": "allow" }));
    }
    root["permissions"] = Value::Array(permissions);

    let model = match lock {
        Some(lock) => lock.model.clone(),
        None => workspace.model.clone(),
    }
    .filter(|model| !model.trim().is_empty());
    if let Some(model) = model {
        root["model"] = json!(model);
    }
    if let Some(tools) = lock.and_then(|lock| lock.tools.clone()) {
        root["tools"] = tools;
    }
    if let Some(lock) = lock {
        let paths: Vec<String> = lock.plugins.iter().map(|p| p.path.clone()).collect();
        if !paths.is_empty() {
            root["plugin"] = json!(paths);
        }
    }

    (root, warnings)
}

fn reset_asset_dir(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {
            fs::remove_dir_all(path)
                .map_err(|e| format!("No se pudo limpiar {}: {e}", path.display()))?;
        }
        Ok(_) => {
            fs::remove_file(path)
                .map_err(|e| format!("No se pudo limpiar {}: {e}", path.display()))?;
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(format!("No se pudo leer {}: {err}", path.display())),
    }
    fs::create_dir_all(path).map_err(|e| format!("No se pudo crear {}: {e}", path.display()))
}

#[cfg(unix)]
fn symlink_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(src, dst)
}

#[cfg(not(unix))]
fn symlink_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::copy(src, dst).map(|_| ())
}

/// Symlink idempotente que respeta symlinks colgantes ya existentes.
#[cfg(unix)]
fn ensure_symlink(src: &Path, dst: &Path) {
    if !src.exists() {
        return;
    }
    if fs::symlink_metadata(dst).is_ok() {
        return;
    }
    let _ = std::os::unix::fs::symlink(src, dst);
}

#[cfg(not(unix))]
fn ensure_symlink(_src: &Path, _dst: &Path) {}

fn sync_asset_dir(
    config_dir: &Path,
    dir_name: &str,
    refs: &[crate::model::AssetRef],
    markdown: bool,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    let dir = config_dir.join(dir_name);
    reset_asset_dir(&dir)?;
    for asset in refs {
        let src = PathBuf::from(&asset.path);
        if !src.is_file() {
            warnings.push(format!(
                "El asset '{}' apunta a una ruta que ya no existe: {}",
                asset.id, asset.path
            ));
            continue;
        }
        let file_name = if markdown {
            format!("{}.md", asset.id)
        } else {
            src.file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| asset.id.clone())
        };
        let dst = dir.join(file_name);
        if fs::symlink_metadata(&dst).is_ok() {
            fs::remove_file(&dst)
                .map_err(|e| format!("No se pudo reemplazar {}: {e}", dst.display()))?;
        }
        symlink_file(&src, &dst)
            .map_err(|e| format!("No se pudo enlazar {}: {e}", dst.display()))?;
    }
    Ok(())
}

const SKIP_DIRS: [&str; 8] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "vendor",
    ".venv",
];

/// `AGENTS.md` del repo, en orden padre → hijo.
fn repo_agents_files(root: &Path) -> Vec<(String, String)> {
    if !root.is_dir() {
        return Vec::new();
    }
    let mut found: Vec<(usize, String, String)> = Vec::new();
    for entry in WalkDir::new(root)
        .max_depth(6)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            entry.depth() == 0 || (!SKIP_DIRS.contains(&name.as_ref()) && !name.starts_with('.'))
        })
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() || entry.file_name() != "AGENTS.md" {
            continue;
        }
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        let depth = path.components().count();
        let content = fs::read_to_string(path).unwrap_or_default();
        if content.trim().is_empty() {
            continue;
        }
        found.push((depth, relative, content));
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    found
        .into_iter()
        .map(|(_, path, content)| (path, content))
        .collect()
}

pub fn build_agents_md(
    template_md: Option<&str>,
    global_md: Option<&str>,
    repo_files: &[(String, String)],
    issue: Option<&crate::model::IssueRef>,
) -> String {
    let mut sections: Vec<String> = Vec::new();
    sections.push(
        "# AGENTS.md combinado\n\n<!-- Generado por OpenConf. No editar a mano: se regenera al arrancar o al reaplicar el template. -->".into(),
    );
    if let Some(global) = global_md.filter(|text| !text.trim().is_empty()) {
        sections.push(format!("## Instrucciones globales\n\n{}", global.trim()));
    }
    if let Some(template) = template_md.filter(|text| !text.trim().is_empty()) {
        sections.push(format!(
            "## Instrucciones del template\n\n{}",
            template.trim()
        ));
    }
    if !repo_files.is_empty() {
        let mut part = String::from("## Instrucciones del repositorio\n");
        for (path, content) in repo_files {
            part.push_str(&format!("\n### `{path}`\n\n{}\n", content.trim()));
        }
        sections.push(part.trim_end().to_string());
    }
    if let Some(issue) = issue {
        let mut part = format!(
            "## Issue #{}{}\n\nLos detalles están en `ISSUE.md`, en la carpeta del workspace.",
            issue.number,
            if issue.title.is_empty() {
                String::new()
            } else {
                format!(" — {}", issue.title)
            }
        );
        if let Some(url) = issue.url.as_deref().filter(|url| !url.is_empty()) {
            part.push_str(&format!("\n\n{url}"));
        }
        sections.push(part);
    }
    format!("{}\n", sections.join("\n\n"))
}

fn write_replacing(path: &Path, content: &str) -> Result<(), String> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.is_dir() && !meta.file_type().is_symlink() {
            return Err(format!("'{}' es una carpeta", path.display()));
        }
        // Nunca escribir a través del symlink al AGENTS.md global.
        fs::remove_file(path)
            .map_err(|e| format!("No se pudo reemplazar {}: {e}", path.display()))?;
    }
    fs::write(path, content).map_err(|e| format!("No se pudo escribir {}: {e}", path.display()))
}

pub struct MaterializeInput<'a> {
    pub workspace: &'a Workspace,
    pub workspace_dir: &'a Path,
    pub global_dir: &'a Path,
    pub global_config: &'a Value,
}

#[derive(Debug)]
pub struct Materialized {
    pub config_path: PathBuf,
    pub agents_path: PathBuf,
    pub warnings: Vec<String>,
}

/// Materializa la config del workspace a partir del lock congelado (si existe)
/// o de los campos del propio workspace (workspaces ad-hoc de la v1).
pub fn materialize(input: MaterializeInput<'_>) -> Result<Materialized, String> {
    let MaterializeInput {
        workspace,
        workspace_dir,
        global_dir,
        global_config,
    } = input;

    let lock = templates::read_lock(workspace_dir);
    let (mut root, mut warnings) = render_config(workspace, lock.as_ref(), global_config);

    let allowed: Vec<String> = match &lock {
        Some(lock) => lock.skills.iter().map(|skill| skill.id.clone()).collect(),
        None => workspace
            .skills
            .iter()
            .map(|skill| skill.id.clone())
            .collect(),
    };
    let allowed: Vec<String> = allowed
        .into_iter()
        .filter(|id| !workspace.disabled_skills.contains(id))
        .collect();
    for skill in library::list_skills(Some(&workspace.project_path)) {
        if !allowed.contains(&skill.id)
            && let Some(permissions) = root.get_mut("permissions").and_then(Value::as_array_mut)
        {
            permissions.push(json!({
                "action": "skill",
                "resource": skill.id,
                "effect": "deny"
            }));
        }
    }

    let config_dir = workspace_dir.join("xdg/opencode");
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("No se pudo crear {}: {e}", config_dir.display()))?;

    match &lock {
        Some(lock) => {
            sync_asset_dir(&config_dir, "agents", &lock.agents, true, &mut warnings)?;
            sync_asset_dir(&config_dir, "commands", &lock.commands, true, &mut warnings)?;
            sync_asset_dir(&config_dir, "plugins", &lock.plugins, false, &mut warnings)?;
        }
        None => {
            // Workspace v1/ad-hoc: conserva el comportamiento anterior.
            ensure_symlink(&global_dir.join("agents"), &config_dir.join("agents"));
            ensure_symlink(&global_dir.join("commands"), &config_dir.join("commands"));
            ensure_symlink(&global_dir.join("plugins"), &config_dir.join("plugins"));
        }
    }

    if let Some(issue) = &workspace.issue {
        let mut text = format!("# Issue #{}", issue.number);
        if !issue.title.is_empty() {
            text.push_str(&format!(" — {}", issue.title));
        }
        if let Some(url) = issue.url.as_deref().filter(|url| !url.is_empty()) {
            text.push_str(&format!("\n\n{url}"));
        }
        text.push('\n');
        fs::write(workspace_dir.join("ISSUE.md"), text)
            .map_err(|e| format!("No se pudo escribir ISSUE.md: {e}"))?;
    }

    let global_md = fs::read_to_string(global_dir.join("AGENTS.md")).ok();
    let repo_files = repo_agents_files(Path::new(&workspace.project_path));
    let combined = build_agents_md(
        lock.as_ref().and_then(|lock| lock.agents_md.as_deref()),
        global_md.as_deref(),
        &repo_files,
        workspace.issue.as_ref(),
    );
    let agents_path = config_dir.join("AGENTS.md");
    write_replacing(&agents_path, &combined)?;

    let config_path = config_dir.join("opencode.json");
    let pretty = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("No se pudo serializar la config: {e}"))?;
    let tmp = config_dir.join(".opencode.json.tmp");
    fs::write(&tmp, pretty).map_err(|e| format!("No se pudo escribir {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &config_path).map_err(|e| format!("No se pudo mover la config: {e}"))?;

    Ok(Materialized {
        config_path,
        agents_path,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AssetRef, IssueRef, SkillRef, WorkspaceMode};
    use std::collections::BTreeMap;

    fn temp_dir(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("openconf-config-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn workspace() -> Workspace {
        Workspace {
            id: "ws".into(),
            name: "programar".into(),
            project_path: "/tmp/project".into(),
            mcp_names: vec!["alpha".into()],
            skills: vec![SkillRef {
                id: "testing".into(),
                path: "/skills/testing".into(),
            }],
            model: Some("provider/model".into()),
            mode: WorkspaceMode::Adhoc,
            ..Workspace::default()
        }
    }

    #[test]
    fn keeps_only_selected_mcps_and_skills() {
        let global = json!({
            "model": "global/model",
            "mcp": {
                "servers": {
                    "alpha": { "type": "local", "command": ["run"], "disabled": true },
                    "beta": { "type": "remote", "url": "https://beta.example/mcp" }
                }
            },
            "skills": { "paths": ["/skills"] },
            "permissions": [
                { "action": "bash", "resource": "*", "effect": "allow" },
                { "action": "skill", "resource": "*", "effect": "allow" }
            ]
        });

        let (config, warnings) = render_config(&workspace(), None, &global);

        assert!(warnings.is_empty());
        assert!(config["mcp"]["servers"].get("alpha").is_some());
        assert!(config["mcp"]["servers"].get("beta").is_none());
        assert_eq!(config["mcp"]["servers"]["alpha"]["disabled"], false);
        assert_eq!(config["model"], "provider/model");
        assert_eq!(config["skills"], json!(["/skills"]));
        assert!(config.get("instructions").is_none() || config["instructions"].is_null());

        let permissions = config["permissions"].as_array().unwrap();
        let skill_rules: Vec<&Value> = permissions
            .iter()
            .filter(|rule| rule["action"] == "skill")
            .collect();
        assert_eq!(skill_rules[0]["resource"], "*");
        assert_eq!(skill_rules[0]["effect"], "deny");
        assert!(
            skill_rules
                .iter()
                .any(|rule| { rule["resource"] == "testing" && rule["effect"] == "allow" })
        );
        assert!(
            permissions
                .iter()
                .any(|rule| rule["action"] == "bash" && rule["effect"] == "allow")
        );
    }

    #[test]
    fn disables_items_without_removing_them() {
        let global = json!({
            "mcp": {
                "servers": {
                    "alpha": { "type": "local", "command": ["run"] }
                }
            }
        });
        let mut workspace = workspace();
        workspace.disabled_mcps = vec!["alpha".into()];
        workspace.disabled_skills = vec!["testing".into()];

        let (config, _) = render_config(&workspace, None, &global);

        assert_eq!(config["mcp"]["servers"]["alpha"]["disabled"], true);
        assert_eq!(config["skills"], json!([]));
        let permissions = config["permissions"].as_array().unwrap();
        assert!(
            !permissions
                .iter()
                .any(|rule| rule["resource"] == "testing" && rule["effect"] == "allow")
        );
        assert!(
            permissions
                .iter()
                .any(|rule| rule["resource"] == "opencode" && rule["effect"] == "allow")
        );
    }

    #[test]
    fn warns_when_a_selected_mcp_disappears() {
        let mut workspace = workspace();
        workspace.mcp_names = vec!["missing".into()];
        let (config, warnings) = render_config(&workspace, None, &json!({}));
        assert!(config["mcp"]["servers"].as_object().unwrap().is_empty());
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn uses_the_frozen_lock_for_mcps_skills_and_assets() {
        let lock = TemplateLock {
            template_id: Some("backend".into()),
            template_version: Some(4),
            frozen_at: 0,
            agents: vec![AssetRef {
                id: "reviewer".into(),
                path: "/tpl/agents/reviewer.md".into(),
                source: "template".into(),
            }],
            commands: vec![],
            plugins: vec![AssetRef {
                id: "guard".into(),
                path: "/tpl/plugins/guard.ts".into(),
                source: "template".into(),
            }],
            skills: vec![SkillRef {
                id: "testing".into(),
                path: "/tpl/skills/testing".into(),
            }],
            mcps: BTreeMap::from([(
                "frozen".to_string(),
                json!({ "type": "remote", "url": "https://frozen.example" }),
            )]),
            model: Some("frozen/model".into()),
            tools: Some(json!({ "bash": false })),
            permissions: vec![json!({ "action": "edit", "resource": "*", "effect": "deny" })],
            agents_md: Some("template".into()),
        };
        let global = json!({
            "mcp": { "servers": { "unused": { "type": "local", "command": ["x"] } } },
            "plugin": ["global-plugin"]
        });

        let (config, warnings) = render_config(&workspace(), Some(&lock), &global);

        assert!(warnings.is_empty());
        assert!(config["mcp"]["servers"].get("frozen").is_some());
        assert!(config["mcp"]["servers"].get("unused").is_none());
        assert_eq!(config["model"], "frozen/model");
        assert_eq!(config["tools"]["bash"], false);
        assert_eq!(config["skills"], json!(["/tpl/skills"]));
        assert_eq!(config["plugin"], json!(["/tpl/plugins/guard.ts"]));
        let permissions = config["permissions"].as_array().unwrap();
        assert!(
            permissions
                .iter()
                .any(|rule| rule["action"] == "edit" && rule["effect"] == "deny")
        );
    }

    #[test]
    fn combined_agents_md_includes_every_layer_in_order() {
        let issue = IssueRef {
            number: 12,
            title: "Login roto".into(),
            url: Some("https://github.com/acme/app/issues/12".into()),
        };
        let text = build_agents_md(
            Some("TEMPLATE_MARK"),
            Some("GLOBAL_MARK"),
            &[("AGENTS.md".into(), "REPO_MARK".into())],
            Some(&issue),
        );

        let global_at = text.find("GLOBAL_MARK").unwrap();
        let template_at = text.find("TEMPLATE_MARK").unwrap();
        let repo_at = text.find("REPO_MARK").unwrap();
        let issue_at = text.find("Issue #12").unwrap();
        assert!(global_at < template_at && template_at < repo_at && repo_at < issue_at);
    }

    #[test]
    fn materializes_without_touching_the_global_agents_md() {
        let root = temp_dir("materialize");
        let global_dir = root.join("global");
        let workspace_dir = root.join("ws");
        let templates_root = root.join("templates");
        let project = root.join("project");
        for dir in [&global_dir, &workspace_dir, &project] {
            fs::create_dir_all(dir).unwrap();
        }
        fs::write(global_dir.join("AGENTS.md"), "global original").unwrap();
        fs::write(project.join("AGENTS.md"), "instrucciones del repo").unwrap();

        let config_dir = workspace_dir.join("xdg/opencode");
        fs::create_dir_all(&config_dir).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(global_dir.join("AGENTS.md"), config_dir.join("AGENTS.md"))
            .unwrap();

        let agent_file = templates_root.join("backend/agents/reviewer.md");
        let plugin_file = templates_root.join("backend/plugins/guard.ts");
        fs::create_dir_all(agent_file.parent().unwrap()).unwrap();
        fs::create_dir_all(plugin_file.parent().unwrap()).unwrap();
        fs::write(&agent_file, "# reviewer").unwrap();
        fs::write(&plugin_file, "export {}").unwrap();
        let lock = TemplateLock {
            template_id: Some("backend".into()),
            template_version: Some(1),
            frozen_at: 0,
            agents: vec![AssetRef {
                id: "reviewer".into(),
                path: agent_file.to_string_lossy().to_string(),
                source: "template".into(),
            }],
            commands: vec![],
            plugins: vec![AssetRef {
                id: "guard".into(),
                path: plugin_file.to_string_lossy().to_string(),
                source: "template".into(),
            }],
            skills: vec![],
            mcps: BTreeMap::new(),
            model: None,
            tools: None,
            permissions: vec![],
            agents_md: Some("instrucciones del template".into()),
        };
        templates::write_lock(&workspace_dir, &lock).unwrap();

        let workspace = Workspace {
            project_path: project.to_string_lossy().to_string(),
            ..workspace()
        };
        let global_config = json!({ "permissions": [] });

        let materialized = materialize(MaterializeInput {
            workspace: &workspace,
            workspace_dir: &workspace_dir,
            global_dir: &global_dir,
            global_config: &global_config,
        })
        .unwrap();

        // El AGENTS.md global no se toca, aunque antes fuera un symlink.
        assert_eq!(
            fs::read_to_string(global_dir.join("AGENTS.md")).unwrap(),
            "global original"
        );
        let meta = fs::symlink_metadata(&materialized.agents_path).unwrap();
        assert!(!meta.file_type().is_symlink());
        let combined = fs::read_to_string(&materialized.agents_path).unwrap();
        assert!(combined.contains("global original"));
        assert!(combined.contains("instrucciones del template"));
        assert!(combined.contains("instrucciones del repo"));

        assert!(config_dir.join("agents/reviewer.md").is_file());
        assert!(config_dir.join("plugins/guard.ts").is_file());
        let config: Value =
            serde_json::from_str(&fs::read_to_string(&materialized.config_path).unwrap()).unwrap();
        assert!(config["mcp"]["servers"].is_object());
        fs::remove_dir_all(root).ok();
    }
}
