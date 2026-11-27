//! Borrado completo de una feature: preview sin efectos, parada de runners (la
//! hace el comando) y limpieza de worktrees, ramas y carpeta.
//!
//! Reglas duras, en este orden:
//! - Nunca se borra la rama base de una entrada.
//! - Nunca se borra una rama publicada en `origin` o con upstream.
//! - Nunca se borra una rama checkouteada por un worktree ajeno.
//! - Sin `force_dirty`, un worktree sucio aborta antes de tocar nada.
//! - Si algo falla, la feature se queda en el store y se puede reintentar: lo
//!   ya limpiado no vuelve a fallar.
use std::cmp::Reverse;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::features::{FeatureEntry, feature_entries};
use crate::git;
use crate::model::{
    Feature, FeatureDeleteEntry, FeatureDeleteOutcome, FeatureDeletePreview, FeatureDeleteSkip,
};

fn empty_outcome() -> FeatureDeleteOutcome {
    FeatureDeleteOutcome {
        feature_deleted: false,
        removed_worktrees: Vec::new(),
        removed_branches: Vec::new(),
        kept_branches: Vec::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    }
}

fn normalize_branch(value: &str) -> &str {
    value.trim().trim_start_matches("origin/")
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
        (Ok(a), Ok(b)) => a == b,
        _ => left == right,
    }
}

fn depth(path: &Path) -> usize {
    path.components().count()
}

fn unique_repos(entries: &[FeatureEntry]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut repos = Vec::new();
    for entry in entries {
        if seen.insert(entry.repo.clone()) {
            repos.push(entry.repo.clone());
        }
    }
    repos
}

fn branch_in_use_elsewhere(entry: &FeatureEntry) -> Option<String> {
    git::branch_in_use(&entry.repo, &entry.branch)
        .filter(|path| !same_path(path, &entry.path))
        .map(|path| path.to_string_lossy().to_string())
}

fn protect_reason(
    entry: &FeatureEntry,
    branch_exists: bool,
    published: bool,
    in_use: Option<&str>,
) -> Option<String> {
    if !branch_exists {
        return None;
    }
    if entry.branch == normalize_branch(&entry.base) {
        return Some("rama base".into());
    }
    if published {
        return Some("publicada en origin".into());
    }
    in_use.map(|path| format!("en uso en {path}"))
}

/// Plan de borrado sin tocar disco ni red.
pub fn preview(feature: &Feature) -> Result<FeatureDeletePreview, String> {
    let entries = feature_entries(feature)?;
    let mut worktrees = Vec::with_capacity(entries.len());
    let mut warnings = Vec::new();

    for entry in &entries {
        let exists = entry.path.exists();
        if exists
            && !git::worktrees(&entry.repo)
                .iter()
                .any(|worktree| same_path(&worktree.path, &entry.path))
        {
            warnings.push(format!(
                "La carpeta {} existe pero no es un worktree registrado.",
                entry.path.display()
            ));
        }
        let dirty = exists && git::is_dirty(&entry.path);
        let branch_exists = git::local_branch_exists(&entry.repo, &entry.branch);
        let published = branch_exists
            && (git::remote_branch_exists(&entry.repo, &entry.branch)
                || git::branch_has_upstream(&entry.repo, &entry.branch));
        let in_use = if branch_exists {
            branch_in_use_elsewhere(entry)
        } else {
            None
        };
        let protect_reason = protect_reason(entry, branch_exists, published, in_use.as_deref());
        worktrees.push(FeatureDeleteEntry {
            role: entry.role.to_string(),
            name: entry.label.clone(),
            repo_path: entry.repo.to_string_lossy().to_string(),
            path: entry.path.to_string_lossy().to_string(),
            branch: entry.branch.clone(),
            base_branch: entry.base.clone(),
            exists,
            dirty,
            branch_exists,
            branch_published: published,
            branch_in_use: in_use,
            protect_reason,
        });
    }

    Ok(FeatureDeletePreview {
        feature_id: feature.id.clone(),
        name: feature.name.clone(),
        directory: feature.directory.clone(),
        worktrees,
        warnings,
    })
}

fn managed_feature_directory(feature: &Feature, data_dir: &Path) -> bool {
    let expected = data_dir.join("features").join(&feature.id);
    let path = Path::new(&feature.directory);
    match (
        std::fs::canonicalize(path),
        std::fs::canonicalize(&expected),
    ) {
        (Ok(actual), Ok(managed)) => actual == managed,
        _ => path == expected,
    }
}

