use axum::{
    body::Bytes,
    extract::{Multipart, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use crate::auth::current_user;
use crate::models::{Task, TaskTemplate};
use crate::response::{err, ok_msg, ApiResponse};
use crate::state::SharedState;
use crate::tasks::{clamp_star_rating, is_valid_category};

/// 导入时的分类消毒：非法分类回落到「其他」。
fn sanitize_cat(raw: &str) -> &str {
    if is_valid_category(raw) {
        raw
    } else {
        "其他"
    }
}

/// Export user data as JSON (Content-Type: application/json, filename attachment)
pub async fn export_data(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Response {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err((status, body)) => return (status, body).into_response(),
    };

    let tasks: Vec<Task> = sqlx::query_as("SELECT * FROM tasks WHERE user_id=$1 ORDER BY created_at")
        .bind(uid)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    let templates: Vec<TaskTemplate> =
        sqlx::query_as("SELECT * FROM task_templates WHERE user_id=$1 ORDER BY created_at")
            .bind(uid)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    let payload = json!({
        "version": "2.0",
        "exported_at": chrono::Utc::now(),
        "tasks": tasks,
        "templates": templates
    });

    let body = serde_json::to_vec_pretty(&payload).unwrap_or_default();

    axum::response::Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json; charset=utf-8")
        .header(
            "content-disposition",
            "attachment; filename=\"taskflow_export.json\"",
        )
        .body(axum::body::Body::from(body))
        .unwrap()
}

/// Import data from JSON uploaded as multipart form field "file"
pub async fn import_data(
    State(state): State<SharedState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let mut file_bytes: Option<Bytes> = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        file_bytes = Some(field.bytes().await.unwrap_or_default());
        break;
    }

    let bytes = match file_bytes {
        Some(b) if !b.is_empty() => b,
        _ => return (StatusCode::BAD_REQUEST, err("未提供文件")),
    };

    let data: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, err("文件格式错误，需要 JSON")),
    };

    let mut imported = 0u32;
    let mut imported_templates = 0u32;

    let parse_dt = |t: &serde_json::Value, k: &str| {
        t.get(k)
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc))
    };

    if let Some(tasks) = data.get("tasks").and_then(|v| v.as_array()) {
        for t in tasks {
            let title = t.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
            if title.is_empty() {
                continue;
            }
            let description = t.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let category = sanitize_cat(t.get("category").and_then(|v| v.as_str()).unwrap_or("其他"));
            let star_rating =
                clamp_star_rating(t.get("star_rating").and_then(|v| v.as_i64()).unwrap_or(0) as i16);
            let completed = t.get("completed").and_then(|v| v.as_bool()).unwrap_or(false);

            let _ = sqlx::query(
                "INSERT INTO tasks (user_id, title, description, category, star_rating, completed, start_date, deadline) \
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            )
            .bind(uid)
            .bind(title)
            .bind(description)
            .bind(category)
            .bind(star_rating)
            .bind(completed)
            .bind(parse_dt(t, "start_date"))
            .bind(parse_dt(t, "deadline"))
            .execute(&state.db)
            .await;
            imported += 1;
        }
    }

    if let Some(templates) = data.get("templates").and_then(|v| v.as_array()) {
        for t in templates {
            let title = t.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
            if title.is_empty() {
                continue;
            }
            let description = t.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let category = sanitize_cat(t.get("category").and_then(|v| v.as_str()).unwrap_or("其他"));
            let star_rating =
                clamp_star_rating(t.get("star_rating").and_then(|v| v.as_i64()).unwrap_or(0) as i16);
            let raw_freq = t.get("frequency").and_then(|v| v.as_str()).unwrap_or("daily");
            let frequency = if ["daily", "weekly", "monthly"].contains(&raw_freq) {
                raw_freq
            } else {
                "daily"
            };
            let generate_day = t.get("generate_day").and_then(|v| v.as_i64()).unwrap_or(0) as i16;
            let generate_time = t.get("generate_time").and_then(|v| v.as_str()).unwrap_or("09:00");
            let deadline_day = t.get("deadline_day").and_then(|v| v.as_i64()).unwrap_or(0) as i16;
            let deadline_time = t.get("deadline_time").and_then(|v| v.as_str()).unwrap_or("18:00");

            let _ = sqlx::query(
                "INSERT INTO task_templates (user_id, title, description, category, star_rating, frequency, generate_day, generate_time, deadline_day, deadline_time) \
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            )
            .bind(uid)
            .bind(title)
            .bind(description)
            .bind(category)
            .bind(star_rating)
            .bind(frequency)
            .bind(generate_day)
            .bind(generate_time)
            .bind(deadline_day)
            .bind(deadline_time)
            .execute(&state.db)
            .await;
            imported_templates += 1;
        }
    }

    (
        StatusCode::OK,
        ok_msg(&format!(
            "导入成功，任务 {imported} 条、模板 {imported_templates} 条"
        )),
    )
}
