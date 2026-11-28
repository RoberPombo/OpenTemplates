/**
 * Detección de candidatos de bootstrap: ficheros ignorados por git que parecen
 * configuración local (`.env*`, `*.local*`, `.npmrc`, overrides...).
 *
 * Reglas:
 * - Solo se devuelven rutas relativas y un tipo calculado por nombre. Nunca se
 *   abre ni se lee el contenido del fichero.
 * - Se descartan symlinks: no se sigue un enlace que pueda apuntar fuera del
 *   repo.
 * - `git ls-files` decide qué está ignorado; los directorios de build, caché y
 *   dependencias se excluyen además por componente de ruta.
 */
use std::fs;
use std::path::{Component, Path};
use std::process::Command;

use serde::{Deserialize, Serialize};

pub const MAX_CANDIDATES: usize = 200;

/// Nombres que pueden ser configuración local. Git hace el filtro y el
/// pathspec evita recorrer `node_modules` y otros árboles grandes.
const PATHSPECS: &[&str] = &[
    ":(glob)**/.env*",
    ":(glob)**/*.local",
    ":(glob)**/*.local.*",
    ":(glob)**/.npmrc",
    ":(glob)**/.yarnrc",
    ":(glob)**/.yarnrc.yml",
    ":(glob)**/.tool-versions",
    ":(glob)**/.nvmrc",
    ":(glob)**/.node-version",
    ":(glob)**/*.override.yml",
    ":(glob)**/*.override.yaml",
    ":(glob)**/*.override.json",
    ":(glob)**/*.override.toml",
    ":(exclude,glob)**/.git/**",
    ":(exclude,glob)**/node_modules/**",
    ":(exclude,glob)**/dist/**",
    ":(exclude,glob)**/build/**",
    ":(exclude,glob)**/.next/**",
    ":(exclude,glob)**/target/**",
    ":(exclude,glob)**/coverage/**",
    ":(exclude,glob)**/out/**",
    ":(exclude,glob)**/.turbo/**",
    ":(exclude,glob)**/.cache/**",
    ":(exclude,glob)**/logs/**",
    ":(exclude,glob)**/tmp/**",
];

const EXCLUDED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "target",
    "coverage",
    "out",
    ".turbo",
    ".cache",
    "logs",
    "tmp",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapCandidate {
    pub path: String,
    /// `env`, `local`, `npm`, `tool` u `override`.
    pub kind: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapDetection {
    pub candidates: Vec<BootstrapCandidate>,
    pub truncated: bool,
}

/// Clasifica por nombre de fichero, sin abrirlo. Devuelve `None` si no es un
/// candidato conocido (el pathspec ya lo filtra, pero la comprobación es
/// explícita y se prueba aparte).
fn kind_for(relative: &str) -> Option<&'static str> {
    let name = Path::new(relative)
        .file_name()?
        .to_str()?
        .to_ascii_lowercase();
    if name.starts_with(".env") {
        return Some("env");
    }
    if name.ends_with(".local") || name.contains(".local.") {
        return Some("local");
    }
    if matches!(name.as_str(), ".npmrc" | ".yarnrc" | ".yarnrc.yml") {
        return Some("npm");
    }
    if matches!(name.as_str(), ".tool-versions" | ".nvmrc" | ".node-version") {
        return Some("tool");
    }
    if name.contains(".override.") {
        return Some("override");
    }
    None
}

