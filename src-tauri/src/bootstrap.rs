/**
 * Bootstrap de un worktree: trae del checkout principal los ficheros ignorados
 * que hacen falta para levantarlo (`.env`, configs de servicio, `node_modules`…).
 *
 * Reglas:
 * - Nunca se copia `.git`, `.`, rutas absolutas ni con `..`.
 * - Si el destino ya existe, no se toca (idempotente).
 * - `required` decide si un fallo bloquea la feature o solo avisa.
 * - `auto` para `node_modules`: si el lockfile coincide con el del checkout
 *   principal se copia (reflink si el FS lo soporta); si no, se instala con el
 *   gestor (pnpm/npm) usando caché. Nunca symlink: contaminaría el principal.
 */
use std::fs;
use std::path::{Component, Path};

use crate::model::BootstrapEntry;

#[derive(Debug, Default)]
pub struct BootstrapReport {
    pub applied: Vec<String>,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

fn safe_relative(path: &str) -> Result<&Path, String> {
    let rel = Path::new(path);
    if path.trim().is_empty()
        || path == "."
        || rel.is_absolute()
        || rel.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!("Ruta de bootstrap no válida: '{path}'."));
    }
    if path == ".git" || path.starts_with(".git/") {
        return Err(format!("Ruta de bootstrap no válida: '{path}'."));
    }
    Ok(rel)
}

#[cfg(unix)]
fn symlink(target: &Path, link: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(target, link)
        .map_err(|e| format!("No se pudo enlazar {}: {e}", link.display()))
}

#[cfg(windows)]
fn symlink(target: &Path, link: &Path) -> Result<(), String> {
    let result = if target.is_dir() {
        std::os::windows::fs::symlink_dir(target, link)
    } else {
        std::os::windows::fs::symlink_file(target, link)
    };
    result.map_err(|e| format!("No se pudo enlazar {}: {e}", link.display()))
}

fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    let meta =
        fs::symlink_metadata(src).map_err(|e| format!("No se pudo leer {}: {e}", src.display()))?;

    if meta.file_type().is_symlink() {
        let target = fs::read_link(src).map_err(|e| format!("Enlace roto en {}: {e}", src.display()))?;
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("No se pudo crear {}: {e}", parent.display()))?;
        }
        return symlink(&target, dst);
    }

    if meta.is_dir() {
        fs::create_dir_all(dst)
            .map_err(|e| format!("No se pudo crear {}: {e}", dst.display()))?;
        let entries =
            fs::read_dir(src).map_err(|e| format!("No se pudo listar {}: {e}", src.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("No se pudo listar {}: {e}", src.display()))?;
            if entry.file_name() == ".git" {
                continue;
            }
            copy_tree(&entry.path(), &dst.join(entry.file_name()))?;
        }
        return Ok(());
    }

    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear {}: {e}", parent.display()))?;
    }
    fs::copy(src, dst)
        .map(|_| ())
        .map_err(|e| format!("No se pudo copiar {}: {e}", src.display()))
}

#[cfg(target_os = "linux")]
fn reflink_or_copy(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear {}: {e}", parent.display()))?;
    }
    let ok = std::process::Command::new("cp")
        .arg("-a")
        .arg("--reflink=auto")
        .arg(src)
        .arg(dst)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if ok {
        return Ok(());
    }
    copy_tree(src, dst)
}

#[cfg(not(target_os = "linux"))]
fn reflink_or_copy(src: &Path, dst: &Path) -> Result<(), String> {
    copy_tree(src, dst)
}

