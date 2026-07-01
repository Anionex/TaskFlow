use axum::{
    body::Bytes,
    extract::{Multipart, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::collections::HashMap;
use uuid::Uuid;

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
        // 单条任务的公共字段抽取（DRY），返回 None 表示标题为空应跳过。
        let fields = |t: &serde_json::Value| {
            let title = t.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
            if title.is_empty() {
                return None;
            }
            Some((
                title.to_string(),
                t.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                sanitize_cat(t.get("category").and_then(|v| v.as_str()).unwrap_or("其他")).to_string(),
                clamp_star_rating(t.get("star_rating").and_then(|v| v.as_i64()).unwrap_or(0) as i16),
                t.get("completed").and_then(|v| v.as_bool()).unwrap_or(false),
            ))
        };
        // 导出里任务的 parent_id（可能缺省/None）。
        let parent_of = |t: &serde_json::Value| {
            t.get("parent_id")
                .and_then(|v| v.as_str())
                .and_then(|s| Uuid::parse_str(s).ok())
        };

        // 第一遍：插入所有顶层任务（无 parent_id），记录 旧 id → 新 id 映射，
        // 以便第二遍把子任务挂到重映射后的父任务上（ID 由服务端生成，故必须重映射）。
        let mut id_map: HashMap<Uuid, Uuid> = HashMap::new();
        for t in tasks {
            if parent_of(t).is_some() {
                continue; // 子任务留到第二遍
            }
            let (title, description, category, star_rating, completed) = match fields(t) {
                Some(f) => f,
                None => continue,
            };

            let new_id: Result<Uuid, _> = sqlx::query_scalar(
                "INSERT INTO tasks (user_id, title, description, category, star_rating, completed, start_date, deadline) \
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
            )
            .bind(uid)
            .bind(&title)
            .bind(&description)
            .bind(&category)
            .bind(star_rating)
            .bind(completed)
            .bind(parse_dt(t, "start_date"))
            .bind(parse_dt(t, "deadline"))
            .fetch_one(&state.db)
            .await;

            if let Ok(new_id) = new_id {
                imported += 1;
                // 旧 id 可能缺省；有才记录映射，供子任务重映射。
                if let Some(old_id) = t.get("id").and_then(|v| v.as_str()).and_then(|s| Uuid::parse_str(s).ok()) {
                    id_map.insert(old_id, new_id);
                }
            }
        }

        // 第二遍：插入子任务。只有父任务在本次导入批次中、且是有效的顶层任务时才导入，
        // 遵守「子任务只允许单层」的 DB 约束——祖孙级（父本身也是子任务）会因 id_map 未命中而被跳过。
        for t in tasks {
            let old_parent = match parent_of(t) {
                Some(p) => p,
                None => continue, // 顶层任务已在第一遍处理
            };
            let new_parent = match id_map.get(&old_parent) {
                Some(np) => *np,
                None => continue, // 父不在本批次 / 父本身是子任务（祖孙）→ 跳过，避免破坏约束
            };
            let (title, description, category, star_rating, completed) = match fields(t) {
                Some(f) => f,
                None => continue,
            };

            let r = sqlx::query(
                "INSERT INTO tasks (user_id, parent_id, title, description, category, star_rating, completed, start_date, deadline) \
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            )
            .bind(uid)
            .bind(new_parent)
            .bind(&title)
            .bind(&description)
            .bind(&category)
            .bind(star_rating)
            .bind(completed)
            .bind(parse_dt(t, "start_date"))
            .bind(parse_dt(t, "deadline"))
            .execute(&state.db)
            .await;

            if r.is_ok() {
                imported += 1;
            }
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
