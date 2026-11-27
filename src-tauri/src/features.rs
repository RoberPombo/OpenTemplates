/**
 * Materialización de una feature: un worktree por repo (metarepo y subrepos)
 * en su ruta relativa, con rama local propia y base remota.
 *
 * Nada de `git submodule update`: se parte de `origin/<base>` para trabajar
 * fresco y el gitlink se actualizará al integrar. Si algo falla a mitad, se
 * deshace lo creado (worktree y rama) para no dejar la feature en un estado
 * ambiguo.
 */
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use crate::bootstrap;
use crate::git;
use crate::model::{BootstrapEntry, Feature, ProvisionedWorktree};

struct Entry {
    role: &'static str,
    label: String,
    repo: PathBuf,
    path: PathBuf,
    branch: String,
    base: String,
    bootstrap: Vec<BootstrapEntry>,
}

#[derive(Debug)]
pub struct ProvisionReport {
    pub worktrees: Vec<ProvisionedWorktree>,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub applied: Vec<String>,
}

pub(crate) fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if relative.trim().is_empty() {
        return Err("Una ruta de worktree está vacía.".into());
    }
    if rel.is_absolute()
        || rel.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!("Ruta de worktree no válida: '{relative}'."));
    }
    Ok(base.join(rel))
}

fn resolve_base(repo: &Path, base: &str) -> String {
    if git::remote_branch_exists(repo, base) {
        format!("origin/{base}")
    } else {
        base.to_string()
    }
}

fn provisioned(entry: &Entry) -> ProvisionedWorktree {
    ProvisionedWorktree {
        role: entry.role.to_string(),
        repo_path: entry.repo.to_string_lossy().to_string(),
        path: entry.path.to_string_lossy().to_string(),
        branch: entry.branch.clone(),
        base: resolve_base(&entry.repo, &entry.base),
    }
}

fn rollback(entries: &[Entry], created: &[usize]) {
    for index in created.iter().rev() {
        let entry = &entries[*index];
        let _ = git::worktree_remove(&entry.repo, &entry.path, true);
        git::worktree_prune(&entry.repo);
        let _ = git::delete_branch(&entry.repo, &entry.branch);
    }
}

fn apply_bootstrap(entries: &[Entry], report: &mut ProvisionReport) {
    for entry in entries {
        let result = bootstrap::apply(&entry.repo, &entry.path, &entry.bootstrap);
        report.applied.extend(result.applied);
        report.warnings.extend(result.warnings);
        report.errors.extend(result.errors);
    }
}

fn entries_for(feature: &Feature) -> Result<Vec<Entry>, String> {
    let base_dir = Path::new(&feature.directory);
    if !base_dir.is_absolute() {
        return Err("La carpeta de la feature debe ser una ruta absoluta.".into());
    }

    let mut entries = Vec::new();
    if let Some(root) = &feature.root {
        entries.push(Entry {
            role: "root",
            label: root.name.clone(),
            repo: PathBuf::from(&root.repo_path),
            path: safe_join(base_dir, &root.relative_path)?,
            branch: root.branch.clone(),
            base: root.base_branch.clone(),
            bootstrap: root.bootstrap.clone(),
        });
    }
    for target in &feature.targets {
        entries.push(Entry {
            role: "target",
            label: target.name.clone(),
            repo: PathBuf::from(&target.repo_path),
            path: safe_join(base_dir, &target.relative_path)?,
            branch: target.branch.clone(),
            base: target.base_branch.clone(),
            bootstrap: target.bootstrap.clone(),
        });
    }
    if entries.is_empty() {
        return Err("La feature no tiene repos que provisionar.".into());
    }

    let mut seen = HashSet::new();
    for entry in &entries {
        if !seen.insert(entry.path.clone()) {
            return Err(format!(
                "Dos repos apuntan a la misma ruta: {}",
                entry.path.display()
            ));
        }
    }
    Ok(entries)
}