fn same_bytes(a: &Path, b: &Path) -> bool {
    match (fs::read(a), fs::read(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

enum Manager {
    Pnpm,
    Npm,
    Other(&'static str),
}

fn manager_for(repo: &Path) -> Option<Manager> {
    if repo.join("pnpm-lock.yaml").exists() {
        Some(Manager::Pnpm)
    } else if repo.join("package-lock.json").exists() {
        Some(Manager::Npm)
    } else if repo.join("yarn.lock").exists() {
        Some(Manager::Other("yarn"))
    } else if repo.join("bun.lockb").exists() || repo.join("bun.lock").exists() {
        Some(Manager::Other("bun"))
    } else {
        None
    }
}

fn lockfile(manager: &Manager) -> &'static str {
    match manager {
        Manager::Pnpm => "pnpm-lock.yaml",
        Manager::Npm => "package-lock.json",
        Manager::Other("yarn") => "yarn.lock",
        Manager::Other("bun") => "bun.lockb",
        Manager::Other(_) => "package-lock.json",
    }
}

fn install(worktree: &Path, program: &str, args: &[&str]) -> Result<(), String> {
    let output = std::process::Command::new(program)
        .current_dir(worktree)
        .args(args)
        .output()
        .map_err(|e| format!("No se pudo ejecutar {program}: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let lines: Vec<&str> = stderr.lines().collect();
    let tail = lines[lines.len().saturating_sub(6)..].join("\n");
    Err(format!("{program} falló: {tail}"))
}

fn node_modules_auto(repo: &Path, worktree: &Path, source: &Path, dest: &Path) -> Result<(), String> {
    let Some(manager) = manager_for(repo) else {
        return reflink_or_copy(source, dest);
    };
    let lock = lockfile(&manager);
    let same_lock = same_bytes(&repo.join(lock), &worktree.join(lock));
    if source.is_dir() && same_lock {
        return reflink_or_copy(source, dest);
    }

    match manager {
        Manager::Pnpm => install(
            worktree,
            "pnpm",
            &["install", "--prefer-offline", "--frozen-lockfile"],
        ),
        Manager::Npm => install(
            worktree,
            "npm",
            &["ci", "--prefer-offline", "--no-audit", "--no-fund"],
        ),
        Manager::Other(tool) => {
            if source.is_dir() {
                reflink_or_copy(source, dest)?;
                Ok(())
            } else {
                Err(format!(
                    "Hay {lock} pero no node_modules en el checkout principal; instala con {tool}."
                ))
            }
        }
    }
}

fn apply_entry(repo: &Path, worktree: &Path, entry: &BootstrapEntry) -> Result<String, String> {
    let rel = safe_relative(&entry.path)?;
    let source = repo.join(rel);
    let dest = worktree.join(rel);

    if dest.exists() {
        return Ok(format!("{} ya existía", entry.path));
    }
    if !source.exists() {
        return Err(format!("falta {} en el checkout principal", entry.path));
    }

    match entry.mode.as_str() {
        "copy" => copy_tree(&source, &dest)?,
        "clone" => reflink_or_copy(&source, &dest)?,
        "link" => {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("No se pudo crear {}: {e}", parent.display()))?;
            }
            if symlink(&source, &dest).is_err() {
                copy_tree(&source, &dest)?;
            }
        }
        "auto" | "" => {
            if entry.path.trim_end_matches('/').ends_with("node_modules") {
                node_modules_auto(repo, worktree, &source, &dest)?;
            } else {
                reflink_or_copy(&source, &dest)?;
            }
        }
        other => return Err(format!("modo de bootstrap desconocido: '{other}'")),
    }
    Ok(format!("{} listo", entry.path))
}

pub fn apply(repo: &Path, worktree: &Path, entries: &[BootstrapEntry]) -> BootstrapReport {
    let mut report = BootstrapReport::default();
    for entry in entries {
        match apply_entry(repo, worktree, entry) {
            Ok(message) => {
                if message.contains("ya existía") {
                    report.warnings.push(message);
                } else {
                    report.applied.push(message);
                }
            }
            Err(err) if entry.required => report
                .errors
                .push(format!("Bootstrap obligatorio «{}»: {err}.", entry.path)),
            Err(err) => report
                .warnings
                .push(format!("Bootstrap opcional «{}»: {err}.", entry.path)),
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("ot-bootstrap-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn copia_un_fichero_ignorado() {
        let root = temp_dir();
        let repo = root.join("repo");
        let worktree = root.join("wt");
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&worktree).unwrap();
        fs::write(repo.join(".env"), "TOKEN=1\n").unwrap();

        let report = apply(
            &repo,
            &worktree,
            &[BootstrapEntry {
                path: ".env".into(),
                mode: "copy".into(),
                required: true,
            }],
        );

        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(fs::read_to_string(worktree.join(".env")).unwrap(), "TOKEN=1\n");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn obligatorio_que_falta_bloquea_y_opcional_avisa() {
        let root = temp_dir();
        let repo = root.join("repo");
        let worktree = root.join("wt");
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&worktree).unwrap();

        let report = apply(
            &repo,
            &worktree,
            &[
                BootstrapEntry {
                    path: ".env".into(),
                    mode: "copy".into(),
                    required: true,
                },
                BootstrapEntry {
                    path: ".env.local".into(),
                    mode: "copy".into(),
                    required: false,
                },
            ],
        );

        assert_eq!(report.errors.len(), 1);
        assert_eq!(report.warnings.len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn auto_copia_node_modules_si_el_lockfile_coincide() {
        let root = temp_dir();
        let repo = root.join("repo");
        let worktree = root.join("wt");
        fs::create_dir_all(repo.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(&worktree).unwrap();
        fs::write(repo.join("node_modules/pkg/index.js"), "module.exports = 1;\n").unwrap();
        fs::write(repo.join("pnpm-lock.yaml"), "lockfileVersion: 9\n").unwrap();
        fs::write(worktree.join("pnpm-lock.yaml"), "lockfileVersion: 9\n").unwrap();

        let report = apply(
            &repo,
            &worktree,
            &[BootstrapEntry {
                path: "node_modules".into(),
                mode: "auto".into(),
                required: true,
            }],
        );

        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert!(worktree.join("node_modules/pkg/index.js").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rechaza_rutas_inseguras() {
        let root = temp_dir();
        fs::create_dir_all(&root).unwrap();
        let report = apply(
            &root,
            &root,
            &[BootstrapEntry {
                path: "../fuera".into(),
                mode: "copy".into(),
                required: true,
            }],
        );
        assert!(report.errors[0].contains("no válida"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn no_toca_lo_que_ya_existe() {
        let root = temp_dir();
        let repo = root.join("repo");
        let worktree = root.join("wt");
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&worktree).unwrap();
        fs::write(repo.join(".env"), "nuevo\n").unwrap();
        fs::write(worktree.join(".env"), "propio\n").unwrap();

        let report = apply(
            &repo,
            &worktree,
            &[BootstrapEntry {
                path: ".env".into(),
                mode: "copy".into(),
                required: true,
            }],
        );

        assert!(report.warnings[0].contains("ya existía"));
        assert_eq!(fs::read_to_string(worktree.join(".env")).unwrap(), "propio\n");
        let _ = fs::remove_dir_all(&root);
    }
}
