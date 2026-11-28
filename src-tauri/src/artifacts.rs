/**
 * Artefactos de una feature: `BRIEF.md`, `DECOMPOSITION.md`, `NOTES.md` y los
 * que produce cada paso (`RECON-*`, `PLAN-*`, `VERIFY-*`). Son la memoria
 * compartida entre sesiones: el coordinador deja el plan y los demás lo leen.
 */
use std::fs;
use std::path::{Path, PathBuf};

use crate::model::{Feature, FeatureArtifact};

const FIXED: [&str; 3] = ["BRIEF.md", "DECOMPOSITION.md", "NOTES.md"];
const PREFIXES: [&str; 3] = ["RECON-", "PLAN-", "VERIFY-"];

/// Tope por artefacto escrito por el backend. Son notas de coordinación, no
/// adjuntos: 1 MiB deja margen de sobra y evita que un webview comprometido
/// llene el disco con una sola llamada.
const MAX_ARTIFACT_BYTES: usize = 1024 * 1024;

fn allowed(name: &str) -> bool {
    if !name.ends_with(".md") || name.contains('/') || name.contains('\\') || name.contains("..") {
        return false;
    }
    FIXED.contains(&name) || PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

fn path_for(feature: &Feature, name: &str) -> Result<PathBuf, String> {
    if !allowed(name) {
        return Err(format!(
            "Nombre de artefacto no válido: '{name}'. Usa BRIEF.md, DECOMPOSITION.md, NOTES.md o RECON-/PLAN-/VERIFY-<scope>.md."
        ));
    }
    Ok(Path::new(&feature.directory).join(name))
}

fn write_file(feature: &Feature, name: &str, content: &str) -> Result<FeatureArtifact, String> {
    let path = path_for(feature, name)?;
    if content.len() > MAX_ARTIFACT_BYTES {
        return Err(format!(
            "El artefacto '{name}' ocupa {} bytes y supera el tope de {MAX_ARTIFACT_BYTES} bytes (1 MiB).",
            content.len()
        ));
    }
    let dir = Path::new(&feature.directory);
    fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    fs::write(&path, content)
        .map_err(|e| format!("No se pudo escribir {}: {e}", path.display()))?;
    Ok(FeatureArtifact {
        name: name.to_string(),
        content: content.to_string(),
    })
}

fn brief_content(feature: &Feature) -> String {
    let mut out = format!("# {}\n\n{}\n", feature.name, feature.brief.trim());
    if let Some(issue) = &feature.issue {
        out.push_str(&format!("\nIssue: #{} — {}\n", issue.number, issue.title));
        if let Some(url) = &issue.url {
            out.push_str(&format!("{url}\n"));
        }
    }
    out
}

/// Crea BRIEF.md y NOTES.md si faltan. Idempotente; no pisa lo editado.
pub fn ensure(feature: &Feature) -> Vec<String> {
    let mut warnings = Vec::new();
    if !Path::new(&feature.directory).join("BRIEF.md").exists()
        && let Err(err) = write_file(feature, "BRIEF.md", &brief_content(feature))
    {
        warnings.push(format!("No se pudo escribir BRIEF.md: {err}"));
    }
    if !Path::new(&feature.directory).join("NOTES.md").exists()
        && let Err(err) = write_file(feature, "NOTES.md", "# Notas\n\n")
    {
        warnings.push(format!("No se pudo escribir NOTES.md: {err}"));
    }
    warnings
}

pub fn list(feature: &Feature) -> Vec<FeatureArtifact> {
    let dir = Path::new(&feature.directory);
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<FeatureArtifact> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !entry.path().is_file() || !allowed(&name) {
                return None;
            }
            let content = fs::read_to_string(entry.path()).ok()?;
            Some(FeatureArtifact { name, content })
        })
        .collect();
    files.sort_by(|a, b| a.name.cmp(&b.name));
    files
}

pub fn write(feature: &Feature, name: &str, content: &str) -> Result<FeatureArtifact, String> {
    write_file(feature, name, content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::IssueRef;

    fn feature(dir: &Path) -> Feature {
        Feature {
            id: "feat-1".into(),
            name: "Checkout".into(),
            kind: "feature".into(),
            flow: "standard".into(),
            status: "confirmed".into(),
            brief: "Cobrar con Stripe".into(),
            issue: Some(IssueRef {
                number: 7,
                title: "Cobro".into(),
                url: Some("https://example.com/7".into()),
            }),
            directory: dir.to_string_lossy().to_string(),
            root: None,
            targets: Vec::new(),
            steps: Vec::new(),
            created_at: 1,
            updated_at: 1,
        }
    }

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("ot-artifacts-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn crea_brief_y_notas_sin_pisar() {
        let dir = temp_dir();
        let feature = feature(&dir);

        assert!(ensure(&feature).is_empty());
        let brief = fs::read_to_string(dir.join("BRIEF.md")).unwrap();
        assert!(brief.contains("# Checkout"));
        assert!(brief.contains("Cobrar con Stripe"));
        assert!(brief.contains("Issue: #7 — Cobro"));

        fs::write(dir.join("BRIEF.md"), "editado\n").unwrap();
        assert!(ensure(&feature).is_empty());
        assert_eq!(
            fs::read_to_string(dir.join("BRIEF.md")).unwrap(),
            "editado\n"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lista_y_escribe_artefactos_validos() {
        let dir = temp_dir();
        let feature = feature(&dir);

        write(&feature, "DECOMPOSITION.md", "# Plan\n").unwrap();
        write(&feature, "PLAN-front.md", "plan front\n").unwrap();
        write(&feature, "VERIFY-front.md", "ok\n").unwrap();

        let names: Vec<String> = list(&feature).into_iter().map(|item| item.name).collect();
        assert_eq!(
            names,
            vec!["DECOMPOSITION.md", "PLAN-front.md", "VERIFY-front.md"]
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rechaza_nombres_inseguros() {
        let dir = temp_dir();
        let feature = feature(&dir);
        for name in ["../fuera.md", "sub/BRIEF.md", "AGENTS.md", "PLAN.md"] {
            assert!(write(&feature, name, "x").is_err(), "aceptó {name}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rechaza_artefactos_por_encima_del_tope() {
        let dir = temp_dir();
        let feature = feature(&dir);

        let too_big = "a".repeat(MAX_ARTIFACT_BYTES + 1);
        let error = write(&feature, "NOTES.md", &too_big).unwrap_err();
        assert!(error.contains("tope"), "{error}");
        assert!(
            !dir.join("NOTES.md").exists(),
            "no debe escribir si supera el tope"
        );

        let exact = "a".repeat(MAX_ARTIFACT_BYTES);
        assert!(write(&feature, "NOTES.md", &exact).is_ok());
        assert_eq!(
            fs::metadata(dir.join("NOTES.md")).unwrap().len() as usize,
            MAX_ARTIFACT_BYTES
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
