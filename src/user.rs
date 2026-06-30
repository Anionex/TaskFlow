use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
};
use chrono::Datelike;
use serde::Deserialize;

use crate::auth::current_user;
use crate::response::{err, ok, ok_msg, ApiResponse};
use crate::state::SharedState;

pub async fn get_profile(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let row: Option<(String, String)> =
        sqlx::query_as("SELECT phone, summary_tone FROM users WHERE id=$1")
            .bind(uid)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

    match row {
        Some((phone, summary_tone)) => (
            StatusCode::OK,
            ok(
                "获取成功",
                serde_json::json!({"phone": phone, "summary_tone": summary_tone}),
            ),
        ),
        None => (StatusCode::NOT_FOUND, err("用户不存在")),
    }
}

pub async fn get_stats(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let now = chrono::Utc::now();

    // total / completed / pending / expired — exclude soft-deleted
    let (total, completed, pending, expired): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT \
           COUNT(*) FILTER (WHERE deleted_at IS NULL), \
           COUNT(*) FILTER (WHERE deleted_at IS NULL AND completed=true), \
           COUNT(*) FILTER (WHERE deleted_at IS NULL AND completed=false AND (deadline IS NULL OR deadline >= $2)), \
           COUNT(*) FILTER (WHERE deleted_at IS NULL AND completed=false AND deadline IS NOT NULL AND deadline < $2) \
         FROM tasks WHERE user_id=$1",
    )
    .bind(uid)
    .bind(now)
    .fetch_one(&state.db)
    .await
    .unwrap_or((0, 0, 0, 0));

    // 近 12 个自然月的完成量（按北京月份分桶，缺月补零，保证柱状图 12 根连续柱）
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT to_char(completed_at + INTERVAL '8 hours', 'YYYY-MM') as month, COUNT(*) \
         FROM tasks \
         WHERE user_id=$1 AND completed=true AND deleted_at IS NULL AND completed_at IS NOT NULL \
           AND completed_at >= (now() - INTERVAL '13 months') \
         GROUP BY month",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let counts: std::collections::HashMap<String, i64> = rows.into_iter().collect();
    let today = crate::util::beijing_today();
    // 从 11 个月前的月份开始，到本月，共 12 个标签
    let (mut y, mut m) = (today.year(), today.month() as i32 - 11);
    while m <= 0 {
        m += 12;
        y -= 1;
    }
    let mut monthly: Vec<(String, i64)> = Vec::with_capacity(12);
    for _ in 0..12 {
        let key = format!("{y:04}-{m:02}");
        let c = counts.get(&key).copied().unwrap_or(0);
        monthly.push((key, c));
        m += 1;
        if m > 12 {
            m = 1;
            y += 1;
        }
    }

    (
        StatusCode::OK,
        ok(
            "获取成功",
            serde_json::json!({
                "total": total,
                "completed": completed,
                "pending": pending,
                "expired": expired,
                "monthly_completed": monthly
            }),
        ),
    )
}

pub async fn get_settings(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let row: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT summary_tone, llm_api_key, llm_model, llm_base_url FROM users WHERE id=$1",
    )
    .bind(uid)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    let (summary_tone, llm_api_key, llm_model, llm_base_url) =
        row.unwrap_or_else(|| ("温暖鼓励型".into(), String::new(), String::new(), String::new()));

    (
        StatusCode::OK,
        ok(
            "获取成功",
            serde_json::json!({
                "summary_tone": summary_tone,
                "llm_api_key": llm_api_key,
                "llm_model": llm_model,
                "llm_base_url": llm_base_url,
            }),
        ),
    )
}

#[derive(Deserialize)]
pub struct UpdateSettingsReq {
    pub summary_tone: Option<String>,
    pub llm_api_key: Option<String>,
    pub llm_model: Option<String>,
    pub llm_base_url: Option<String>,
}

pub async fn update_settings(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<UpdateSettingsReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    if let Some(tone) = &body.summary_tone {
        if !["温暖鼓励型", "冷静督促型", "简短效率型"].contains(&tone.as_str()) {
            return (StatusCode::BAD_REQUEST, err("语气设置无效"));
        }
        let _ = sqlx::query("UPDATE users SET summary_tone=$1 WHERE id=$2")
            .bind(tone)
            .bind(uid)
            .execute(&state.db)
            .await;
    }

    // 大模型设置：账户级持久化，跨设备同步。传入字段即更新（空字符串=清空，走服务端默认）。
    if let Some(key) = &body.llm_api_key {
        let _ = sqlx::query("UPDATE users SET llm_api_key=$1 WHERE id=$2")
            .bind(key.trim())
            .bind(uid)
            .execute(&state.db)
            .await;
    }
    if let Some(model) = &body.llm_model {
        let _ = sqlx::query("UPDATE users SET llm_model=$1 WHERE id=$2")
            .bind(model.trim())
            .bind(uid)
            .execute(&state.db)
            .await;
    }
    if let Some(base) = &body.llm_base_url {
        let _ = sqlx::query("UPDATE users SET llm_base_url=$1 WHERE id=$2")
            .bind(base.trim())
            .bind(uid)
            .execute(&state.db)
            .await;
    }

    (StatusCode::OK, ok_msg("设置已更新"))
}
