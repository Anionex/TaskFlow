use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::response::{err, ok, ok_msg, ApiResponse};
use crate::state::SharedState;

// ── 认证辅助 ──────────────────────────────────────────────────────────────

/// 从请求头读 X-Session-Id，查库验证，返回 user_id；失败返回 (401, JSON)。
pub async fn current_user(
    headers: &HeaderMap,
    state: &SharedState,
) -> Result<Uuid, (StatusCode, Json<ApiResponse>)> {
    let session_id = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                err("未登录"),
            )
        })?;

    let row = sqlx::query_as::<_, (Uuid,)>(
        "SELECT user_id FROM sessions WHERE id = $1 AND expires_at > now()",
    )
    .bind(session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, err("数据库错误")))?;

    row.map(|(uid,)| uid)
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, err("未登录")))
}

// ── 请求/响应体 ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RegisterReq {
    pub phone: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginReq {
    pub phone: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct ChangePasswordReq {
    pub old_password: String,
    pub new_password: String,
}

#[derive(Serialize)]
pub struct LoginData {
    pub session_id: String,
}

// ── 校验辅助 ───────────────────────────────────────────────────────────────

fn validate_phone(phone: &str) -> bool {
    phone.len() == 11 && phone.chars().all(|c| c.is_ascii_digit())
}

fn validate_password(password: &str) -> bool {
    password.len() >= 6
}

fn hash_password(password: &str) -> Result<String, String> {
    use argon2::{
        password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
        Argon2,
    };
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

fn verify_password(password: &str, hash: &str) -> bool {
    use argon2::{
        password_hash::{PasswordHash, PasswordVerifier},
        Argon2,
    };
    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

// ── 处理器 ─────────────────────────────────────────────────────────────────

pub async fn register(
    State(state): State<SharedState>,
    Json(body): Json<RegisterReq>,
) -> Json<ApiResponse> {
    if !validate_phone(&body.phone) {
        return err("手机号必须为11位数字");
    }
    if !validate_password(&body.password) {
        return err("密码长度不能低于6位");
    }

    // 检查手机号是否已存在
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE phone = $1)")
            .bind(&body.phone)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false);
    if exists {
        return err("该手机号已被注册");
    }

    let hash = match hash_password(&body.password) {
        Ok(h) => h,
        Err(_) => return err("服务器内部错误"),
    };

    let result = sqlx::query(
        "INSERT INTO users (phone, password_hash) VALUES ($1, $2)",
    )
    .bind(&body.phone)
    .bind(&hash)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => ok_msg("注册成功"),
        Err(_) => err("注册失败，请重试"),
    }
}

/// 登录限流窗口与上限：同一手机号在窗口内失败达到上限即拒绝，避免暴力破解/枚举。
const LOGIN_WINDOW: std::time::Duration = std::time::Duration::from_secs(60);
const LOGIN_MAX_ATTEMPTS: u32 = 5;

/// 记一次失败尝试；若当前窗口内失败次数已达上限返回 false（应被拒绝）。
/// 纯内存滑窗（按 key 单窗口计数），进程重启即清零，够用且零依赖。
fn allow_login_attempt(state: &SharedState, key: &str) -> bool {
    let mut map = match state.login_attempts.lock() {
        Ok(m) => m,
        Err(p) => p.into_inner(), // 锁中毒也继续，避免因限流表导致登录彻底不可用
    };
    let now = std::time::Instant::now();
    // 内存兜底：攻击者可用大量不同的合法格式手机号刷登录，使 map 无限增长（内存 DoS）。
    // map 过大时顺手清理已过窗口的条目，把内存约束在"窗口内仍在失败的手机号数量"量级。
    const MAX_ENTRIES: usize = 10_000;
    if map.len() > MAX_ENTRIES {
        map.retain(|_, (t, _)| now.duration_since(*t) <= LOGIN_WINDOW);
    }
    let entry = map.entry(key.to_string()).or_insert((now, 0));
    // 窗口过期则重置。
    if now.duration_since(entry.0) > LOGIN_WINDOW {
        *entry = (now, 0);
    }
    if entry.1 >= LOGIN_MAX_ATTEMPTS {
        return false;
    }
    entry.1 += 1;
    true
}

/// 登录成功后清除该手机号的失败计数。
fn clear_login_attempts(state: &SharedState, key: &str) {
    if let Ok(mut map) = state.login_attempts.lock() {
        map.remove(key);
    }
}

