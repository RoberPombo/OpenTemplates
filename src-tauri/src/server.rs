use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;

use crate::model::{ServerInfo, Workspace};

pub struct ServerHandle {
    pub port: u16,
    pub password: String,
    pub child: Child,
}

fn write_log(path: &Path, line: &str) {
    use std::io::Write;
    let clean = if line.to_lowercase().contains("password") {
        "[password redactada]"
    } else {
        line
    };
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{clean}");
    }
}

pub async fn spawn(
    workspace: &Workspace,
    workspace_dir: &Path,
    bin: &Path,
) -> Result<(ServerHandle, ServerInfo), String> {
    let log_dir = workspace_dir.join("logs");
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("No se pudo crear {}: {e}", log_dir.display()))?;
    let log_path = log_dir.join("server.log");

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("No hay puerto libre: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("No se pudo leer el puerto: {e}"))?
        .port();
    drop(listener);

    let password = uuid::Uuid::new_v4().simple().to_string();

    let mut command = Command::new(bin);
    command
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--cors")
        .arg("http://localhost:1420")
        .arg("--cors")
        .arg("http://tauri.localhost")
        .arg("--cors")
        .arg("https://tauri.localhost")
        .arg("--cors")
        .arg("tauri://localhost")
        .current_dir(&workspace.project_path)
        .env("XDG_CONFIG_HOME", workspace_dir.join("xdg"))
        .env("OPENCODE_DB", workspace_dir.join("opencode.db"))
        .env("OPENCODE_DISABLE_PROJECT_CONFIG", "1")
        .env("OPENCODE_DISABLE_AUTOUPDATE", "1")
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .env_remove("OPENCODE_CONFIG")
        .env_remove("OPENCODE_CONFIG_CONTENT")
        .env_remove("OPENCODE_CONFIG_DIR")
        .env_remove("OPENCODE_SESSION_ID")
        .env_remove("OPENCODE_PASSWORD")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|e| format!("No se pudo lanzar opencode ({}): {e}", bin.display()))?;

    let stdout = child.stdout.take().ok_or("Sin stdout de opencode")?;
    let stderr = child.stderr.take().ok_or("Sin stderr de opencode")?;
    let (ready_tx, ready_rx) = oneshot::channel::<()>();

    let stdout_log = log_path.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut ready = Some(ready_tx);
        while let Ok(Some(line)) = lines.next_line().await {
            write_log(&stdout_log, &line);
            if line.contains("server listening")
                && let Some(tx) = ready.take()
            {
                let _ = tx.send(());
            }
        }
    });

    let stderr_log = log_path.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            write_log(&stderr_log, &line);
        }
    });

    tokio::select! {
        _ = ready_rx => {}
        status = child.wait() => {
            return Err(match status {
                Ok(status) => format!("opencode terminó antes de arrancar ({status})"),
                Err(err) => format!("opencode falló antes de arrancar: {err}"),
            });
        }
        _ = tokio::time::sleep(Duration::from_secs(30)) => {
            let _ = child.start_kill();
            return Err("opencode no arrancó en 30 segundos".into());
        }
    }

    let info = ServerInfo {
        workspace_id: workspace.id.clone(),
        base_url: format!("http://127.0.0.1:{port}"),
        password: password.clone(),
        port,
        pid: child.id().unwrap_or(0),
    };

    Ok((
        ServerHandle {
            port,
            password,
            child,
        },
        info,
    ))
}

pub fn terminate(child: &mut Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
        return;
    }
    let _ = child.start_kill();
}

pub async fn stop(mut handle: ServerHandle) {
    terminate(&mut handle.child);
    if tokio::time::timeout(Duration::from_secs(5), handle.child.wait())
        .await
        .is_err()
    {
        let _ = handle.child.start_kill();
    }
}

pub fn is_alive(handle: &mut ServerHandle) -> bool {
    matches!(handle.child.try_wait(), Ok(None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[tokio::test]
    #[ignore]
    async fn serves_its_own_project() {
        let base = std::env::temp_dir().join(format!(
            "opentemplates-server-test-{}",
            uuid::Uuid::new_v4()
        ));
        let project = base.join("project");
        let config_dir = base.join("xdg/opencode");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("opencode.json"),
            r#"{"$schema":"https://opencode.ai/config.json"}"#,
        )
        .unwrap();

        let workspace = Workspace {
            id: "test".into(),
            name: "test".into(),
            project_path: project.to_string_lossy().to_string(),
            ..Workspace::default()
        };

        let bin = which::which("opencode").expect("opencode debe estar en PATH");
        let (handle, info) = spawn(&workspace, &base, &bin).await.unwrap();

        let client = reqwest::Client::new();
        let response = client
            .get(format!("{}/api/info", info.base_url))
            .basic_auth("opencode", Some(&info.password))
            .send()
            .await
            .unwrap();
        assert!(
            response.status().is_success(),
            "info: {}",
            response.status()
        );

        let directory = project.to_string_lossy().to_string();
        let response = client
            .post(format!("{}/api/session", info.base_url))
            .query(&[("location[directory]", directory.as_str())])
            .basic_auth("opencode", Some(&info.password))
            .json(&json!({ "title": "probe" }))
            .send()
            .await
            .unwrap();
        assert!(
            response.status().is_success(),
            "session: {}",
            response.status()
        );

        stop(handle).await;
        fs::remove_dir_all(&base).ok();
    }
}
