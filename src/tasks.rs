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
    pub status: Option<String>,
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
    #[serde(default, deserialize_with = "de_flexible_date")]
    pub start_date: Option<chrono::DateTime<Utc>>,
    #[serde(default, deserialize_with = "de_flexible_date")]
    pub deadline: Option<chrono::DateTime<Utc>>,
    pub parent_id: Option<Uuid>,
    pub sort_order: Option<i32>,
}

/// 宽松解析日期字段：接受纯日期(YYYY-MM-DD，来自 `<input type="date">`)、
/// RFC3339 及常见无时区格式；空串/null 视为 None。
fn de_flexible_date<'de, D>(d: D) -> Result<Option<chrono::DateTime<Utc>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match Option::<String>::deserialize(d)? {
        None => Ok(None),
        Some(s) if s.trim().is_empty() => Ok(None),
        Some(s) => crate::util::parse_flexible_date(&s, crate::util::DateOnlyTz::Utc)
            .map(Some)
            .ok_or_else(|| serde::de::Error::custom(format!("无法解析日期: {s}"))),
    }
}

/// 区分"字段缺省"(None) 与"显式传 null/空串"(Some(None))，用于可清空的日期字段。
/// 非空字符串按宽松规则解析。
fn de_flexible_date_double<'de, D>(d: D) -> Result<Option<Option<chrono::DateTime<Utc>>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(de_flexible_date(d)?))
}