pub async fn login(
    State(state): State<SharedState>,
    Json(body): Json<LoginReq>,
) -> Json<ApiResponse> {
    if !validate_phone(&body.phone) {
        return err("手机号格式错误，应为11位数字");
    }

    // 限流：同一手机号短时间内失败过多则直接拒绝（消息与失败态一致，不泄露账户存在性）。
    if !allow_login_attempt(&state, &body.phone) {
        return err("尝试过于频繁，请稍后再试");
    }

    let row = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, password_hash FROM users WHERE phone = $1",
    )
    .bind(&body.phone)
    .fetch_optional(&state.db)
    .await;

    // 防账户枚举：手机号未注册与密码错误返回同一条通用消息，二者不可区分。
    let (user_id, hash) = match row {
        Ok(Some(r)) => r,
        Ok(None) => return err("手机号或密码错误"),
        Err(_) => return err("数据库错误"),
    };

    if !verify_password(&body.password, &hash) {
        return err("手机号或密码错误");
    }

    // 创建会话（30天有效）
    let expires_at = Utc::now() + Duration::days(30);
    let session_id: Uuid = sqlx::query_scalar(
        "INSERT INTO sessions (user_id, expires_at) VALUES ($1, $2) RETURNING id",
    )
    .bind(user_id)
    .bind(expires_at)
    .fetch_one(&state.db)
    .await
    .unwrap_or_else(|_| Uuid::nil());

    if session_id.is_nil() {
        return err("创建会话失败");
    }

    // 登录成功，清除该手机号的失败计数。
    clear_login_attempts(&state, &body.phone);

    ok("登录成功", session_id.to_string())
}

pub async fn logout(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Json<ApiResponse> {
    if let Some(session_id) = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
    {
        let _ = sqlx::query("DELETE FROM sessions WHERE id = $1")
            .bind(session_id)
            .execute(&state.db)
            .await;
    }
    ok_msg("已退出登录")
}

pub async fn session(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Json<ApiResponse> {
    match current_user(&headers, &state).await {
        Ok(uid) => {
            let phone: Option<String> =
                sqlx::query_scalar("SELECT phone FROM users WHERE id = $1")
                    .bind(uid)
                    .fetch_optional(&state.db)
                    .await
                    .unwrap_or(None);
            match phone {
                Some(p) => ok("已登录", p),
                None => err("未登录"),
            }
        }
        Err(_) => err("未登录"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── 手机号校验 ────────────────────────────────────────────────────────
    #[test]
    fn phone_exactly_11_digits_is_valid() {
        assert!(validate_phone("13800138000"));
        assert!(validate_phone("19912345678"));
    }

    #[test]
    fn phone_too_short_is_invalid() {
        assert!(!validate_phone("1380013800")); // 10 digits
        assert!(!validate_phone(""));
    }

    #[test]
    fn phone_too_long_is_invalid() {
        assert!(!validate_phone("138001380001")); // 12 digits
    }

    #[test]
    fn phone_with_non_digits_is_invalid() {
        assert!(!validate_phone("1380013800a"));
        assert!(!validate_phone("1380013800 "));
        assert!(!validate_phone("1380013800+"));
    }

    // ── 密码校验 ─────────────────────────────────────────────────────────
    #[test]
    fn password_six_chars_is_valid() {
        assert!(validate_password("123456"));
        assert!(validate_password("abcdef"));
        assert!(validate_password("      ")); // spaces count
    }

    #[test]
    fn password_five_chars_is_invalid() {
        assert!(!validate_password("12345"));
        assert!(!validate_password(""));
    }

    // ── Argon2 哈希往返 ───────────────────────────────────────────────────
    #[test]
    fn argon2_hash_and_verify_roundtrip() {
        let password = "correct_password_123";
        let hash = hash_password(password).expect("hash should succeed");
        assert!(verify_password(password, &hash), "correct password should verify");
        assert!(!verify_password("wrong_password", &hash), "wrong password should fail");
    }

    #[test]
    fn argon2_hash_is_not_plaintext() {
        let password = "mypassword";
        let hash = hash_password(password).expect("hash should succeed");
        assert!(!hash.contains(password), "hash must not contain plaintext");
        // Argon2 hashes start with $argon2
        assert!(hash.starts_with("$argon2"), "should be argon2 format");
    }
}

pub async fn change_password(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    if !validate_password(&body.new_password) {
        return (StatusCode::BAD_REQUEST, err("新密码长度不能低于6位"));
    }

    let hash: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
            .bind(uid)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

    let hash = match hash {
        Some(h) => h,
        None => return (StatusCode::NOT_FOUND, err("用户不存在")),
    };

    if !verify_password(&body.old_password, &hash) {
        return (StatusCode::BAD_REQUEST, err("原密码错误"));
    }

    let new_hash = match hash_password(&body.new_password) {
        Ok(h) => h,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, err("服务器内部错误")),
    };

    let _ = sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(&new_hash)
        .bind(uid)
        .execute(&state.db)
        .await;

    (StatusCode::OK, ok_msg("密码修改成功"))
}
