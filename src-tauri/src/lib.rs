mod commands;
mod config;
mod gh;
mod git;
mod library;
mod model;
mod preview;
mod process;
mod resources;
mod server;
mod state;
mod store;
mod templates;

use std::path::Path;

use tauri::Manager;

use state::AppState;

/// Identificador con el que se publicó la app antes de llamarse OpenTemplates.
const LEGACY_IDENTIFIER: &str = "com.alukard.openconf";

/// Mueve el directorio de datos de la versión anterior al actual la primera vez
/// que arranca con el identificador nuevo, para no perder workspaces ni ajustes.
fn migrate_legacy_data_dir(data_dir: &Path) {
    if data_dir.exists() {
        return;
    }
    let Some(parent) = data_dir.parent() else {
        return;
    };
    let legacy = parent.join(LEGACY_IDENTIFIER);
    if !legacy.is_dir() {
        return;
    }
    if let Err(err) = std::fs::rename(&legacy, data_dir) {
        eprintln!(
            "[opentemplates] no se pudo migrar {} a {}: {err}",
            legacy.display(),
            data_dir.display()
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            migrate_legacy_data_dir(&data_dir);
            std::fs::create_dir_all(&data_dir)?;
            app.manage(AppState::load(data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::list_library,
            commands::list_mcps,
            commands::list_skills,
            commands::list_available_models,
            commands::list_repos,
            commands::add_repo,
            commands::refresh_repo,
            commands::remove_repo,
            commands::list_templates,
            commands::save_template,
            commands::delete_template,
            commands::template_agents_md,
            commands::save_template_agents_md,
            commands::create_workspace,
            commands::update_workspace,
            commands::set_workspace_disabled,
            commands::reapply_template,
            commands::delete_workspace,
            commands::start_workspace,
            commands::stop_workspace,
            commands::workspace_status,
            commands::worktree_status,
            commands::workspace_log,
            commands::git_status,
            commands::git_stage,
            commands::git_unstage,
            commands::git_diff,
            commands::git_commit,
            commands::git_push,
            commands::git_commits,
            commands::gh_status,
            commands::gh_pr_view,
            commands::gh_pr_checks,
            commands::gh_pr_create,
            commands::resources,
            commands::get_settings,
            commands::save_settings,
            commands::write_text_file,
            commands::read_text_file,
            commands::preview_probe,
            commands::open_external,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit)
                && let Some(state) = app_handle.try_state::<AppState>()
            {
                state.kill_all();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "opentemplates-lib-{label}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn migra_el_directorio_de_datos_anterior() {
        let root = temp_root("migra");
        let legacy = root.join(LEGACY_IDENTIFIER);
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("workspaces.json"), "[]").unwrap();

        let data_dir = root.join("com.alukard.opentemplates");
        migrate_legacy_data_dir(&data_dir);

        assert!(data_dir.join("workspaces.json").exists());
        assert!(!legacy.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn no_toca_el_directorio_actual_si_ya_existe() {
        let root = temp_root("existente");
        let legacy = root.join(LEGACY_IDENTIFIER);
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("workspaces.json"), "[\"viejo\"]").unwrap();
        let data_dir = root.join("com.alukard.opentemplates");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::write(data_dir.join("workspaces.json"), "[\"nuevo\"]").unwrap();

        migrate_legacy_data_dir(&data_dir);

        assert_eq!(
            std::fs::read_to_string(data_dir.join("workspaces.json")).unwrap(),
            "[\"nuevo\"]"
        );
        assert!(legacy.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