#[derive(Deserialize)]
pub struct UpdateTaskReq {
    pub title: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub star_rating: Option<i16>,
    #[serde(default, deserialize_with = "de_flexible_date_double")]
    pub start_date: Option<Option<chrono::DateTime<Utc>>>,
    #[serde(default, deserialize_with = "de_flexible_date_double")]
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

/// 分类校验：自由文本，只要非空且长度 ≤10 字符即可（对齐 DB 的 VARCHAR(10)）。
/// 用户可创建自己的分类（Issue #9），不再限定为固定 5 类；默认 5 类只是前端下拉的预置项。
pub fn is_valid_category(category: &str) -> bool {
    let c = category.trim();
    !c.is_empty() && c.chars().count() <= 10
}

/// 默认分类（前端下拉预置；后端不强制，仅用于兜底取值）。
pub const DEFAULT_CATEGORIES: [&str; 5] = ["学习", "工作", "生活", "家庭", "其他"];

/// 任务状态过滤的 SQL 片段（以 " AND ..." 开头，可直接拼到 WHERE 之后）。
/// `prefix` 是列前缀，如 "t." 或 ""（按 FROM 是否带别名）。
/// status 取值仅服务端枚举，安全可内联：completed / expired / pending / incomplete。
/// incomplete = 未完成（待办 + 已过期，即 completed=false，不看截止时间）。
/// 其它值（含空）不按状态过滤。
pub fn status_filter_sql(status: Option<&str>, prefix: &str) -> String {
    let p = prefix;
    match status {
        Some("completed") => format!(" AND {p}completed = true"),
        Some("incomplete") => format!(" AND {p}completed = false"),
        Some("expired") => {
            format!(" AND {p}completed = false AND {p}deadline IS NOT NULL AND {p}deadline < now()")
        }
        Some("pending") => {
            format!(" AND {p}completed = false AND ({p}deadline IS NULL OR {p}deadline >= now())")
        }
        _ => String::new(),
    }
}

pub fn clamp_star_rating(star: i16) -> i16 {
    star.clamp(0, 5)
}

/// 分页每页条数钳制：缺省 20，范围 [1, 200]。下界必须 ≥1，
/// 否则 per_page=0 会在 total_pages 计算时整数除零 panic。
fn clamp_per_page(per_page: Option<i64>) -> i64 {
    per_page.unwrap_or(20).clamp(1, 200)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── 分类校验（自由文本，Issue #9）─────────────────────────────────────
    #[test]
    fn default_categories_accepted() {
        for cat in DEFAULT_CATEGORIES {
            assert!(is_valid_category(cat), "expected valid: {cat}");
        }
    }

    #[test]
    fn custom_categories_accepted() {
        // 自定义分类允许：非空、≤10 字符。
        assert!(is_valid_category("娱乐"));
        assert!(is_valid_category("study"));
        assert!(is_valid_category("副业赚钱")); // 4 个汉字
        assert!(is_valid_category("十个字十个字十个字十")); // 恰好 10 字
    }

    #[test]
    fn invalid_category_rejected() {
        assert!(!is_valid_category(""));
        assert!(!is_valid_category("   ")); // 纯空白
        assert!(!is_valid_category("十个字十个字十个字十一")); // 11 字，超出 VARCHAR(10)
        assert!(!is_valid_category("abcdefghijk")); // 11 个 ASCII
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

    // ── 状态过滤 SQL 片段 ────────────────────────────────────────────────
    // 未完成（incomplete）= 待办 + 已过期，即 completed=false，不看截止时间。
    #[test]
    fn incomplete_status_filter_sql() {
        assert_eq!(
            status_filter_sql(Some("incomplete"), "t."),
            " AND t.completed = false"
        );
        assert_eq!(
            status_filter_sql(Some("incomplete"), ""),
            " AND completed = false"
        );
    }

    // ── 日期字段宽松解析 ─────────────────────────────────────────────────
    // 回归：HTML `<input type="date">` 传来的纯日期字符串必须能被解析，
    // 否则改截止日期后保存会 422（历史 bug）。
    #[test]
    fn update_req_accepts_date_only() {
        let req: UpdateTaskReq =
            serde_json::from_str(r#"{"deadline":"2026-06-25"}"#).expect("date-only 应可解析");
        let dt = req.deadline.expect("字段应存在").expect("应为具体日期");
        // 前端按 UTC 截取 ISO 前 10 位回显，故存储的 UTC 日期须与所选一致（不能差一天）。
        assert_eq!(dt.date_naive().to_string(), "2026-06-25");
        assert_eq!(dt.to_rfc3339(), "2026-06-25T00:00:00+00:00");
    }

    #[test]
    fn update_req_distinguishes_absent_null_and_value() {
        let absent: UpdateTaskReq = serde_json::from_str(r#"{}"#).unwrap();
        assert!(absent.deadline.is_none(), "缺省=保持原值");

        let cleared: UpdateTaskReq = serde_json::from_str(r#"{"deadline":null}"#).unwrap();
        assert_eq!(cleared.deadline, Some(None), "显式 null=清空");
    }

    #[test]
    fn create_req_accepts_date_only() {
        let req: CreateTaskReq =
            serde_json::from_str(r#"{"title":"t","deadline":"2026-06-25"}"#).unwrap();
        assert!(req.deadline.is_some());
    }

    // ── 分页每页条数钳制 ─────────────────────────────────────────────────
    // 回归：per_page=0 曾导致 total_pages=(total+per_page-1)/per_page 整数除零 panic。
    #[test]
    fn per_page_never_zero() {
        assert_eq!(clamp_per_page(Some(0)), 1, "0 必须钳到 1，避免除零");
        assert_eq!(clamp_per_page(Some(-5)), 1, "负数也钳到 1");
        assert_eq!(clamp_per_page(None), 20, "缺省 20");
        assert_eq!(clamp_per_page(Some(50)), 50);
        assert_eq!(clamp_per_page(Some(9999)), 200, "上界 200");
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
    // 下界钳到 1，避免 per_page=0 触发 total_pages 计算时的整数除零 panic。
    let per_page = clamp_per_page(q.per_page);
    // page 无上界，(page-1)*per_page 对超大 page 会 i64 溢出（debug/测试构建 panic，release 得到垃圾值）。
    // page>=1、per_page>=1 时 offset 恒非负，用 saturating_mul 封顶到 i64::MAX 即可安全。
    let offset = (page - 1).saturating_mul(per_page);

    // We build a fixed query supporting optional filters
    let category_filter = q.category.as_deref().unwrap_or("");
    let search_filter = q.search.as_deref().unwrap_or("");

    let order_clause = match q.sort_by.as_deref() {
        Some("deadline") => "t.deadline ASC NULLS LAST, t.created_at DESC",
        Some("star") => "t.star_rating DESC, t.created_at DESC",
        _ => "t.created_at DESC",
    };

    // 状态过滤（待办/已完成/已过期）。仅对顶层任务生效。
    let status_clause = status_filter_sql(q.status.as_deref(), "t.");

    // Build SQL with optional WHERE clauses
    // We use $1=uid, $2=category_or_empty, $3=search_or_empty
    let sql_count = format!(
        "SELECT COUNT(*) FROM tasks t \
         WHERE t.user_id = $1 \
           AND t.deleted_at IS NULL \
           AND ($2 = '' OR t.category = $2) \
           AND ($3 = '' OR (t.title ILIKE $4 OR t.description ILIKE $4)) \
           AND ($5::uuid IS NULL OR t.parent_id = $5) \
           AND ($5::uuid IS NOT NULL OR t.parent_id IS NULL){status_clause}"
    );

    let sql_data = format!(
        "SELECT t.* FROM tasks t \
         WHERE t.user_id = $1 \
           AND t.deleted_at IS NULL \
           AND ($2 = '' OR t.category = $2) \
           AND ($3 = '' OR (t.title ILIKE $4 OR t.description ILIKE $4)) \
           AND ($5::uuid IS NULL OR t.parent_id = $5) \
           AND ($5::uuid IS NOT NULL OR t.parent_id IS NULL){status_clause} \
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

    // Validate category（自由文本，非空且 ≤10 字符；见 is_valid_category）
    let category = body.category.as_deref().unwrap_or("其他").trim();
    let category = if category.is_empty() { "其他" } else { category };
    if !is_valid_category(category) {
        return (StatusCode::BAD_REQUEST, err("分类无效（不能超过 10 个字）"));
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
        let cat = cat.trim();
        if is_valid_category(cat) {
            task.category = cat.to_string();
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
        "incomplete" => {
            // 未完成 = 待办 + 已过期（completed=false，不看截止时间）
            "UPDATE tasks SET deleted_at=$1 \
             WHERE user_id=$2 AND deleted_at IS NULL AND completed=false"
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

// ── 分类管理（Issue #9：自定义分类）─────────────────────────────────────────
// 轻量方案：分类为任务上的自由文本，不建独立表。「已有分类」由用户任务去重得到，
// 前端下拉 = 默认 5 类 ∪ 这里返回的已用分类。重命名/删除即对任务做批量改写。

#[derive(Deserialize)]
pub struct RenameCategoryReq {
    pub from: String,
    pub to: String,
}

#[derive(Deserialize)]
pub struct DeleteCategoryReq {
    pub name: String,
}

/// 列出该用户当前在用的全部分类（含回收站外的任务，去重、按字母序）。
pub async fn list_categories(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let cats: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT category FROM tasks \
         WHERE user_id=$1 AND deleted_at IS NULL AND category <> '' \
         ORDER BY category ASC",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    (StatusCode::OK, ok("获取成功", json!({ "items": cats })))
}

/// 重命名分类：把该用户名下所有该分类的任务（含子任务、含回收站）批量改写为新名。
pub async fn rename_category(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<RenameCategoryReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let from = body.from.trim();
    let to = body.to.trim();
    if from.is_empty() {
        return (StatusCode::BAD_REQUEST, err("原分类不能为空"));
    }
    if !is_valid_category(to) {
        return (StatusCode::BAD_REQUEST, err("新分类无效（不能超过 10 个字）"));
    }

    let res = sqlx::query("UPDATE tasks SET category=$1 WHERE user_id=$2 AND category=$3")
        .bind(to)
        .bind(uid)
        .bind(from)
        .execute(&state.db)
        .await;

    match res {
        Ok(r) => (StatusCode::OK, ok_msg(&format!("已更新 {} 个任务", r.rows_affected()))),
        Err(e) => {
            tracing::error!("rename_category error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, err("重命名失败"))
        }
    }
}

/// 删除分类：把该用户名下所有该分类的任务重新归入「其他」。不删除任务本身。
pub async fn delete_category(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<DeleteCategoryReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let name = body.name.trim();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, err("分类不能为空"));
    }
    if name == "其他" {
        return (StatusCode::BAD_REQUEST, err("默认分类「其他」不能删除"));
    }

    let res = sqlx::query("UPDATE tasks SET category='其他' WHERE user_id=$1 AND category=$2")
        .bind(uid)
        .bind(name)
        .execute(&state.db)
        .await;

    match res {
        Ok(r) => (StatusCode::OK, ok_msg(&format!("已将 {} 个任务归入「其他」", r.rows_affected()))),
        Err(e) => {
            tracing::error!("delete_category error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, err("删除失败"))
        }
    }
}
