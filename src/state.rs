use crate::config::Config;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// 登录限流：按 key（手机号）记录当前窗口的起点与失败/尝试计数。
/// 纯内存实现（进程内），不引入额外依赖。
pub type LoginAttempts = Mutex<HashMap<String, (Instant, u32)>>;

/// 跨 handler 共享的应用状态。
pub struct AppState {
    pub db: PgPool,
    pub config: Config,
    /// 登录尝试限流表（按手机号）。
    pub login_attempts: LoginAttempts,
}

pub type SharedState = Arc<AppState>;
