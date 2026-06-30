// TaskFlow 桌面端：加载打包的前端，指向部署的后端（VITE_API_BASE 注入）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running TaskFlow");
}
