use std::path::Path;
use std::process::Command;
use std::time::Duration;

use serde_json::Value;

use crate::model::{
    CreatePullRequestInput, GhStatus, GitHubIssue, PullRequestCheck, PullRequestComment,
    PullRequestInfo, PullRequestReview,
};
use crate::process::{Output, execute};

const GH_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_BODY: usize = 2_000;
const MAX_ENTRIES: usize = 20;
const DEFAULT_ISSUES: u32 = 30;
const MAX_ISSUES: u32 = 50;
const MAX_ISSUE_SEARCH_CHARS: usize = 200;
const ISSUE_FIELDS: &str = "number,title,labels,author,url,body,state";
const DOCS_INSTALL: &str = "https://cli.github.com/";
const DOCS_AUTH: &str = "https://cli.github.com/manual/gh_auth_login";

fn truncate(value: &str, limit: usize) -> String {
    let text = value.trim();
    if text.chars().count() <= limit {
        return text.to_string();
    }
    text.chars().take(limit).collect::<String>() + "…"
}

fn run_gh_with(program: &str, dir: Option<&Path>, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new(program);
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
    command.args(args);
    match execute(command, "gh", GH_TIMEOUT) {
        Ok(output) => Ok(output),
        Err(error) if which::which(program).is_err() => Err(format!(
            "GitHub CLI (gh) no está instalado. Instálalo desde {DOCS_INSTALL}.\n{error}"
        )),
        Err(error) => Err(error),
    }
}

fn run_gh(dir: Option<&Path>, args: &[&str]) -> Result<Output, String> {
    run_gh_with("gh", dir, args)
}

fn output_text(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stderr.is_empty() { stderr } else { stdout }
}

fn readable_error(output: &Output) -> String {
    let detail = output_text(output);
    let lower = detail.to_lowercase();
    if lower.contains("gh auth login")
        || lower.contains("authentication")
        || lower.contains("not logged in")
    {
        format!("GitHub CLI no tiene sesión iniciada. Ejecuta `gh auth login`.\n{detail}")
    } else if detail.is_empty() {
        "La operación de gh falló sin salida.".into()
    } else {
        detail
    }
}

fn is_missing_pull_request(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("no pull requests found")
        || lower.contains("no pull request found")
        || lower.contains("no open pull requests")
}

/// Instalación y sesión de `gh`, con un mensaje claro si falta algo.
pub fn status() -> GhStatus {
    if which::which("gh").is_err() {
        return GhStatus {
            installed: false,
            authenticated: false,
            version: None,
            message: Some(format!(
                "GitHub CLI (gh) no está instalado. Instálalo desde {DOCS_INSTALL} para crear y revisar pull requests."
            )),
            docs_url: DOCS_INSTALL.into(),
        };
    }

    let version = run_gh(None, &["--version"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or_default()
                .trim()
                .to_string()
        })
        .filter(|line| !line.is_empty());

    match run_gh(None, &["auth", "status"]) {
        Ok(output) if output.status.success() => GhStatus {
            installed: true,
            authenticated: true,
            version,
            message: None,
            docs_url: DOCS_AUTH.into(),
        },
        Ok(output) => GhStatus {
            installed: true,
            authenticated: false,
            version,
            message: Some(format!(
                "GitHub CLI está instalado pero no tiene sesión iniciada. Ejecuta `gh auth login`.\n{}",
                output_text(&output)
            )),
            docs_url: DOCS_AUTH.into(),
        },
        Err(error) => GhStatus {
            installed: true,
            authenticated: false,
            version,
            message: Some(format!(
                "No se pudo comprobar la sesión de GitHub CLI. Ejecuta `gh auth login`.\n{error}"
            )),
            docs_url: DOCS_AUTH.into(),
        },
    }
}

fn json_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn json_optional(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|item| !item.is_empty())
}

fn author_of(value: &Value) -> String {
    value
        .get("author")
        .and_then(|author| author.get("login"))
        .and_then(Value::as_str)
        .unwrap_or("desconocido")
        .to_string()
}

fn parse_review(value: &Value) -> PullRequestReview {
    PullRequestReview {
        author: author_of(value),
        state: json_string(value.get("state")),
        body: truncate(&json_string(value.get("body")), MAX_BODY),
        submitted_at: json_optional(value.get("submittedAt")),
    }
}

fn parse_comment(value: &Value) -> PullRequestComment {
    PullRequestComment {
        author: author_of(value),
        body: truncate(&json_string(value.get("body")), MAX_BODY),
        created_at: json_optional(value.get("createdAt")),
        url: json_optional(value.get("url")),
    }
}

