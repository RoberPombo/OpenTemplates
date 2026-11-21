use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use walkdir::WalkDir;

use crate::config;
use crate::model::{AssetInfo, Library, McpInfo, SkillInfo};

fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/")
        && let Some(home) = dirs::home_dir()
    {
        return home.join(rest);
    }
    PathBuf::from(path)
}

pub fn parse_frontmatter(text: &str) -> (Option<String>, Option<String>) {
    let mut name = None;
    let mut description = None;
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (name, description);
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        match key.trim() {
            "name" => name = Some(value),
            "description" => description = Some(value),
            _ => {}
        }
    }
    (name, description)
}

fn skill_sources(global: &Value, project: Option<&str>) -> Vec<(PathBuf, String)> {
    let mut sources: Vec<(PathBuf, String)> = Vec::new();

    if let Some(arr) = global.get("skills").and_then(Value::as_array) {
        for value in arr {
            if let Some(path) = value.as_str() {
                sources.push((expand_tilde(path), "config".into()));
            }
        }
    }
    if let Some(paths) = global
        .get("skills")
        .and_then(|v| v.get("paths"))
        .and_then(Value::as_array)
    {
        for value in paths {
            if let Some(path) = value.as_str() {
                sources.push((expand_tilde(path), "config".into()));
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        sources.push((home.join(".config/opencode/skills"), "global".into()));
        sources.push((home.join(".claude/skills"), "claude".into()));
        sources.push((home.join(".agents/skills"), "agents".into()));
    }

    if let Some(project) = project {
        let project = PathBuf::from(project);
        sources.push((project.join(".opencode/skills"), "project".into()));
        sources.push((project.join(".claude/skills"), "claude".into()));
        sources.push((project.join(".agents/skills"), "agents".into()));
    }

    sources
}

fn scan_skill_dir(dir: &Path) -> Option<(String, String)> {
    let skill_file = dir.join("SKILL.md");
    if !skill_file.is_file() {
        return None;
    }
    let text = fs::read_to_string(&skill_file).ok()?;
    let (name, description) = parse_frontmatter(&text);
    let id = dir.file_name()?.to_string_lossy().to_string();
    let name = name.filter(|n| !n.is_empty()).unwrap_or_else(|| id.clone());
    Some((id, format!("{}|{}", name, description.unwrap_or_default())))
}

pub fn list_skills(project: Option<&str>) -> Vec<SkillInfo> {
    let (global, _) = config::read_global_config();
    let mut found: BTreeMap<String, SkillInfo> = BTreeMap::new();

    for (source_dir, source) in skill_sources(&global, project) {
        if !source_dir.is_dir() {
            continue;
        }
        for entry in WalkDir::new(&source_dir)
            .max_depth(3)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !(name.starts_with('.') || name == "node_modules") || e.depth() == 0
            })
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() || entry.file_name() != "SKILL.md" {
                continue;
            }
            let Some(parent) = entry.path().parent() else {
                continue;
            };
            let Some((id, meta)) = scan_skill_dir(parent) else {
                continue;
            };
            let (name, description) = match meta.split_once('|') {
                Some((name, description)) => (name.to_string(), description.to_string()),
                None => (id.clone(), String::new()),
            };
            found.insert(
                id.clone(),
                SkillInfo {
                    id,
                    name,
                    description,
                    path: parent.to_string_lossy().to_string(),
                    source: source.clone(),
                },
            );
        }
    }

    found.into_values().collect()
}

/// Directorios donde opencode descubre agentes, comandos y plugins globales.
pub fn markdown_roots(global_dir: &Path, key: &str) -> Vec<PathBuf> {
    vec![global_dir.join(key), global_dir.join(format!("{key}s"))]
}

fn scan_markdown_assets(roots: &[PathBuf], source: &str) -> Vec<AssetInfo> {
    let mut found: BTreeMap<String, AssetInfo> = BTreeMap::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Some(id) = path.file_stem().map(|s| s.to_string_lossy().to_string()) else {
                continue;
            };
            let text = fs::read_to_string(&path).unwrap_or_default();
            let (name, description) = parse_frontmatter(&text);
            found.insert(
                id.clone(),
                AssetInfo {
                    id: id.clone(),
                    name: name.filter(|n| !n.is_empty()).unwrap_or_else(|| id.clone()),
                    description: description.unwrap_or_default(),
                    path: path.to_string_lossy().to_string(),
                    source: source.into(),
                },
            );
        }
    }
    found.into_values().collect()
}

const PLUGIN_EXTENSIONS: [&str; 5] = ["ts", "tsx", "js", "mjs", "cjs"];

fn scan_plugins(roots: &[PathBuf], source: &str) -> Vec<AssetInfo> {
    let mut found: BTreeMap<String, AssetInfo> = BTreeMap::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            if !PLUGIN_EXTENSIONS.contains(&ext) {
                continue;
            }
            let Some(id) = path.file_stem().map(|s| s.to_string_lossy().to_string()) else {
                continue;
            };
            found.insert(
                id.clone(),
                AssetInfo {
                    id: id.clone(),
                    name: id,
                    description: String::new(),
                    path: path.to_string_lossy().to_string(),
                    source: source.into(),
                },
            );
        }
    }
    found.into_values().collect()
}

pub fn plugin_roots(global_dir: &Path) -> Vec<PathBuf> {
    vec![global_dir.join("plugin"), global_dir.join("plugins")]
}

/// Biblioteca global: lo que ya existe en `~/.config/opencode` y compatibles.
pub fn scan() -> Library {
    let global_dir = config::global_config_dir();
    let mut agents = scan_markdown_assets(&markdown_roots(&global_dir, "agent"), "global");
    if let Some(home) = dirs::home_dir() {
        agents.extend(scan_markdown_assets(
            &[home.join(".claude/agents")],
            "claude",
        ));
    }
    let commands = scan_markdown_assets(&markdown_roots(&global_dir, "command"), "global");
    let plugins = scan_plugins(&plugin_roots(&global_dir), "global");

    Library {
        agents,
        commands,
        plugins,
        skills: list_skills(None),
        mcps: config::list_mcps(),
    }
}

pub fn find_asset<'a>(items: &'a [AssetInfo], id: &str) -> Option<&'a AssetInfo> {
    items.iter().find(|item| item.id == id)
}

pub fn find_skill<'a>(items: &'a [SkillInfo], id: &str) -> Option<&'a SkillInfo> {
    items.iter().find(|item| item.id == id)
}

pub fn find_mcp<'a>(items: &'a [McpInfo], name: &str) -> Option<&'a McpInfo> {
    items.iter().find(|item| item.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_frontmatter_name_and_description() {
        let (name, description) =
            parse_frontmatter("---\nname: reviewer\ndescription: \"Revisa PRs\"\n---\n# x");
        assert_eq!(name.as_deref(), Some("reviewer"));
        assert_eq!(description.as_deref(), Some("Revisa PRs"));
    }

    #[test]
    fn ignores_files_without_frontmatter() {
        assert_eq!(parse_frontmatter("# hola\nname: x"), (None, None));
    }
}
