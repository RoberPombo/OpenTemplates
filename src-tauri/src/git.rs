use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::model::{
    GitCommitResult, GitCommitSummary, GitMergeResult, GitPushResult, GitStatusOutput,
    GitUntrackedStat,
};
use crate::process::{execute, Output};

const GIT_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_OUTPUT: usize = 12_000;
const MAX_UNTRACKED_STATS: usize = 200;

fn git_command(dir: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command.arg("-C").arg(dir).args(args);
    command
}

fn git_output(dir: &Path, args: &[&str]) -> Result<Output, String> {
    execute(git_command(dir, args), "git", GIT_TIMEOUT)
}

fn truncate(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    value.chars().take(limit).collect::<String>() + "\n… (salida recortada)"
}

fn failure_detail(output: &Output, args: &[&str]) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let mut parts = Vec::new();
    if !stderr.is_empty() {
        parts.push(stderr);
    }
    if !stdout.is_empty() {
        parts.push(stdout);
    }
    let detail = parts.join("\n");
    if detail.is_empty() {
        format!("git {} falló", args.join(" "))
    } else {
        truncate(&detail, MAX_OUTPUT)
    }
}

fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_output(dir, args)?;
    if !output.status.success() {
        return Err(failure_detail(&output, args));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_raw(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_output(dir, args)?;
    if !output.status.success() {
        return Err(failure_detail(&output, args));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn succeeds(dir: &Path, args: &[&str]) -> bool {
    git_output(dir, args)
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

/// Borra una rama local (solo para deshacer una creación a medias).
pub fn delete_branch(repo: &Path, branch: &str) -> Result<(), String> {
    run(repo, &["branch", "-D", branch]).map(|_| ())
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

fn head_exists(repo: &Path) -> bool {
    succeeds(repo, &["rev-parse", "--verify", "--quiet", "HEAD"])
}

fn upstream_name(repo: &Path) -> Option<String> {
    run(
        repo,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn ahead_behind(repo: &Path) -> Option<String> {
    run(
        repo,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn untracked_paths(repo: &Path) -> Result<Vec<String>, String> {
    let raw = run_raw(repo, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    Ok(raw
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .take(MAX_UNTRACKED_STATS)
        .collect())
}

fn untracked_stat(repo: &Path, path: &str) -> GitUntrackedStat {
    let full = repo.join(path);
    let file = match File::open(&full) {
        Ok(file) => file,
        Err(_) => {
            return GitUntrackedStat {
                path: path.to_string(),
                additions: 0,
                binary: true,
            };
        }
    };
    let mut bytes = Vec::new();
    // Bastante para detectar binarios y contar líneas de ficheros normales.
    let _ = file.take(4 * 1024 * 1024).read_to_end(&mut bytes);
    let sample = &bytes[..bytes.len().min(8_000)];
    if sample.contains(&0) {
        return GitUntrackedStat {
            path: path.to_string(),
            additions: 0,
            binary: true,
        };
    }
    let mut additions = bytes.iter().filter(|byte| **byte == b'\n').count() as u64;
    if !bytes.is_empty() && !bytes.ends_with(b"\n") {
        additions += 1;
    }
    GitUntrackedStat {
        path: path.to_string(),
        additions,
        binary: false,
    }
}

fn untracked_stats(repo: &Path) -> Vec<GitUntrackedStat> {
    untracked_paths(repo)
        .map(|paths| {
            paths
                .iter()
                .map(|path| untracked_stat(repo, path))
                .collect()
        })
        .unwrap_or_default()
}

/// Estado completo del árbol de trabajo. Devuelve la salida cruda de git para
/// que el parseo de porcelain y numstat viva en el dominio TypeScript.
pub fn status(repo: &Path) -> Result<GitStatusOutput, String> {
    if !repo.is_dir() {
        return Err(format!("'{}' no es una carpeta", repo.display()));
    }
    let porcelain = run_raw(
        repo,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let numstat = if head_exists(repo) {
        run_raw(repo, &["diff", "HEAD", "--numstat", "-z"])?
    } else {
        // Repositorio sin primer commit: lo preparado es todo lo que hay.
        run_raw(repo, &["diff", "--cached", "--numstat", "-z"])?
    };
    let upstream = upstream_name(repo);
    Ok(GitStatusOutput {
        branch: current_branch(repo),
        ahead_behind: upstream.as_ref().and_then(|_| ahead_behind(repo)),
        upstream,
        remote: remote_url(repo),
        main_branch: main_branch(repo),
        porcelain,
        numstat,
        untracked_stats: untracked_stats(repo),
    })
}

/// Prepara ficheros concretos. `git add -- <rutas>` también registra borrados.
pub fn stage(repo: &Path, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("No hay archivos para preparar.".into());
    }
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    run(repo, &args).map(|_| ())
}

/// Quita ficheros del índice sin tocar el árbol de trabajo.
pub fn unstage(repo: &Path, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("No hay archivos para quitar del stage.".into());
    }
    let mut args = if head_exists(repo) {
        vec!["restore", "--staged", "--"]
    } else {
        vec!["rm", "--cached", "--"]
    };
    args.extend(paths.iter().map(String::as_str));
    run(repo, &args).map(|_| ())
}

fn commit_args(message: &str) -> Vec<&str> {
    // Nunca `--no-verify`: si un hook falla, se muestra su salida y no se sigue.
    vec!["commit", "-m", message]
}

fn push_args(branch: &str, set_upstream: bool) -> Vec<&str> {
    // Nunca `--force` ni `-f`. La única variante es publicar con `-u`.
    if set_upstream {
        vec!["push", "-u", "origin", branch]
    } else {
        vec!["push"]
    }
}

pub fn commit(repo: &Path, message: &str) -> Result<GitCommitResult, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("El mensaje del commit no puede estar vacío.".into());
    }
    let args = commit_args(message);
    run(repo, &args).map_err(|error| format!("El commit falló:\n{error}"))?;
    let oid = run(repo, &["rev-parse", "HEAD"])
        .map_err(|error| format!("El commit se creó pero no se pudo leer su hash: {error}"))?;
    Ok(GitCommitResult { oid })
}

pub fn push(repo: &Path, branch: &str, set_upstream: bool) -> Result<GitPushResult, String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("No hay una rama para publicar.".into());
    }
    let args = push_args(branch, set_upstream);
    run(repo, &args).map_err(|error| format!("El push falló:\n{error}"))?;
    let upstream = upstream_name(repo);
    let remote = if set_upstream {
        "origin".to_string()
    } else {
        upstream
            .as_deref()
            .and_then(|name| name.split('/').next())
            .unwrap_or("origin")
            .to_string()
    };
    Ok(GitPushResult {
        branch: branch.to_string(),
        remote,
        upstream,
    })
}

/// Diff preparado (o del árbol de trabajo) para el mensaje y la vista.
pub fn diff(repo: &Path, staged: bool) -> Result<String, String> {
    let args = if staged {
        vec!["diff", "--cached", "--no-color", "--no-ext-diff"]
    } else {
        vec!["diff", "--no-color", "--no-ext-diff"]
    };
    run_raw(repo, &args)
}

fn common_dir(repo: &Path) -> Result<PathBuf, String> {
    let raw = run(
        repo,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .or_else(|_| run(repo, &["rev-parse", "--git-common-dir"]))?;
    let path = PathBuf::from(raw.trim());
    let absolute = if path.is_absolute() {
        path
    } else {
        repo.join(path)
    };
    std::fs::canonicalize(&absolute)
        .map_err(|e| format!("No se pudo resolver {}: {e}", absolute.display()))
}

/// Cuenta ficheros y líneas de la salida `--numstat -z` y devuelve sus rutas.
fn parse_numstat(raw: &[u8]) -> (u64, u64, u64, Vec<String>) {
    let mut files = 0_u64;
    let mut additions = 0_u64;
    let mut deletions = 0_u64;
    let mut paths = Vec::new();
    for record in raw.split(|byte| *byte == 0) {
        if record.is_empty() {
            continue;
        }
        let text = String::from_utf8_lossy(record);
        let mut parts = text.splitn(3, '\t');
        let added = parts.next().unwrap_or_default();
        let removed = parts.next().unwrap_or_default();
        let path = parts.next().unwrap_or_default();
        if path.is_empty() {
            continue;
        }
        files += 1;
        additions += added.parse::<u64>().unwrap_or(0);
        deletions += removed.parse::<u64>().unwrap_or(0);
        paths.push(path.to_string());
    }
    (files, additions, deletions, paths)
}

/// Rutas del parche que `git apply` señala como no aplicables. No depende del
/// idioma configurado en git: cruza la salida con las rutas que ya conocemos.
fn conflict_paths(stderr: &str, touched: &[String]) -> Vec<String> {
    touched
        .iter()
        .filter(|path| stderr.contains(path.as_str()))
        .cloned()
        .collect()
}

fn temporal_patch(payload: &[u8]) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "opentemplates-merge-{}-{stamp}.patch",
        std::process::id()
    ));
    std::fs::write(&path, payload)
        .map_err(|e| format!("No se pudo escribir el parche temporal: {e}"))?;
    Ok(path)
}

/// Aplica los cambios sin commitear de `source` sobre `destination`.
///
/// Prepara todo en el worktree de origen y aplica un parche binario en el
/// destino. Antes de escribir comprueba que el parche encaja; si no, devuelve
/// `conflict` sin tocar el destino. Los cambios aplicados se preparan en el
/// índice del destino y no se crea ningún commit. `base` es la rama de la que
/// salió el worktree: si el agente hizo commits, se incluyen comparando desde
/// el ancestro común.
pub fn merge_worktree(
    destination: &Path,
    source: &Path,
    base: Option<&str>,
) -> Result<GitMergeResult, String> {
    let destination = toplevel(destination)?;
    let source = toplevel(source)?;
    if destination == source {
        return Err("El worktree de origen y el destino son la misma carpeta.".into());
    }
    if common_dir(&destination)? != common_dir(&source)? {
        return Err("El worktree de origen no pertenece al mismo repositorio.".into());
    }

    run(&source, &["add", "-A"])?;
    let base = base
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .and_then(|branch| run(&source, &["merge-base", "HEAD", branch]).ok())
        .filter(|commit| !commit.is_empty())
        .unwrap_or_else(|| "HEAD".to_string());
    let raw_stat = run_raw(&source, &["diff", "--cached", "--numstat", "-z", &base])?;
    let (files, additions, deletions, paths) = parse_numstat(raw_stat.as_bytes());
    if files == 0 {
        return Ok(GitMergeResult {
            status: "empty".into(),
            files: 0,
            additions: 0,
            deletions: 0,
            conflicts: Vec::new(),
            message: None,
        });
    }

    let patch = git_output(
        &source,
        &[
            "diff",
            "--cached",
            "--binary",
            "--no-color",
            "--no-ext-diff",
            &base,
        ],
    )?;
    if !patch.status.success() {
        return Err(failure_detail(&patch, &["diff", "--cached", &base]));
    }
    let patch_path = temporal_patch(&patch.stdout)?;
    let patch_arg = patch_path.to_string_lossy().to_string();
    let result = (|| {
        let check = git_output(&destination, &["apply", "--check", "--binary", &patch_arg])?;
        if !check.status.success() {
            let detail = failure_detail(&check, &["apply", "--check"]);
            return Ok(GitMergeResult {
                status: "conflict".into(),
                files,
                additions,
                deletions,
                conflicts: conflict_paths(&String::from_utf8_lossy(&check.stderr), &paths),
                message: Some(truncate(&detail, 4_000)),
            });
        }
        let applied = git_output(&destination, &["apply", "--binary", &patch_arg])?;
        if !applied.status.success() {
            return Err(failure_detail(&applied, &["apply", "--binary"]));
        }
        let mut args: Vec<&str> = vec!["add", "--"];
        args.extend(paths.iter().map(String::as_str));
        run(&destination, &args)?;
        Ok(GitMergeResult {
            status: "merged".into(),
            files,
            additions,
            deletions,
            conflicts: Vec::new(),
            message: None,
        })
    })();
    let _ = std::fs::remove_file(&patch_path);
    result
}

const COMMIT_FORMAT: &str = "--format=%H%x1f%s%x1f%b%x1e";

fn parse_commit_log(raw: &str) -> Vec<GitCommitSummary> {
    raw.split('\x1e')
        .filter(|record| !record.trim().is_empty())
        .filter_map(|record| {
            let mut parts = record.trim_start_matches('\n').splitn(3, '\x1f');
            let hash = parts.next()?.trim().to_string();
            let subject = parts.next()?.trim().to_string();
            let body = parts.next().unwrap_or_default().trim().to_string();
            (!hash.is_empty()).then_some(GitCommitSummary {
                hash,
                subject,
                body,
            })
        })
        .collect()
}

/// Commits de la rama que no están en `base`, para el borrador de la PR.
pub fn commits(
    repo: &Path,
    base: &str,
    limit: Option<usize>,
) -> Result<Vec<GitCommitSummary>, String> {
    let limit = limit.unwrap_or(30).clamp(1, 100);
    let max = format!("--max-count={limit}");
    let range = format!("{}..HEAD", base.trim());
    let raw = if base.trim().is_empty() {
        run_raw(repo, &["log", COMMIT_FORMAT, &max, "HEAD"])?
    } else {
        run_raw(repo, &["log", COMMIT_FORMAT, &max, &range])
            .or_else(|_| run_raw(repo, &["log", COMMIT_FORMAT, &max, "HEAD"]))?
    };
    Ok(parse_commit_log(&raw))
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

    fn run_git(dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=test", "-c", "user.email=test@example.com"])
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_repo(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "opentemplates-git-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        let repo = root.join("repo");
        fs::create_dir_all(&repo).unwrap();
        run_git(&repo, &["init", "-q"]);
        // CI no tiene identidad global: el repo temporal la fija en local.
        run_git(&repo, &["config", "user.name", "test"]);
        run_git(&repo, &["config", "user.email", "test@example.com"]);
        fs::write(repo.join("readme.md"), "hola\n").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-q", "-m", "init"]);
        repo
    }

    #[test]
    fn los_argumentos_del_commit_nunca_saltan_hooks() {
        let args = commit_args("feat: algo");
        assert_eq!(args, vec!["commit", "-m", "feat: algo"]);
        assert!(!args.contains(&"--no-verify"));
    }

    #[test]
    fn los_argumentos_del_push_nunca_fuerzan() {
        assert_eq!(
            push_args("feat/x", true),
            vec!["push", "-u", "origin", "feat/x"]
        );
        assert_eq!(push_args("feat/x", false), vec!["push"]);
        for arg in push_args("feat/x", true)
            .into_iter()
            .chain(push_args("feat/x", false))
        {
            assert!(!arg.contains("force"));
            assert_ne!(arg, "-f");
        }
    }

    #[test]
    fn prepara_quita_y_commitea_solo_lo_elegido() {
        let repo = init_repo("stage");
        fs::write(repo.join("a.txt"), "uno\n").unwrap();
        fs::write(repo.join("b.txt"), "dos\ntres\n").unwrap();

        stage(&repo, &["a.txt".to_string()]).unwrap();
        let state = status(&repo).unwrap();
        assert!(state.porcelain.contains("A  a.txt"), "{}", state.porcelain);
        assert!(state.porcelain.contains("?? b.txt"), "{}", state.porcelain);
        let stat = state
            .untracked_stats
            .iter()
            .find(|stat| stat.path == "b.txt")
            .expect("estadísticas de b.txt");
        assert_eq!(stat.additions, 2);

        unstage(&repo, &["a.txt".to_string()]).unwrap();
        let state = status(&repo).unwrap();
        assert!(state.porcelain.contains("?? a.txt"), "{}", state.porcelain);

        stage(&repo, &["a.txt".to_string()]).unwrap();
        let commit = commit(&repo, "feat: añade a").unwrap();
        assert!(!commit.oid.is_empty());
        let state = status(&repo).unwrap();
        assert!(!state.porcelain.contains("a.txt"), "{}", state.porcelain);
        assert!(state.porcelain.contains("?? b.txt"), "{}", state.porcelain);
        std::fs::remove_dir_all(repo.parent().unwrap()).ok();
    }

    #[cfg(unix)]
    #[test]
    fn un_hook_que_falla_detiene_el_commit_y_devuelve_su_salida() {
        use std::os::unix::fs::PermissionsExt;

        let repo = init_repo("hook");
        fs::write(repo.join("readme.md"), "cambio\n").unwrap();
        run_git(&repo, &["add", "."]);
        let hook = repo.join(".git/hooks/pre-commit");
        fs::write(&hook, "#!/bin/sh\necho 'hook roto' >&2\nexit 1\n").unwrap();
        let mut permissions = fs::metadata(&hook).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&hook, permissions).unwrap();

        let before = run(&repo, &["rev-parse", "HEAD"]).unwrap();
        let error = commit(&repo, "feat: no debería entrar").unwrap_err();
        assert!(error.contains("hook roto"), "{error}");
        assert_eq!(run(&repo, &["rev-parse", "HEAD"]).unwrap(), before);
        std::fs::remove_dir_all(repo.parent().unwrap()).ok();
    }

    #[test]
    fn publica_una_rama_nueva_con_upstream() {
        let repo = init_repo("push");
        let root = repo.parent().unwrap();
        let remote = root.join("remote.git");
        std::fs::create_dir_all(&remote).unwrap();
        run_git(&remote, &["init", "--bare", "-q"]);
        run_git(
            &repo,
            &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
        );
        run_git(&repo, &["switch", "-q", "-c", "feature/x"]);
        fs::write(repo.join("nuevo.txt"), "contenido\n").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-q", "-m", "feat: nuevo"]);

        let result = push(&repo, "feature/x", true).unwrap();
        assert_eq!(result.branch, "feature/x");
        assert_eq!(result.remote, "origin");
        assert_eq!(result.upstream.as_deref(), Some("origin/feature/x"));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn creates_a_worktree_and_removes_it_keeping_the_branch() {
        let root = std::env::temp_dir().join(format!("opentemplates-git-{}", uuid::Uuid::new_v4()));
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

    fn race_worktree(repo: &Path, label: &str) -> PathBuf {
        let base = current_branch(repo).expect("rama actual");
        let worktree = repo
            .parent()
            .expect("raíz temporal")
            .join(format!("worktrees/{label}"));
        worktree_add(repo, &worktree, &format!("carrera/{label}"), &base, false).unwrap();
        worktree
    }

    #[test]
    fn fusiona_altas_modificaciones_y_borrados_sin_commit() {
        let repo = init_repo("merge");
        fs::write(repo.join("borrar.txt"), "fuera\n").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-q", "-m", "base"]);
        let before = run(&repo, &["rev-parse", "HEAD"]).unwrap();
        let worktree = race_worktree(&repo, "merge-1");

        fs::write(worktree.join("readme.md"), "hola mundo\n").unwrap();
        fs::write(worktree.join("nuevo.txt"), "nuevo\n").unwrap();
        fs::remove_file(worktree.join("borrar.txt")).unwrap();

        let result = merge_worktree(&repo, &worktree, None).unwrap();
        assert_eq!(result.status, "merged");
        assert_eq!(result.files, 3);
        assert_eq!(result.additions, 2);
        assert_eq!(result.deletions, 2);
        assert!(result.conflicts.is_empty(), "{:?}", result.conflicts);
        assert_eq!(
            fs::read_to_string(repo.join("readme.md")).unwrap(),
            "hola mundo\n"
        );
        assert_eq!(
            fs::read_to_string(repo.join("nuevo.txt")).unwrap(),
            "nuevo\n"
        );
        assert!(!repo.join("borrar.txt").exists());
        assert_eq!(run(&repo, &["rev-parse", "HEAD"]).unwrap(), before);

        let state = status(&repo).unwrap();
        assert!(
            state.porcelain.contains("M  readme.md"),
            "{}",
            state.porcelain
        );
        assert!(
            state.porcelain.contains("A  nuevo.txt"),
            "{}",
            state.porcelain
        );
        assert!(
            state.porcelain.contains("D  borrar.txt"),
            "{}",
            state.porcelain
        );
        fs::remove_dir_all(repo.parent().unwrap()).ok();
    }

    #[test]
    fn incluye_los_commits_hechos_en_el_worktree() {
        let repo = init_repo("merge-commits");
        let base = current_branch(&repo).expect("rama actual");
        let worktree = race_worktree(&repo, "merge-commits-1");
        fs::write(worktree.join("readme.md"), "commit desde la carrera\n").unwrap();
        run_git(&worktree, &["add", "."]);
        run_git(&worktree, &["commit", "-q", "-m", "carrera"]);

        let result = merge_worktree(&repo, &worktree, Some(&base)).unwrap();
        assert_eq!(result.status, "merged");
        assert_eq!(
            fs::read_to_string(repo.join("readme.md")).unwrap(),
            "commit desde la carrera\n"
        );
        assert!(status(&repo).unwrap().porcelain.contains("M  readme.md"));
        fs::remove_dir_all(repo.parent().unwrap()).ok();
    }

    #[test]
    fn una_corrida_sin_cambios_no_toca_el_destino() {
        let repo = init_repo("merge-empty");
        let before = run(&repo, &["rev-parse", "HEAD"]).unwrap();
        let worktree = race_worktree(&repo, "merge-empty-1");

        let result = merge_worktree(&repo, &worktree, None).unwrap();
        assert_eq!(result.status, "empty");
        assert_eq!(result.files, 0);
        assert!(result.message.is_none());
        assert_eq!(status(&repo).unwrap().porcelain.trim(), "");
        assert_eq!(run(&repo, &["rev-parse", "HEAD"]).unwrap(), before);
        fs::remove_dir_all(repo.parent().unwrap()).ok();
    }

    #[test]
    fn un_conflicto_deja_el_destino_intacto() {
        let repo = init_repo("merge-conflict");
        let worktree = race_worktree(&repo, "merge-conflict-1");
        fs::write(worktree.join("readme.md"), "hola desde la carrera\n").unwrap();
        fs::write(repo.join("readme.md"), "adios desde el workspace\n").unwrap();
        let before = run(&repo, &["rev-parse", "HEAD"]).unwrap();

        let result = merge_worktree(&repo, &worktree, None).unwrap();
        assert_eq!(result.status, "conflict");
        assert_eq!(result.files, 1);
        assert!(
            result.conflicts.iter().any(|path| path == "readme.md"),
            "{:?}",
            result.conflicts
        );
        assert!(result
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("readme.md"));
        assert_eq!(
            fs::read_to_string(repo.join("readme.md")).unwrap(),
            "adios desde el workspace\n"
        );
        assert_eq!(run(&repo, &["rev-parse", "HEAD"]).unwrap(), before);
        let state = status(&repo).unwrap();
        assert!(
            state.porcelain.contains(" M readme.md"),
            "{}",
            state.porcelain
        );
        fs::remove_dir_all(repo.parent().unwrap()).ok();
    }

    #[test]
    fn solo_fusiona_worktrees_del_mismo_repositorio() {
        let repo = init_repo("merge-scope");
        let other = init_repo("merge-other");
        let error = merge_worktree(&repo, &other, None).unwrap_err();
        assert!(error.contains("mismo repositorio"), "{error}");
        let error = merge_worktree(&repo, &repo, None).unwrap_err();
        assert!(error.contains("misma carpeta"), "{error}");
        fs::remove_dir_all(repo.parent().unwrap()).ok();
        fs::remove_dir_all(other.parent().unwrap()).ok();
    }
}
