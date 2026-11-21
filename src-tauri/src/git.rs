use std::path::{Path, PathBuf};
use std::process::Command;

fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| format!("No se pudo ejecutar git: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            format!("git {} falló", args.join(" "))
        } else {
            detail
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn succeeds(dir: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn toplevel(path: &Path) -> Result<PathBuf, String> {
    if !path.is_dir() {
        return Err(format!("'{}' no es una carpeta", path.display()));
    }
    let raw = run(path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| format!("'{}' no es un repositorio git", path.display()))?;
    std::fs::canonicalize(raw.trim())
        .map_err(|e| format!("No se pudo resolver {}: {e}", raw.trim()))
}

pub fn remote_url(repo: &Path) -> Option<String> {
    run(repo, &["remote", "get-url", "origin"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn provider(remote: Option<&str>) -> String {
    match remote {
        Some(url) if url.to_lowercase().contains("github.com") => "github".into(),
        Some(url) if url.to_lowercase().contains("gitlab") => "gitlab".into(),
        Some(_) => "other".into(),
        None => "none".into(),
    }
}

pub fn current_branch(repo: &Path) -> Option<String> {
    let branch = run(repo, &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?;
    let branch = branch.trim().to_string();
    if branch.is_empty() || branch == "HEAD" {
        None
    } else {
        Some(branch)
    }
}

pub fn main_branch(repo: &Path) -> String {
    if let Ok(value) = run(
        repo,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    ) {
        let branch = value.trim().trim_start_matches("origin/");
        if !branch.is_empty() {
            return branch.to_string();
        }
    }
    current_branch(repo).unwrap_or_else(|| "main".into())
}

pub fn local_branch_exists(repo: &Path, branch: &str) -> bool {
    succeeds(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
}

pub fn remote_branch_exists(repo: &Path, branch: &str) -> bool {
    succeeds(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/remotes/origin/{branch}"),
        ],
    )
}

pub fn fetch(repo: &Path) -> Result<(), String> {
    if remote_url(repo).is_none() {
        return Ok(());
    }
    run(repo, &["fetch", "--prune", "origin"]).map(|_| ())
}

pub fn worktree_add(
    repo: &Path,
    path: &Path,
    branch: &str,
    base: &str,
    use_existing_branch: bool,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear {}: {e}", parent.display()))?;
    }
    let path_str = path.to_string_lossy().to_string();
    if use_existing_branch {
        run(repo, &["worktree", "add", &path_str, branch]).map(|_| ())
    } else {
        run(repo, &["worktree", "add", "-b", branch, &path_str, base]).map(|_| ())
    }
}

pub fn worktree_remove(repo: &Path, path: &Path, force: bool) -> Result<(), String> {
    let path_str = path.to_string_lossy().to_string();
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&path_str);
    run(repo, &args).map(|_| ())
}

pub fn worktree_prune(repo: &Path) {
    let _ = run(repo, &["worktree", "prune"]);
}

pub fn is_dirty(worktree: &Path) -> bool {
    if !worktree.exists() {
        return false;
    }
    match run(worktree, &["status", "--porcelain"]) {
        Ok(output) => !output.trim().is_empty(),
        Err(_) => false,
    }
}

/// Convierte un nombre libre en un slug apto para rama y carpeta.
pub fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "workspace".into()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn slugifies_free_text() {
        assert_eq!(slugify("Programar  API"), "programar-api");
        assert_eq!(slugify("fix: login en Safari"), "fix-login-en-safari");
        assert_eq!(slugify("  "), "workspace");
        assert_eq!(slugify("Ñandú"), "and");
    }

    #[test]
    fn detects_the_provider_from_the_remote() {
        assert_eq!(provider(Some("git@github.com:acme/app.git")), "github");
        assert_eq!(provider(Some("https://gitlab.com/acme/app.git")), "gitlab");
        assert_eq!(provider(Some("https://example.com/acme/app.git")), "other");
        assert_eq!(provider(None), "none");
    }

    #[test]
    fn creates_a_worktree_and_removes_it_keeping_the_branch() {
        let root = std::env::temp_dir().join(format!("openconf-git-{}", uuid::Uuid::new_v4()));
        let repo = root.join("repo");
        fs::create_dir_all(&repo).unwrap();
        let setup = |args: &[&str]| {
            let output = Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(["-c", "user.name=test", "-c", "user.email=test@example.com"])
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        setup(&["init", "-q"]);
        fs::write(repo.join("readme.md"), "hola").unwrap();
        setup(&["add", "."]);
        setup(&["commit", "-q", "-m", "init"]);

        let base = current_branch(&repo).expect("rama actual");
        let worktree = root.join("worktrees/login");
        worktree_add(&repo, &worktree, "feature/login", &base, false).unwrap();

        assert!(worktree.is_dir());
        assert!(local_branch_exists(&repo, "feature/login"));
        assert!(!is_dirty(&worktree));
        fs::write(worktree.join("readme.md"), "cambio").unwrap();
        assert!(is_dirty(&worktree));

        worktree_remove(&repo, &worktree, true).unwrap();
        worktree_prune(&repo);

        assert!(!worktree.exists());
        // Se conserva la rama al borrar el worktree.
        assert!(local_branch_exists(&repo, "feature/login"));
        fs::remove_dir_all(root).ok();
    }
}
