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

    if let Some(tasks) = data.get("tasks").and_then(|v| v.as_array()) {
        for t in tasks {
            let title = t.get("title").and_then(|v| v.as_str()).unwrap_or("");
            if title.is_empty() {
                continue;
            }
            let description = t.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let category = t.get("category").and_then(|v| v.as_str()).unwrap_or("其他");
            let star_rating = t.get("star_rating").and_then(|v| v.as_i64()).unwrap_or(0) as i16;
            let completed = t.get("completed").and_then(|v| v.as_bool()).unwrap_or(false);

            let _ = sqlx::query(
                "INSERT INTO tasks (user_id, title, description, category, star_rating, completed) \
                 VALUES ($1,$2,$3,$4,$5,$6)",
            )
            .bind(uid)
            .bind(title)
            .bind(description)
            .bind(category)
            .bind(star_rating)
            .bind(completed)
            .execute(&state.db)
            .await;
            imported += 1;
        }
    }

    (StatusCode::OK, ok_msg(&format!("导入成功，共{}条", imported)))
}
