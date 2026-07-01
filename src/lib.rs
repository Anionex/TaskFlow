pub mod agent;
pub mod ai;
pub mod auth;
pub mod checkin;
pub mod config;
pub mod data;
pub mod models;
pub mod recycle;
pub mod response;
pub mod state;
pub mod scheduler;
pub mod tasks;
pub mod templates;
pub mod user;
pub mod util;

use std::sync::Arc;

use axum::{
    routing::{delete, get, post, put},
    Json, Router,
};
use tower_http::cors::CorsLayer;

use crate::config::Config;
use crate::response::{ok, ApiResponse};
use crate::state::{AppState, SharedState};

/// テスト用の設定（ポートは無視される）
pub struct TestConfig {
    pub database_url: String,
    pub port: u16,
    pub llm_base_url: String,
    pub llm_api_key: String,
    pub llm_model: String,
    pub llm_model_strong: String,
    pub contact_email: String,
}

impl From<TestConfig> for Config {
    fn from(t: TestConfig) -> Self {
        Config {
            database_url: t.database_url,
            port: t.port,
            llm_base_url: t.llm_base_url,
            llm_api_key: t.llm_api_key,
            llm_model: t.llm_model,
            llm_model_strong: t.llm_model_strong,
            contact_email: t.contact_email,
        }
    }
}

pub fn build_app(pool: sqlx::PgPool, config: TestConfig) -> Router {
    let state: SharedState = Arc::new(AppState {
        db: pool,
        config: config.into(),
        login_attempts: Default::default(),
    });

    Router::new()
        // ── 健康检查
        .route("/api/health", get(health))
        // ── 认证
        .route("/api/register", post(auth::register))
        .route("/api/login", post(auth::login))
        .route("/api/logout", post(auth::logout))
        .route("/api/session", get(auth::session))
        .route("/api/user/password", put(auth::change_password))
        // ── 任务
        .route("/api/tasks", get(tasks::list_tasks).post(tasks::create_task))
        .route("/api/tasks/batch-delete", post(tasks::batch_delete))
        .route("/api/tasks/group", post(tasks::create_group))
        .route("/api/tasks/clear", delete(tasks::clear_tasks))
        .route(
            "/api/tasks/{id}",
            put(tasks::update_task).delete(tasks::delete_task),
        )
        .route("/api/tasks/{id}/toggle", post(tasks::toggle_task))
        // ── 回收站
        .route(
            "/api/recycle",
            get(recycle::list_recycle).delete(recycle::clear_recycle),
        )
        .route("/api/recycle/{id}/restore", post(recycle::restore_task))
        .route("/api/recycle/{id}", delete(recycle::permanent_delete))
        // ── 模板
        .route(
            "/api/templates",
            get(templates::list_templates).post(templates::create_template),
        )
        .route("/api/templates/generate", post(templates::generate_tasks))
        .route(
            "/api/templates/{id}",
            put(templates::update_template).delete(templates::delete_template),
        )
        // ── 打卡
        .route("/api/checkin/status", get(checkin::checkin_status))
        .route("/api/checkin", post(checkin::checkin))
        // ── 用户中心
        .route("/api/user/profile", get(user::get_profile))
        .route("/api/user/stats", get(user::get_stats))
        .route(
            "/api/user/settings",
            get(user::get_settings).put(user::update_settings),
        )
        // ── 导入导出
        .route("/api/export", get(data::export_data))
        .route("/api/import", post(data::import_data))
        // ── AI
        .route("/api/ai/parse", post(ai::parse_task))
        .route("/api/ai/braindump", post(ai::brain_dump))
        .route("/api/ai/rewrite", post(ai::rewrite_task))
        .route("/api/ai/decompose", post(ai::decompose_task))
        .route("/api/ai/search", post(ai::semantic_search))
        .route("/api/ai/morning", get(ai::morning_recommend))
        .route("/api/ai/evening", get(ai::evening_summary))
        // ── Agent 模式（多轮 + 工具读写 + 确认）
        .route("/api/ai/agent", post(agent::agent_chat))
        .with_state(state)
        .layer(CorsLayer::permissive())
}

async fn health() -> Json<ApiResponse> {
    ok("服务正常", serde_json::json!({ "status": "ok" }))
}