/// Crea los worktrees que falten y aplica el bootstrap. Idempotente.
pub fn provision(feature: &Feature) -> Result<ProvisionReport, String> {
    if feature.status == "draft" {
        return Err("Confirma el alcance de la feature antes de crear los worktrees.".into());
    }
    if !matches!(
        feature.status.as_str(),
        "confirmed" | "running" | "blocked"
    ) {
        return Err(format!(
            "No se puede provisionar una feature en estado '{}'.",
            feature.status
        ));
    }

    let entries = entries_for(feature)?;

    let existing: Vec<usize> = entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| entry.path.exists())
        .map(|(index, _)| index)
        .collect();
    let missing: Vec<usize> = entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| !entry.path.exists())
        .map(|(index, _)| index)
        .collect();

    if missing.is_empty() {
        let mut report = ProvisionReport {
            worktrees: entries.iter().map(provisioned).collect(),
            warnings: vec!["Los worktrees ya existían; no se tocó nada.".into()],
            errors: Vec::new(),
            applied: Vec::new(),
        };
        apply_bootstrap(&entries, &mut report);
        report.warnings.extend(crate::artifacts::ensure(feature));
        return Ok(report);
    }

    // Valida todos los repos y ramas que faltan antes de crear nada.
    for index in &missing {
        let entry = &entries[*index];
        git::toplevel(&entry.repo).map_err(|_| {
            format!(
                "«{}» no es un repo git: {}",
                entry.label,
                entry.repo.display()
            )
        })?;
        if git::local_branch_exists(&entry.repo, &entry.branch) {
            return Err(format!(
                "La rama '{}' ya existe en «{}». Cambia el nombre de la feature.",
                entry.branch, entry.label
            ));
        }
    }

    let base_dir = Path::new(&feature.directory);
    std::fs::create_dir_all(base_dir)
        .map_err(|e| format!("No se pudo crear {}: {e}", base_dir.display()))?;

    let mut warnings = Vec::new();
    let mut created: Vec<usize> = Vec::new();

    for index in &missing {
        let entry = &entries[*index];
        if let Err(err) = git::fetch(&entry.repo) {
            warnings.push(format!(
                "No se pudo actualizar «{}»: {err}. Se usa la referencia local.",
                entry.label
            ));
        }
        let base = resolve_base(&entry.repo, &entry.base);
        match git::worktree_add(&entry.repo, &entry.path, &entry.branch, &base, false) {
            Ok(()) => created.push(*index),
            Err(err) => {
                rollback(&entries, &created);
                return Err(format!(
                    "No se pudo crear el worktree de «{}»: {err}. Se deshizo lo creado.",
                    entry.label
                ));
            }
        }
    }

    if !existing.is_empty() {
        warnings.push(format!(
            "{} worktree(s) ya existían; se crearon {}.",
            existing.len(),
            missing.len()
        ));
    }

    let mut report = ProvisionReport {
        worktrees: entries.iter().map(provisioned).collect(),
        warnings,
        errors: Vec::new(),
        applied: Vec::new(),
    };
    // Solo se aplica bootstrap en los worktrees nuevos: no se pisa lo que el
    // usuario ya tenga en los existentes.
    for index in &missing {
        let entry = &entries[*index];
        let result = bootstrap::apply(&entry.repo, &entry.path, &entry.bootstrap);
        report.applied.extend(result.applied);
        report.warnings.extend(result.warnings);
        report.errors.extend(result.errors);
    }
    report.warnings.extend(crate::artifacts::ensure(feature));
    Ok(report)
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
            directory: root.join("feature").to_string_lossy().to_string(),
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

    #[test]
    fn crea_metarepo_y_subrepo_y_es_idempotente() {
        let root = std::env::temp_dir().join(format!("ot-feature-{}", uuid::Uuid::new_v4()));
        let meta = root.join("meta-main");
        let sub = root.join("sub-main");
        init_repo(&meta);
        init_repo(&sub);
        let feature = feature(&root, &meta, &sub);

        let report = provision(&feature).unwrap();
        assert_eq!(report.worktrees.len(), 2);
        assert!(report.warnings.is_empty());
        assert!(root.join("feature/meta/.git").exists());
        assert!(root.join("feature/meta/repos/sub/.git").exists());
        assert!(git::local_branch_exists(&meta, "feature/demo"));
        assert!(git::local_branch_exists(&sub, "feature/demo"));

        let again = provision(&feature).unwrap();
        assert_eq!(again.worktrees.len(), 2);
        assert!(again.warnings[0].contains("ya existían"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn crea_solo_los_worktrees_que_faltan_al_ampliar_el_alcance() {
        let root = std::env::temp_dir().join(format!("ot-feature-{}", uuid::Uuid::new_v4()));
        let meta = root.join("meta-main");
        let sub = root.join("sub-main");
        let extra = root.join("extra-main");
        init_repo(&meta);
        init_repo(&sub);
        init_repo(&extra);
        let mut feature = feature(&root, &meta, &sub);

        provision(&feature).unwrap();
        feature.targets.push(FeatureTarget {
            id: "target-extra".into(),
            repo_id: None,
            name: "Extra".into(),
            repo_path: extra.to_string_lossy().to_string(),
            base_branch: "main".into(),
            branch: "feature/demo".into(),
            relative_path: "meta/repos/extra".into(),
            scopes: vec![FeatureScope {
                id: "scope-root".into(),
                path: ".".into(),
            }],
            bootstrap: Vec::new(),
        });

        let report = provision(&feature).unwrap();
        assert_eq!(report.worktrees.len(), 3);
        assert!(report.warnings.iter().any(|item| item.contains("se crearon 1")));
        assert!(root.join("feature/meta/repos/extra/.git").exists());
        assert!(root.join("feature/meta/.git").exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn no_provisiona_un_borrador() {
        let root = std::env::temp_dir().join(format!("ot-feature-{}", uuid::Uuid::new_v4()));
        let mut feature = feature(&root, &root.join("meta"), &root.join("sub"));
        feature.status = "draft".into();
        assert!(provision(&feature).unwrap_err().contains("Confirma"));
    }

    #[test]
    fn avisa_si_la_rama_ya_existe_antes_de_crear() {
        let root = std::env::temp_dir().join(format!("ot-feature-{}", uuid::Uuid::new_v4()));
        let meta = root.join("meta-main");
        let sub = root.join("sub-main");
        init_repo(&meta);
        init_repo(&sub);
        run_git(&meta, &["branch", "feature/demo"]);
        let feature = feature(&root, &meta, &sub);

        let error = provision(&feature).unwrap_err();
        assert!(error.contains("ya existe"));
        assert!(!root.join("feature/meta").exists());
    }
}
