use crate::config::Config;
use sqlx::PgPool;
use std::sync::Arc;

/// 跨 handler 共享的应用状态。
pub struct AppState {
    pub db: PgPool,
    pub config: Config,
}

pub type SharedState = Arc<AppState>;