/// Borra worktrees, ramas y carpeta. No decide nada de persistencia: el
/// comando quita la feature del store solo si `feature_deleted` es `true`.
pub fn delete(
    feature: &Feature,
    force_dirty: bool,
    data_dir: &Path,
) -> Result<FeatureDeleteOutcome, String> {
    let entries = feature_entries(feature)?;
    let mut outcome = empty_outcome();

    for repo in unique_repos(&entries) {
        if let Err(err) = git::fetch(&repo) {
            outcome.warnings.push(format!(
                "No se pudo actualizar {}: {err}. La comprobación de ramas publicadas usa las referencias locales.",
                repo.display()
            ));
        }
    }

    let dirty: Vec<String> = entries
        .iter()
        .filter(|entry| entry.path.exists() && git::is_dirty(&entry.path))
        .map(|entry| entry.path.to_string_lossy().to_string())
        .collect();
    if !dirty.is_empty() && !force_dirty {
        outcome.errors.push(format!(
            "Hay cambios sin commitear en {}. Marca la casilla para eliminarlos o guárdalos antes de borrar la feature.",
            dirty.join(", ")
        ));
        return Ok(outcome);
    }

    // Los targets viven dentro del worktree de la raíz: primero lo profundo.
    let mut order: Vec<usize> = (0..entries.len()).collect();
    order.sort_by_key(|index| Reverse(depth(&entries[*index].path)));
    let mut removable = vec![false; entries.len()];

    for index in order {
        let entry = &entries[index];
        if !entry.path.exists() {
            removable[index] = true;
            continue;
        }
        if !git::worktrees(&entry.repo)
            .iter()
            .any(|worktree| same_path(&worktree.path, &entry.path))
        {
            outcome.errors.push(format!(
                "La carpeta {} no es un worktree registrado; revísala a mano.",
                entry.path.display()
            ));
            continue;
        }
        let force = force_dirty && git::is_dirty(&entry.path);
        match git::worktree_remove(&entry.repo, &entry.path, force) {
            Ok(()) => {
                removable[index] = true;
                outcome
                    .removed_worktrees
                    .push(entry.path.to_string_lossy().to_string());
            }
            Err(err) => outcome.errors.push(format!(
                "No se pudo quitar el worktree {}: {err}",
                entry.path.display()
            )),
        }
    }

    for repo in unique_repos(&entries) {
        git::worktree_prune(&repo);
    }

    for (index, entry) in entries.iter().enumerate() {
        if !removable[index] || !git::local_branch_exists(&entry.repo, &entry.branch) {
            continue;
        }
        let kept = |reason: String| FeatureDeleteSkip {
            repo_path: entry.repo.to_string_lossy().to_string(),
            branch: entry.branch.clone(),
            reason,
        };
        if entry.branch == normalize_branch(&entry.base) {
            outcome.kept_branches.push(kept("rama base".into()));
            continue;
        }
        if git::remote_branch_exists(&entry.repo, &entry.branch)
            || git::branch_has_upstream(&entry.repo, &entry.branch)
        {
            outcome
                .kept_branches
                .push(kept("publicada en origin".into()));
            continue;
        }
        if let Some(path) = git::branch_in_use(&entry.repo, &entry.branch) {
            outcome
                .kept_branches
                .push(kept(format!("en uso en {}", path.display())));
            continue;
        }
        match git::delete_branch(&entry.repo, &entry.branch) {
            Ok(()) => outcome.removed_branches.push(entry.branch.clone()),
            Err(err) => outcome.errors.push(format!(
                "No se pudo borrar la rama '{}' de {}: {err}",
                entry.branch,
                entry.repo.display()
            )),
        }
    }

    if outcome.errors.is_empty() {
        let directory = Path::new(&feature.directory);
        if !managed_feature_directory(feature, data_dir) {
            outcome.warnings.push(format!(
                "La carpeta {} no está bajo <dataDir>/features/{}; no se borró.",
                feature.directory, feature.id
            ));
        } else if directory.exists()
            && let Err(err) = std::fs::remove_dir_all(directory)
        {
            outcome.errors.push(format!(
                "No se pudo borrar la carpeta {}: {err}",
                directory.display()
            ));
        }
    }

    outcome.feature_deleted = outcome.errors.is_empty();
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{FeatureRoot, FeatureScope, FeatureTarget};
    use std::process::Command;

    fn run_git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .expect("git disponible");
        assert!(status.success(), "git {args:?} falló en {}", dir.display());
    }

    fn init_repo(path: &Path) {
        std::fs::create_dir_all(path).unwrap();
        run_git(path, &["init", "-q", "-b", "main"]);
        std::fs::write(path.join(".gitignore"), "repos/\n").unwrap();
        std::fs::write(path.join("README.md"), "demo\n").unwrap();
        run_git(path, &["add", "."]);
        run_git(
            path,
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

    fn feature(root: &Path, meta: &Path, sub: &Path) -> Feature {
        Feature {
            id: "feat-1".into(),
            name: "Demo".into(),
            kind: "feature".into(),
            flow: "standard".into(),
            status: "confirmed".into(),
            brief: "demo".into(),
            issue: None,
            directory: root.join("features/feat-1").to_string_lossy().to_string(),
            root: Some(FeatureRoot {
                repo_id: None,
                name: "Meta".into(),
                repo_path: meta.to_string_lossy().to_string(),
                base_branch: "main".into(),
                branch: "feature/demo".into(),
                relative_path: "meta".into(),
                bootstrap: Vec::new(),
            }),
            targets: vec![FeatureTarget {
                id: "target-sub".into(),
                repo_id: None,
                name: "Sub".into(),
                repo_path: sub.to_string_lossy().to_string(),
                base_branch: "main".into(),
                branch: "feature/demo".into(),
                relative_path: "meta/repos/sub".into(),
                scopes: vec![FeatureScope {
                    id: "scope-root".into(),
                    path: ".".into(),
                }],
                bootstrap: Vec::new(),
            }],
            steps: Vec::new(),
            created_at: 1,
            updated_at: 1,
        }
    }

    fn setup() -> (PathBuf, Feature) {
        let root = std::env::temp_dir().join(format!("ot-delete-{}", uuid::Uuid::new_v4()));
        let meta = root.join("meta-main");
        let sub = root.join("sub-main");
        init_repo(&meta);
        init_repo(&sub);
        let feature = feature(&root, &meta, &sub);
        (root, feature)
    }

    #[test]
    fn borra_worktrees_ramas_y_carpeta() {
        let (root, feature) = setup();
        crate::features::provision(&feature).unwrap();

        let preview = preview(&feature).unwrap();
        assert_eq!(preview.worktrees.len(), 2);
        assert!(preview.worktrees.iter().all(|entry| !entry.dirty));

        let outcome = delete(&feature, false, &root).unwrap();
        assert!(outcome.feature_deleted, "{:?}", outcome.errors);
        assert_eq!(outcome.removed_worktrees.len(), 2);
        assert_eq!(outcome.removed_branches.len(), 2);
        assert!(!Path::new(&feature.directory).exists());
        assert!(!git::local_branch_exists(
            Path::new(&feature.root.as_ref().unwrap().repo_path),
            "feature/demo"
        ));
        assert!(!git::local_branch_exists(
            Path::new(&feature.targets[0].repo_path),
            "feature/demo"
        ));

        // Idempotente: repetirlo no falla por lo ya hecho.
        let again = delete(&feature, false, &root).unwrap();
        assert!(again.feature_deleted);
        assert!(again.errors.is_empty());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn conserva_una_rama_publicada_en_origin() {
        let (root, feature) = setup();
        crate::features::provision(&feature).unwrap();
        let sub = Path::new(&feature.targets[0].repo_path);
        run_git(
            sub,
            &["update-ref", "refs/remotes/origin/feature/demo", "HEAD"],
        );

        let outcome = delete(&feature, false, &root).unwrap();
        assert!(outcome.feature_deleted, "{:?}", outcome.errors);
        assert!(git::local_branch_exists(sub, "feature/demo"));
        assert!(
            outcome
                .kept_branches
                .iter()
                .any(|kept| kept.branch == "feature/demo" && kept.reason.contains("publicada"))
        );
        // La rama del metarepo no estaba publicada y sí se borra.
        assert!(!git::local_branch_exists(
            Path::new(&feature.root.as_ref().unwrap().repo_path),
            "feature/demo"
        ));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn conserva_la_rama_base() {
        let (root, mut feature) = setup();
        feature.targets.clear();
        let meta = PathBuf::from(&feature.root.as_ref().unwrap().repo_path);
        run_git(&meta, &["branch", "develop"]);
        feature.root.as_mut().unwrap().branch = "develop".into();
        feature.root.as_mut().unwrap().base_branch = "develop".into();
        std::fs::create_dir_all(&feature.directory).unwrap();
        let path = Path::new(&feature.directory).join("meta");
        git::worktree_add(&meta, &path, "develop", "develop", true).unwrap();

        let outcome = delete(&feature, false, &root).unwrap();
        assert!(outcome.feature_deleted, "{:?}", outcome.errors);
        assert!(!path.exists());
        assert!(git::local_branch_exists(&meta, "develop"));
        assert!(
            outcome
                .kept_branches
                .iter()
                .any(|kept| kept.reason == "rama base")
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn conserva_una_rama_en_uso_por_otro_worktree() {
        let (root, mut feature) = setup();
        feature.targets.clear();
        let meta = Path::new(&feature.root.as_ref().unwrap().repo_path);
        let other = root.join("otro-worktree");
        git::worktree_add(meta, &other, "feature/demo", "main", false).unwrap();

        let outcome = delete(&feature, false, &root).unwrap();
        assert!(outcome.feature_deleted, "{:?}", outcome.errors);
        assert!(git::local_branch_exists(meta, "feature/demo"));
        assert!(
            outcome
                .kept_branches
                .iter()
                .any(|kept| kept.reason.contains("en uso en"))
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn sin_force_aborta_antes_de_tocar_si_hay_cambios() {
        let (root, feature) = setup();
        crate::features::provision(&feature).unwrap();
        let sub_path = Path::new(&feature.directory).join("meta/repos/sub");
        std::fs::write(sub_path.join("pendiente.txt"), "sin commitear\n").unwrap();

        let preview = preview(&feature).unwrap();
        assert!(preview.worktrees.iter().any(|entry| entry.dirty));

        let outcome = delete(&feature, false, &root).unwrap();
        assert!(!outcome.feature_deleted);
        assert!(outcome.errors[0].contains("cambios sin commitear"));
        assert!(sub_path.exists());
        assert!(Path::new(&feature.directory).exists());
        assert!(git::local_branch_exists(
            Path::new(&feature.targets[0].repo_path),
            "feature/demo"
        ));

        let forced = delete(&feature, true, &root).unwrap();
        assert!(forced.feature_deleted, "{:?}", forced.errors);
        assert!(!sub_path.exists());
        assert!(!Path::new(&feature.directory).exists());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn un_fallo_parcial_conserva_la_feature_y_el_reintento_termina() {
        let (root, feature) = setup();
        crate::features::provision(&feature).unwrap();
        let sub_path = Path::new(&feature.directory).join("meta/repos/sub");
        let sub_repo = Path::new(&feature.targets[0].repo_path);
        git::worktree_remove(sub_repo, &sub_path, true).unwrap();
        std::fs::create_dir_all(&sub_path).unwrap();
        std::fs::write(sub_path.join("resto.txt"), "carpeta suelta\n").unwrap();

        let first = delete(&feature, false, &root).unwrap();
        assert!(!first.feature_deleted);
        assert!(first.errors[0].contains("no es un worktree registrado"));
        assert!(Path::new(&feature.directory).exists());
        assert!(git::local_branch_exists(sub_repo, "feature/demo"));

        // El primer intento quitó la raíz y con ella la carpeta suelta; el
        // reintento solo tiene que borrar la rama que quedó y el registro.
        let _ = std::fs::remove_dir_all(&sub_path);
        let second = delete(&feature, false, &root).unwrap();
        assert!(second.feature_deleted, "{:?}", second.errors);
        assert!(!git::local_branch_exists(sub_repo, "feature/demo"));
        assert!(!Path::new(&feature.directory).exists());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn no_borra_una_carpeta_fuera_de_features() {
        let (root, mut feature) = setup();
        feature.targets.clear();
        let outside = root.join("fuera");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("importante.txt"), "no tocar\n").unwrap();
        feature.directory = outside.to_string_lossy().to_string();

        let outcome = delete(&feature, false, &root).unwrap();
        assert!(outcome.feature_deleted, "{:?}", outcome.errors);
        assert!(outside.join("importante.txt").exists());
        assert!(
            outcome
                .warnings
                .iter()
                .any(|warning| warning.contains("no se borró"))
        );

        std::fs::remove_dir_all(&root).ok();
    }
}