fn parse_pull_request(value: &Value) -> PullRequestInfo {
    let reviews = value
        .get("reviews")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(MAX_ENTRIES)
                .map(parse_review)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let comments = value
        .get("comments")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(MAX_ENTRIES)
                .map(parse_comment)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    PullRequestInfo {
        number: value.get("number").and_then(Value::as_u64).unwrap_or(0),
        title: json_string(value.get("title")),
        state: json_string(value.get("state")),
        url: json_string(value.get("url")),
        is_draft: value
            .get("isDraft")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        base_branch: json_string(value.get("baseRefName")),
        head_branch: json_string(value.get("headRefName")),
        review_decision: json_optional(value.get("reviewDecision")),
        reviews,
        comments,
    }
}

fn bucket_of(item: &Value) -> String {
    if let Some(bucket) = json_optional(item.get("bucket")) {
        return match bucket.to_lowercase().as_str() {
            "pass" => "passed".into(),
            "fail" | "cancel" => "failed".into(),
            "skipping" => "skipped".into(),
            "pending" => "pending".into(),
            other => other.to_string(),
        };
    }
    let state = json_string(
        item.get("conclusion")
            .or_else(|| item.get("state"))
            .or_else(|| item.get("status")),
    )
    .to_lowercase();
    match state.as_str() {
        "success" | "neutral" => "passed".into(),
        "skipped" => "skipped".into(),
        "failure" | "cancelled" | "timed_out" | "action_required" | "error" | "startup_failure" => {
            "failed".into()
        }
        "pending" | "queued" | "in_progress" | "waiting" | "expected" => "pending".into(),
        _ => "pending".into(),
    }
}

fn parse_check(item: &Value) -> PullRequestCheck {
    let name = json_optional(item.get("name"))
        .or_else(|| json_optional(item.get("context")))
        .unwrap_or_else(|| "check".into());
    let state = json_optional(item.get("state"))
        .or_else(|| json_optional(item.get("conclusion")))
        .or_else(|| json_optional(item.get("status")))
        .unwrap_or_else(|| "UNKNOWN".into());
    PullRequestCheck {
        name,
        state,
        bucket: bucket_of(item),
        url: json_optional(item.get("link"))
            .or_else(|| json_optional(item.get("detailsUrl")))
            .or_else(|| json_optional(item.get("targetUrl"))),
        workflow: json_optional(item.get("workflow"))
            .or_else(|| json_optional(item.get("workflowName"))),
    }
}

/// PR de la rama actual; `None` cuando la rama todavía no tiene PR.
pub fn pr_view(project: &Path) -> Result<Option<PullRequestInfo>, String> {
    let fields =
        "number,title,state,url,isDraft,baseRefName,headRefName,reviewDecision,reviews,comments";
    let output = run_gh(Some(project), &["pr", "view", "--json", fields])?;
    if !output.status.success() {
        let detail = output_text(&output);
        if is_missing_pull_request(&detail) {
            return Ok(None);
        }
        return Err(readable_error(&output));
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("gh devolvió una PR ilegible: {error}"))?;
    Ok(Some(parse_pull_request(&value)))
}

/// Checks de la PR actual. `gh pr checks` sale con código 1 si alguno falla:
/// el JSON sigue siendo válido y se acepta.
pub fn pr_checks(project: &Path) -> Result<Vec<PullRequestCheck>, String> {
    let output = run_gh(
        Some(project),
        &["pr", "checks", "--json", "name,state,bucket,link,workflow"],
    )?;
    let raw = String::from_utf8_lossy(&output.stdout);
    if let Ok(value) = serde_json::from_str::<Value>(raw.trim())
        && let Some(items) = value.as_array()
    {
        return Ok(items.iter().map(parse_check).collect());
    }
    if !output.status.success() {
        return Err(readable_error(&output));
    }
    Ok(Vec::new())
}

/// Crea una PR con título y cuerpo ya editados por el usuario.
pub fn pr_create(input: &CreatePullRequestInput) -> Result<String, String> {
    if input.title.trim().is_empty() {
        return Err("El título de la pull request no puede estar vacío.".into());
    }
    if input.base.trim().is_empty() || input.head.trim().is_empty() {
        return Err("La rama base y la rama de la PR son obligatorias.".into());
    }
    let output = run_gh(
        Some(Path::new(&input.project_path)),
        &[
            "pr",
            "create",
            "--base",
            input.base.trim(),
            "--head",
            input.head.trim(),
            "--title",
            input.title.trim(),
            "--body",
            &input.body,
        ],
    )?;
    if !output.status.success() {
        return Err(readable_error(&output));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let url = stdout
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("http"))
        .unwrap_or_else(|| stdout.trim());
    if url.is_empty() {
        return Err("gh creó la PR pero no devolvió su enlace.".into());
    }
    Ok(url.to_string())
}