fn safe_relative(path: &str) -> bool {
    if path.is_empty() || path.contains('\\') || path.starts_with('/') {
        return false;
    }
    if path
        .split('/')
        .any(|part| part.is_empty() || part == "." || EXCLUDED_DIRS.contains(&part))
    {
        return false;
    }
    let relative = Path::new(path);
    !relative.is_absolute()
        && !relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

/// Lista los ficheros ignorados del checkout que parecen configuración local.
/// Solo lee metadatos: nombre, tipo de entrada y, como mucho, el enlace que se
/// descarta. No abre el contenido de ningún candidato.
pub fn detect(repo: &Path) -> Result<BootstrapDetection, String> {
    let repo = crate::git::toplevel(repo)?;
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args([
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "-z",
            "--",
        ])
        .args(PATHSPECS)
        .output()
        .map_err(|e| format!("No se pudo ejecutar git: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "No se pudieron listar los ficheros ignorados: {}",
            stderr.trim()
        ));
    }

    let mut candidates = Vec::new();
    let mut truncated = false;
    for raw in output.stdout.split(|byte| *byte == 0) {
        if raw.is_empty() {
            continue;
        }
        // Nombres no UTF-8 no se pueden representar en la UI; se omiten.
        let Ok(relative) = std::str::from_utf8(raw) else {
            continue;
        };
        let Some(kind) = kind_for(relative) else {
            continue;
        };
        if !safe_relative(relative) {
            continue;
        }
        let metadata = match fs::symlink_metadata(repo.join(relative)) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        // No se siguen symlinks: podrían apuntar fuera del repo.
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        candidates.push(BootstrapCandidate {
            path: relative.to_string(),
            kind: kind.to_string(),
        });
        if candidates.len() > MAX_CANDIDATES {
            truncated = true;
            break;
        }
    }
    if truncated {
        candidates.truncate(MAX_CANDIDATES);
    }
    candidates.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(BootstrapDetection {
        candidates,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("ot-bootstrap-detect-{}", uuid::Uuid::new_v4()))
    }

    fn run_git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .expect("git disponible");
        assert!(status.success(), "git {args:?} falló en {}", dir.display());
    }

    fn init_repo(root: &Path, ignores: &[&str]) {
        fs::create_dir_all(root).unwrap();
        run_git(root, &["init", "-q", "-b", "main"]);
        fs::write(root.join(".gitignore"), format!("{}\n", ignores.join("\n"))).unwrap();
        run_git(root, &["add", ".gitignore"]);
        run_git(
            root,
            &[
                "-c",
                "user.email=test@example.com",
                "-c",
                "user.name=Test",
                "commit",
                "-qm",
                "init",
            ],
        );
    }

    fn write(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn kinds(detection: &BootstrapDetection) -> BTreeMap<String, String> {
        detection
            .candidates
            .iter()
            .map(|candidate| (candidate.path.clone(), candidate.kind.clone()))
            .collect()
    }

    #[test]
    fn detecta_solo_ignorados_que_parecen_configuracion() {
        let root = temp_dir();
        init_repo(
            &root,
            &[
                ".env*",
                "*.local*",
                ".npmrc",
                ".tool-versions",
                "*.override.yml",
                "*.tmp",
            ],
        );
        write(&root, ".env", "A=1\n");
        write(&root, ".env.local", "B=2\n");
        write(&root, ".tool-versions", "node 22\n");
        write(&root, "apps/web/config.local.yml", "debug: true\n");
        write(&root, "docker-compose.override.yml", "services: {}\n");
        write(&root, "sub/.npmrc", "registry=https://example.test\n");
        write(&root, "cache/random.tmp", "no es config\n");

        let detection = detect(&root).unwrap();

        let found = kinds(&detection);
        assert_eq!(
            found,
            BTreeMap::from([
                (".env".to_string(), "env".to_string()),
                (".env.local".to_string(), "env".to_string()),
                (".tool-versions".to_string(), "tool".to_string()),
                ("apps/web/config.local.yml".to_string(), "local".to_string()),
                (
                    "docker-compose.override.yml".to_string(),
                    "override".to_string()
                ),
                ("sub/.npmrc".to_string(), "npm".to_string()),
            ])
        );
        assert!(!detection.truncated);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn no_devuelve_contenido_ni_valores_de_secretos() {
        let root = temp_dir();
        init_repo(&root, &[".env*"]);
        write(&root, ".env", "SECRETO_DE_PRUEBA=no-debe-salir\n");

        let detection = detect(&root).unwrap();
        let json = serde_json::to_string(&detection).unwrap();

        assert_eq!(detection.candidates.len(), 1);
        assert_eq!(detection.candidates[0].path, ".env");
        assert!(!json.contains("SECRETO_DE_PRUEBA"));
        assert!(!json.contains("no-debe-salir"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn excluye_dependencias_y_directorios_de_build() {
        let root = temp_dir();
        init_repo(
            &root,
            &[
                ".env*",
                "node_modules/",
                "dist/",
                "build/",
                ".next/",
                "target/",
                "coverage/",
                "logs/",
                "tmp/",
            ],
        );
        for dir in [
            "node_modules/pkg",
            "dist",
            "build",
            ".next",
            "target/debug",
            "coverage",
            "logs",
            "tmp",
        ] {
            write(&root, &format!("{dir}/.env"), "NO=1\n");
        }

        let detection = detect(&root).unwrap();

        assert!(
            detection.candidates.is_empty(),
            "{:?}",
            detection.candidates
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn no_devuelve_ficheros_rastreados() {
        let root = temp_dir();
        init_repo(&root, &[".env*"]);
        write(&root, ".env", "A=1\n");
        run_git(&root, &["add", "-f", ".env"]);
        run_git(
            &root,
            &[
                "-c",
                "user.email=test@example.com",
                "-c",
                "user.name=Test",
                "commit",
                "-qm",
                "env",
            ],
        );

        let detection = detect(&root).unwrap();

        assert!(
            detection.candidates.is_empty(),
            "{:?}",
            detection.candidates
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn no_sigue_symlinks_fuera_del_repo() {
        let root = temp_dir();
        let repo = root.join("repo");
        let outside = root.join("fuera");
        init_repo(&repo, &[".env*"]);
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("ajeno.env"), "SECRETO=fuera\n").unwrap();
        std::os::unix::fs::symlink(outside.join("ajeno.env"), repo.join(".env.ajeno")).unwrap();
        std::os::unix::fs::symlink(&outside, repo.join(".env.carpeta")).unwrap();

        let detection = detect(&repo).unwrap();

        assert!(
            detection.candidates.is_empty(),
            "{:?}",
            detection.candidates
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn limita_la_lista_y_marca_truncated() {
        let root = temp_dir();
        init_repo(&root, &["*.local"]);
        for index in 0..(MAX_CANDIDATES + 5) {
            write(&root, &format!("config-{index:03}.local"), "x\n");
        }

        let detection = detect(&root).unwrap();

        assert_eq!(detection.candidates.len(), MAX_CANDIDATES);
        assert!(detection.truncated);
        assert!(
            detection
                .candidates
                .iter()
                .all(|candidate| !candidate.path.starts_with(".."))
        );
        let _ = fs::remove_dir_all(&root);
    }
}
