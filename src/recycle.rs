use axum::{
    extract::{Json, Path, State},
    http::{HeaderMap, StatusCode},
};
use uuid::Uuid;

use crate::auth::current_user;
use crate::models::Task;
use crate::response::{err, ok, ok_msg, ApiResponse};
use crate::state::SharedState;

pub async fn list_recycle(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let tasks: Vec<Task> = sqlx::query_as(
        "SELECT * FROM tasks WHERE user_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let items: Vec<serde_json::Value> = tasks
        .iter()
        .map(|t| {
            serde_json::json!({
                "id": t.id,
                "parent_id": t.parent_id,
                "title": t.title,
                "description": t.description,
                "completed": t.completed,
                "category": t.category,
                "star_rating": t.star_rating,
                "sort_order": t.sort_order,
                "start_date": t.start_date,
                "deadline": t.deadline,
                "deleted_at": t.deleted_at,
                "created_at": t.created_at,
                "completed_at": t.completed_at,
            })
        })
        .collect();

    (StatusCode::OK, ok("获取成功", serde_json::json!({"items": items})))
}

pub async fn restore_task(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    // Restore task and its children
    let result = sqlx::query(
        "UPDATE tasks SET deleted_at=NULL \
         WHERE (id=$1 OR parent_id=$1) AND user_id=$2 AND deleted_at IS NOT NULL",
    )
    .bind(id)
    .bind(uid)
    .execute(&state.db)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, ok_msg("任务已恢复")),
        Ok(_) => (StatusCode::NOT_FOUND, err("任务不存在")),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, err("恢复失败")),
    }
}

pub async fn permanent_delete(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let result = sqlx::query(
        "DELETE FROM tasks WHERE (id=$1 OR parent_id=$1) AND user_id=$2",
    )
    .bind(id)
    .bind(uid)
    .execute(&state.db)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, ok_msg("任务已永久删除")),
        Ok(_) => (StatusCode::NOT_FOUND, err("任务不存在")),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, err("删除失败")),
    }
}

pub async fn clear_recycle(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let result =
        sqlx::query("DELETE FROM tasks WHERE user_id=$1 AND deleted_at IS NOT NULL")
            .bind(uid)
            .execute(&state.db)
            .await;

    match result {
        Ok(_) => (StatusCode::OK, ok_msg("回收站已清空")),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, err("清空失败")),
    }
}
