use axum::{
    extract::{Json, Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::auth::current_user;
use crate::models::Task;
use crate::response::{err, ok, ok_msg, ApiResponse};
use crate::state::SharedState;

// ── 请求/响应类型 ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct TaskListQuery {
    pub sort_by: Option<String>,
    pub category: Option<String>,
    pub search: Option<String>,
    pub parent_id: Option<Uuid>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreateTaskReq {
    pub title: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub star_rating: Option<i16>,
    pub start_date: Option<chrono::DateTime<Utc>>,
    pub deadline: Option<chrono::DateTime<Utc>>,
    pub parent_id: Option<Uuid>,
    pub sort_order: Option<i32>,
}

/// 区分"字段缺省"(None) 与"显式传 null"(Some(None))，用于可清空的日期字段。
fn double_option<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}

#[derive(Deserialize)]
pub struct UpdateTaskReq {
    pub title: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub star_rating: Option<i16>,
    #[serde(default, deserialize_with = "double_option")]
    pub start_date: Option<Option<chrono::DateTime<Utc>>>,
    #[serde(default, deserialize_with = "double_option")]
    pub deadline: Option<Option<chrono::DateTime<Utc>>>,
    pub completed: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Deserialize)]
pub struct BatchDeleteReq {
    pub task_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
pub struct ClearQuery {
    pub status: Option<String>,
}

#[derive(Deserialize)]
pub struct SubtaskInput {
    pub title: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub star_rating: Option<i16>,
    pub start_date: Option<chrono::DateTime<Utc>>,
    pub deadline: Option<chrono::DateTime<Utc>>,
    pub sort_order: Option<i32>,
}

#[derive(Deserialize)]
pub struct ParentInput {
    pub title: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub star_rating: Option<i16>,
    pub start_date: Option<chrono::DateTime<Utc>>,
    pub deadline: Option<chrono::DateTime<Utc>>,
}

#[derive(Deserialize)]
pub struct CreateGroupReq {
    pub parent: ParentInput,
    pub subtasks: Vec<SubtaskInput>,
}

// ── 校验辅助（纯函数，供单元测试） ────────────────────────────────────────────

pub fn is_valid_category(category: &str) -> bool {
    ["学习", "工作", "生活", "家庭", "其他"].contains(&category)
}

pub fn clamp_star_rating(star: i16) -> i16 {
    star.clamp(0, 5)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── 分类校验 ─────────────────────────────────────────────────────────
    #[test]
    fn valid_categories_accepted() {
        for cat in ["学习", "工作", "生活", "家庭", "其他"] {
            assert!(is_valid_category(cat), "expected valid: {cat}");
        }
    }

    #[test]
    fn invalid_category_rejected() {
        assert!(!is_valid_category(""));
        assert!(!is_valid_category("娱乐"));
        assert!(!is_valid_category("study"));
    }

    // ── 星级范围 ─────────────────────────────────────────────────────────
    #[test]
    fn star_rating_clamps_to_0_5() {
        assert_eq!(clamp_star_rating(0), 0);
        assert_eq!(clamp_star_rating(5), 5);
        assert_eq!(clamp_star_rating(3), 3);
        assert_eq!(clamp_star_rating(-1), 0);
        assert_eq!(clamp_star_rating(6), 5);
        assert_eq!(clamp_star_rating(100), 5);
    }
}

// ── 辅助：序列化 Task ──────────────────────────────────────────────────────

fn task_to_json(t: &Task) -> serde_json::Value {
    json!({
        "id": t.id,
        "user_id": t.user_id,
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
}

// ── 任务列表 ───────────────────────────────────────────────────────────────

pub async fn list_tasks(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(q): Query<TaskListQuery>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let page = q.page.unwrap_or(1).max(1);
    let per_page = q.per_page.unwrap_or(20).min(200);
    let offset = (page - 1) * per_page;

    // We build a fixed query supporting optional filters
    let category_filter = q.category.as_deref().unwrap_or("");
    let search_filter = q.search.as_deref().unwrap_or("");

    let order_clause = match q.sort_by.as_deref() {
        Some("deadline") => "t.deadline ASC NULLS LAST, t.created_at DESC",
        Some("star") => "t.star_rating DESC, t.created_at DESC",
        _ => "t.created_at DESC",
    };

    // Build SQL with optional WHERE clauses
    // We use $1=uid, $2=category_or_empty, $3=search_or_empty
    let sql_count = format!(
        "SELECT COUNT(*) FROM tasks t \
         WHERE t.user_id = $1 \
           AND t.deleted_at IS NULL \
           AND ($2 = '' OR t.category = $2) \
           AND ($3 = '' OR (t.title ILIKE $4 OR t.description ILIKE $4)) \
           AND ($5::uuid IS NULL OR t.parent_id = $5) \
           AND ($5::uuid IS NOT NULL OR t.parent_id IS NULL)"
    );

    let sql_data = format!(
        "SELECT t.* FROM tasks t \
         WHERE t.user_id = $1 \
           AND t.deleted_at IS NULL \
           AND ($2 = '' OR t.category = $2) \
           AND ($3 = '' OR (t.title ILIKE $4 OR t.description ILIKE $4)) \
           AND ($5::uuid IS NULL OR t.parent_id = $5) \
           AND ($5::uuid IS NOT NULL OR t.parent_id IS NULL) \
         ORDER BY {order_clause} \
         LIMIT $6 OFFSET $7"
    );

    let search_pattern = if search_filter.is_empty() {
        String::new()
    } else {
        format!("%{}%", search_filter)
    };

    let total: i64 = sqlx::query_scalar(&sql_count)
        .bind(uid)
        .bind(category_filter)
        .bind(search_filter)
        .bind(&search_pattern)
        .bind(q.parent_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let tasks: Vec<Task> = sqlx::query_as(&sql_data)
        .bind(uid)
        .bind(category_filter)
        .bind(search_filter)
        .bind(&search_pattern)
        .bind(q.parent_id)
        .bind(per_page)
        .bind(offset)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    let total_pages = (total + per_page - 1) / per_page;

    // For top-level tasks (parent_id IS NULL), attach child progress
    let mut items: Vec<serde_json::Value> = Vec::new();
    for task in &tasks {
        let mut v = task_to_json(task);
        // 仅顶层任务可能是任务组：内联返回子任务与完成进度（前端据此渲染组结构）
        if task.parent_id.is_none() {
            let children: Vec<Task> = sqlx::query_as(
                "SELECT * FROM tasks WHERE parent_id = $1 AND deleted_at IS NULL \
                 ORDER BY sort_order ASC, created_at ASC",
            )
            .bind(task.id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            if !children.is_empty() {
                let done = children.iter().filter(|c| c.completed).count() as i64;
                v["subtask_total"] = json!(children.len() as i64);
                v["subtask_completed"] = json!(done);
                v["subtasks"] = json!(children.iter().map(task_to_json).collect::<Vec<_>>());
            }
        }
        items.push(v);
    }

    (
        StatusCode::OK,
        ok(
            "获取成功",
            json!({
                "items": items,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": total_pages
            }),
        ),
    )
}

// ── 创建任务 ───────────────────────────────────────────────────────────────

pub async fn create_task(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<CreateTaskReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    if body.title.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, err("任务标题不能为空"));
    }

    // Validate category
    let category = body.category.as_deref().unwrap_or("其他");
    if !["学习", "工作", "生活", "家庭", "其他"].contains(&category) {
        return (StatusCode::BAD_REQUEST, err("分类无效"));
    }

    // 仅一级约束 + 父任务归属校验：parent_id 必须是当前用户名下、且自身无父的任务
    if let Some(pid) = body.parent_id {
        let parent_row: Option<bool> = sqlx::query_scalar(
            "SELECT parent_id IS NOT NULL FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(pid)
        .bind(uid)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);
        match parent_row {
            None => return (StatusCode::BAD_REQUEST, err("父任务不存在")),
            Some(true) => return (StatusCode::BAD_REQUEST, err("不允许多级子任务")),
            Some(false) => {}
        }
    }

    let task: Result<Task, _> = sqlx::query_as(
        "INSERT INTO tasks (user_id, parent_id, title, description, category, star_rating, sort_order, start_date, deadline) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
    )
    .bind(uid)
    .bind(body.parent_id)
    .bind(body.title.trim())
    .bind(body.description.as_deref().unwrap_or(""))
    .bind(category)
    .bind(clamp_star_rating(body.star_rating.unwrap_or(0)))
    .bind(body.sort_order.unwrap_or(0))
    .bind(body.start_date)
    .bind(body.deadline)
    .fetch_one(&state.db)
    .await;

    match task {
        Ok(t) => (StatusCode::CREATED, ok("任务创建成功", task_to_json(&t))),
        Err(e) => {
            tracing::error!("create_task error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, err("创建失败"))
        }
    }
}

// ── 更新任务 ───────────────────────────────────────────────────────────────

pub async fn update_task(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateTaskReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    // Load existing
    let existing: Option<Task> =
        sqlx::query_as("SELECT * FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL")
            .bind(id)
            .bind(uid)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

    let mut task = match existing {
        Some(t) => t,
        None => return (StatusCode::NOT_FOUND, err("任务不存在")),
    };

    if let Some(title) = body.title {
        if !title.trim().is_empty() {
            task.title = title.trim().to_string();
        }
    }
    if let Some(desc) = body.description {
        task.description = desc;
    }
    if let Some(cat) = body.category {
        if ["学习", "工作", "生活", "家庭", "其他"].contains(&cat.as_str()) {
            task.category = cat;
        }
    }
    if let Some(sr) = body.star_rating {
        task.star_rating = sr.clamp(0, 5);
    }
    if let Some(so) = body.sort_order {
        task.sort_order = so;
    }
    // 显式传 null 可清空；字段缺省则保持原值
    if let Some(sd) = body.start_date {
        task.start_date = sd;
    }
    if let Some(dl) = body.deadline {
        task.deadline = dl;
    }

    let completed_at = if let Some(c) = body.completed {
        task.completed = c;
        if c { Some(Utc::now()) } else { None }
    } else {
        task.completed_at
    };

    let updated: Option<Task> = sqlx::query_as(
        "UPDATE tasks SET title=$1, description=$2, category=$3, star_rating=$4, sort_order=$5, \
         start_date=$6, deadline=$7, completed=$8, completed_at=$9 \
         WHERE id=$10 AND user_id=$11 AND deleted_at IS NULL RETURNING *",
    )
    .bind(&task.title)
    .bind(&task.description)
    .bind(&task.category)
    .bind(task.star_rating)
    .bind(task.sort_order)
    .bind(task.start_date)
    .bind(task.deadline)
    .bind(task.completed)
    .bind(completed_at)
    .bind(id)
    .bind(uid)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    match updated {
        Some(t) => (StatusCode::OK, ok("任务更新成功", task_to_json(&t))),
        None => (StatusCode::INTERNAL_SERVER_ERROR, err("更新失败")),
    }
}

// ── 删除任务（软删除） ─────────────────────────────────────────────────────

pub async fn delete_task(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let now = Utc::now();
    // Soft-delete task and its children
    let result = sqlx::query(
        "UPDATE tasks SET deleted_at = $1 \
         WHERE (id = $2 OR parent_id = $2) AND user_id = $3 AND deleted_at IS NULL",
    )
    .bind(now)
    .bind(id)
    .bind(uid)
    .execute(&state.db)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, ok_msg("任务已移到回收站")),
        Ok(_) => (StatusCode::NOT_FOUND, err("任务不存在")),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, err("删除失败")),
    }
}

// ── 切换完成状态 ───────────────────────────────────────────────────────────

pub async fn toggle_task(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let task: Option<Task> =
        sqlx::query_as("SELECT * FROM tasks WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL")
            .bind(id)
            .bind(uid)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

    let task = match task {
        Some(t) => t,
        None => return (StatusCode::NOT_FOUND, err("任务不存在")),
    };

    let new_completed = !task.completed;
    let completed_at: Option<chrono::DateTime<Utc>> =
        if new_completed { Some(Utc::now()) } else { None };

    let _ = sqlx::query(
        "UPDATE tasks SET completed=$1, completed_at=$2 WHERE id=$3 AND user_id=$4",
    )
    .bind(new_completed)
    .bind(completed_at)
    .bind(id)
    .bind(uid)
    .execute(&state.db)
    .await;

    let msg = if new_completed { "任务已完成" } else { "任务已取消完成" };
    (StatusCode::OK, ok_msg(msg))
}

// ── 批量删除 ───────────────────────────────────────────────────────────────

pub async fn batch_delete(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<BatchDeleteReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    if body.task_ids.is_empty() {
        return (StatusCode::OK, ok_msg("已删除0个任务"));
    }

    let now = Utc::now();
    // Soft-delete each task and its children
    for tid in &body.task_ids {
        let _ = sqlx::query(
            "UPDATE tasks SET deleted_at=$1 \
             WHERE (id=$2 OR parent_id=$2) AND user_id=$3 AND deleted_at IS NULL",
        )
        .bind(now)
        .bind(tid)
        .bind(uid)
        .execute(&state.db)
        .await;
    }

    (StatusCode::OK, ok_msg(&format!("已删除{}个任务", body.task_ids.len())))
}

// ── 清空 ───────────────────────────────────────────────────────────────────

pub async fn clear_tasks(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(q): Query<ClearQuery>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let now = Utc::now();
    let status = q.status.as_deref().unwrap_or("pending");

    let sql = match status {
        "completed" => {
            "UPDATE tasks SET deleted_at=$1 \
             WHERE user_id=$2 AND deleted_at IS NULL AND completed=true"
        }
        "expired" => {
            "UPDATE tasks SET deleted_at=$1 \
             WHERE user_id=$2 AND deleted_at IS NULL AND completed=false AND deadline < $1"
        }
        _ => {
            // pending = not completed, not expired
            "UPDATE tasks SET deleted_at=$1 \
             WHERE user_id=$2 AND deleted_at IS NULL AND completed=false \
               AND (deadline IS NULL OR deadline >= $1)"
        }
    };

    let result = sqlx::query(sql)
        .bind(now)
        .bind(uid)
        .execute(&state.db)
        .await;

    let count = result.map(|r| r.rows_affected()).unwrap_or(0);
    (StatusCode::OK, ok_msg(&format!("已清空{}个任务", count)))
}

// ── 创建任务组 ─────────────────────────────────────────────────────────────

pub async fn create_group(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<CreateGroupReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let p = &body.parent;
    if p.title.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, err("任务标题不能为空"));
    }
    let category = p.category.as_deref().unwrap_or("其他");
    if !is_valid_category(category) {
        return (StatusCode::BAD_REQUEST, err("分类无效"));
    }
    for sub in &body.subtasks {
        if let Some(c) = sub.category.as_deref() {
            if !is_valid_category(c) {
                return (StatusCode::BAD_REQUEST, err("分类无效"));
            }
        }
    }

    // 事务：父任务 + 子任务原子写入，任一失败则整体回滚（§3.4.8）
    let mut tx = match state.db.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("create_group begin tx error: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, err("创建失败"));
        }
    };

    let parent: Task = match sqlx::query_as(
        "INSERT INTO tasks (user_id, title, description, category, star_rating, start_date, deadline) \
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    )
    .bind(uid)
    .bind(p.title.trim())
    .bind(p.description.as_deref().unwrap_or(""))
    .bind(category)
    .bind(clamp_star_rating(p.star_rating.unwrap_or(0)))
    .bind(p.start_date)
    .bind(p.deadline)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("create_group parent error: {e}");
            let _ = tx.rollback().await;
            return (StatusCode::INTERNAL_SERVER_ERROR, err("创建失败"));
        }
    };

    for sub in &body.subtasks {
        if sub.title.trim().is_empty() {
            continue;
        }
        let sub_cat = sub.category.as_deref().unwrap_or(category);
        if let Err(e) = sqlx::query(
            "INSERT INTO tasks (user_id, parent_id, title, description, category, star_rating, sort_order, start_date, deadline) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(uid)
        .bind(parent.id)
        .bind(sub.title.trim())
        .bind(sub.description.as_deref().unwrap_or(""))
        .bind(sub_cat)
        .bind(clamp_star_rating(sub.star_rating.unwrap_or(0)))
        .bind(sub.sort_order.unwrap_or(0))
        .bind(sub.start_date)
        .bind(sub.deadline)
        .execute(&mut *tx)
        .await
        {
            tracing::error!("create_group subtask error: {e}");
            let _ = tx.rollback().await;
            return (StatusCode::INTERNAL_SERVER_ERROR, err("创建失败"));
        }
    }

    if let Err(e) = tx.commit().await {
        tracing::error!("create_group commit error: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, err("创建失败"));
    }

    (
        StatusCode::CREATED,
        ok("已创建任务组", json!({"parent_id": parent.id})),
    )
}