fn issue_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(DEFAULT_ISSUES).clamp(1, MAX_ISSUES)
}

fn issue_search(search: Option<&str>) -> Option<String> {
    let text: String = search?
        .chars()
        .filter(|c| *c == ' ' || !c.is_control())
        .collect();
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(MAX_ISSUE_SEARCH_CHARS).collect())
}

fn issue_list_args(search: Option<&str>, limit: Option<u32>) -> Vec<String> {
    let mut args = vec![
        "issue".to_string(),
        "list".to_string(),
        "--state".to_string(),
        "open".to_string(),
        "--limit".to_string(),
        issue_limit(limit).to_string(),
        "--json".to_string(),
        ISSUE_FIELDS.to_string(),
    ];
    if let Some(query) = issue_search(search) {
        args.push(format!("--search={query}"));
    }
    args
}

fn parse_labels(value: &Value) -> Vec<String> {
    let mut labels: Vec<String> = Vec::new();
    let Some(items) = value.as_array() else {
        return labels;
    };
    for item in items {
        let name = item
            .as_str()
            .map(str::to_string)
            .or_else(|| json_optional(item.get("name")));
        let Some(name) = name else { continue };
        if name.trim().is_empty() || labels.len() >= MAX_ENTRIES || labels.contains(&name) {
            continue;
        }
        labels.push(name);
    }
    labels
}

fn parse_issue(value: &Value) -> Option<GitHubIssue> {
    if let Some(state) = value.get("state").and_then(Value::as_str)
        && !state.eq_ignore_ascii_case("OPEN")
    {
        return None;
    }
    let number = value.get("number").and_then(Value::as_u64).unwrap_or(0);
    if number == 0 {
        return None;
    }
    let (body, body_truncated) = crate::issue::sanitize_body(&json_string(value.get("body")));
    Some(GitHubIssue {
        number,
        title: truncate(&json_string(value.get("title")), 300),
        labels: parse_labels(value.get("labels").unwrap_or(&Value::Null)),
        author: truncate(&author_of(value), 100),
        url: json_string(value.get("url")),
        body,
        body_truncated,
    })
}

