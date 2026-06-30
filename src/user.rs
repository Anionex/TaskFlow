use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
};
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

    // Monthly completed in the last 12 months
    let monthly: Vec<(String, i64)> = sqlx::query_as(
        "SELECT to_char(completed_at, 'YYYY-MM') as month, COUNT(*) \
         FROM tasks \
         WHERE user_id=$1 AND completed=true AND deleted_at IS NULL \
           AND completed_at >= (now() - INTERVAL '12 months') \
         GROUP BY month ORDER BY month",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

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

    let summary_tone: Option<String> =
        sqlx::query_scalar("SELECT summary_tone FROM users WHERE id=$1")
            .bind(uid)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

    (
        StatusCode::OK,
        ok(
            "获取成功",
            serde_json::json!({"summary_tone": summary_tone.unwrap_or_else(|| "温暖鼓励型".into())}),
        ),
    )
}

#[derive(Deserialize)]
pub struct UpdateSettingsReq {
    pub summary_tone: Option<String>,
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

    (StatusCode::OK, ok_msg("设置已更新"))
}
