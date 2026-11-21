mod commands;
mod config;
mod git;
mod library;
mod model;
mod server;
mod state;
mod store;
mod templates;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(AppState::load(data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::list_library,
            commands::list_mcps,
            commands::list_skills,
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
            commands::reapply_template,
            commands::delete_workspace,
            commands::start_workspace,
            commands::stop_workspace,
            commands::workspace_status,
            commands::worktree_status,
            commands::workspace_log,
            commands::get_settings,
            commands::save_settings,
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