fn issue_list_with(
    program: &str,
    project: &Path,
    search: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<GitHubIssue>, String> {
    let args = issue_list_args(search, limit);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_gh_with(program, Some(project), &refs)?;
    if !output.status.success() {
        return Err(readable_error(&output));
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("gh devolvió una lista de issues ilegible: {error}"))?;
    let Some(items) = value.as_array() else {
        return Err("gh devolvió una lista de issues con un formato inesperado.".into());
    };
    Ok(items.iter().filter_map(parse_issue).collect())
}

/// Issues abiertos del repo remoto, con búsqueda y límite acotado. Solo lectura:
/// no se crea, cierra, edita ni comenta ningún issue.
pub fn issue_list(
    project: &Path,
    search: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<GitHubIssue>, String> {
    issue_list_with("gh", project, search, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detecta_cuando_la_rama_no_tiene_pr() {
        assert!(is_missing_pull_request(
            "no pull requests found for branch \"feat/x\""
        ));
        assert!(is_missing_pull_request("No open pull requests"));
        assert!(!is_missing_pull_request("HTTP 401: Bad credentials"));
    }

    #[test]
    fn parsea_la_pr_y_tolera_autores_nulos() {
        let value = json!({
            "number": 12,
            "title": "Flujo git",
            "state": "OPEN",
            "url": "https://github.com/acme/app/pull/12",
            "isDraft": false,
            "baseRefName": "develop",
            "headRefName": "feat/git-y-pr",
            "reviewDecision": "CHANGES_REQUESTED",
            "reviews": [
                { "author": { "login": "ana" }, "state": "CHANGES_REQUESTED", "body": "falta un test", "submittedAt": "2026-01-01T00:00:00Z" },
                { "author": null, "state": "COMMENTED", "body": "ojo" }
            ],
            "comments": [
                { "author": { "login": "luis" }, "body": "revisa el borde", "createdAt": "2026-01-02T00:00:00Z", "url": "https://github.com/acme/app/pull/12#c1" }
            ]
        });
        let pr = parse_pull_request(&value);
        assert_eq!(pr.number, 12);
        assert_eq!(pr.base_branch, "develop");
        assert_eq!(pr.head_branch, "feat/git-y-pr");
        assert_eq!(pr.reviews[0].author, "ana");
        assert_eq!(pr.reviews[1].author, "desconocido");
        assert_eq!(
            pr.comments[0].url.as_deref(),
            Some("https://github.com/acme/app/pull/12#c1")
        );
    }

    #[test]
    fn clasifica_los_checks_por_bucket_y_por_estado() {
        let items = [
            json!({ "name": "tests", "state": "SUCCESS", "bucket": "pass", "link": "https://ci/1", "workflow": "CI" }),
            json!({ "name": "lint", "state": "FAILURE", "bucket": "fail", "link": "https://ci/2" }),
            json!({ "name": "build", "status": "IN_PROGRESS", "conclusion": null }),
            json!({ "name": "deploy", "state": "SKIPPED", "bucket": "skipping" }),
        ];
        let checks: Vec<PullRequestCheck> = items.iter().map(parse_check).collect();
        assert_eq!(checks[0].bucket, "passed");
        assert_eq!(checks[0].url.as_deref(), Some("https://ci/1"));
        assert_eq!(checks[1].bucket, "failed");
        assert_eq!(checks[2].bucket, "pending");
        assert_eq!(checks[3].bucket, "skipped");
    }

    #[test]
    fn recorta_los_cuerpos_largos() {
        let body = "x".repeat(MAX_BODY + 40);
        let value = json!({ "author": { "login": "ana" }, "state": "COMMENTED", "body": body });
        let review = parse_review(&value);
        assert!(review.body.chars().count() <= MAX_BODY + 1);
        assert!(review.body.ends_with('…'));
    }

    #[test]
    fn acota_limite_y_busqueda_de_issues() {
        let args = issue_list_args(Some("  login\n"), Some(500));
        let joined = args.join(" ");
        assert!(joined.contains("issue list --state open"));
        assert!(joined.contains("--limit 50"));
        assert!(joined.contains("--search=login"));
        assert!(!joined.contains("create"));
        assert!(!joined.contains("close"));
        assert!(!joined.contains("comment"));

        let args = issue_list_args(None, Some(0));
        assert!(args.join(" ").contains("--limit 1"));
        assert!(!args.iter().any(|arg| arg.starts_with("--search=")));
    }

    #[test]
    fn parsea_issues_con_etiquetas_autor_y_cuerpo_saneado() {
        let issue = parse_issue(&json!({
            "number": 12,
            "title": "Cobro roto",
            "state": "OPEN",
            "url": "https://github.com/acme/app/issues/12",
            "author": { "login": "ana" },
            "labels": [{ "name": "bug" }, { "name": "pagos" }, { "name": "bug" }],
            "body": "El pago falla.\r\nToken: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }))
        .expect("issue abierto");
        assert_eq!(issue.number, 12);
        assert_eq!(issue.title, "Cobro roto");
        assert_eq!(issue.labels, vec!["bug", "pagos"]);
        assert_eq!(issue.author, "ana");
        assert!(issue.body.contains("El pago falla."));
        assert!(issue.body.contains("[credencial oculta]"));
        assert!(!issue.body.contains("ghp_"));
        assert!(!issue.body_truncated);
    }

    #[test]
    fn descarta_issues_cerrados_y_sin_numero() {
        assert!(
            parse_issue(&json!({ "number": 1, "title": "viejo", "state": "CLOSED" })).is_none()
        );
        assert!(parse_issue(&json!({ "title": "sin número", "state": "OPEN" })).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn ejecuta_la_lista_con_un_gh_simulado() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("ot-gh-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("gh");
        let json = r#"[{"number":7,"title":"Cobro","state":"OPEN","url":"https://example.com/7","author":{"login":"ana"},"labels":[{"name":"bug"}],"body":"Detalle"}]"#;
        let content = format!(
            "#!/bin/sh\ncase \"$*\" in\n  *\"issue list\"*\"--state open\"*\"--limit 3\"*\"--search=cobro\"*) printf '%s' '{json}' ;;\n  *) echo \"args inesperados: $*\" >&2; exit 2 ;;\nesac\n"
        );
        std::fs::write(&script, content).unwrap();
        let mut perms = std::fs::metadata(&script).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).unwrap();

        let issues =
            issue_list_with(script.to_str().unwrap(), &dir, Some("cobro"), Some(3)).unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].number, 7);
        assert_eq!(issues[0].labels, vec!["bug"]);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
