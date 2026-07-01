use axum::{
    extract::{Json, Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::current_user;
use crate::models::TaskTemplate;
use crate::response::{err, ok, ok_msg, ApiResponse};
use crate::state::SharedState;
use crate::tasks::{clamp_star_rating, is_valid_category};

#[derive(Deserialize)]
pub struct CreateTemplateReq {
    pub title: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub star_rating: Option<i16>,
    pub frequency: String,
    pub generate_day: Option<i16>,
    pub generate_time: Option<String>,
    pub deadline_day: Option<i16>,
    pub deadline_time: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateTemplateReq {
    pub title: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub star_rating: Option<i16>,
    pub frequency: Option<String>,
    pub generate_day: Option<i16>,
    pub generate_time: Option<String>,
    pub deadline_day: Option<i16>,
    pub deadline_time: Option<String>,
}

pub async fn list_templates(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let templates: Vec<TaskTemplate> =
        sqlx::query_as("SELECT * FROM task_templates WHERE user_id=$1 ORDER BY created_at DESC")
            .bind(uid)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    (StatusCode::OK, ok("获取成功", serde_json::json!({"items": templates})))
}

pub async fn create_template(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<CreateTemplateReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    if body.title.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, err("模板标题不能为空"));
    }
    if !["daily", "weekly", "monthly"].contains(&body.frequency.as_str()) {
        return (StatusCode::BAD_REQUEST, err("频率无效，应为 daily/weekly/monthly"));
    }
    let category = body.category.as_deref().unwrap_or("其他");
    if !is_valid_category(category) {
        return (StatusCode::BAD_REQUEST, err("分类无效"));
    }

    let tmpl: Result<TaskTemplate, _> = sqlx::query_as(
        "INSERT INTO task_templates (user_id, title, description, category, star_rating, frequency, generate_day, generate_time, deadline_day, deadline_time) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
    )
    .bind(uid)
    .bind(body.title.trim())
    .bind(body.description.as_deref().unwrap_or(""))
    .bind(category)
    .bind(clamp_star_rating(body.star_rating.unwrap_or(0)))
    .bind(&body.frequency)
    .bind(body.generate_day.unwrap_or(0))
    .bind(body.generate_time.as_deref().unwrap_or("09:00"))
    .bind(body.deadline_day.unwrap_or(0))
    .bind(body.deadline_time.as_deref().unwrap_or("18:00"))
    .fetch_one(&state.db)
    .await;

    match tmpl {
        Ok(t) => (StatusCode::CREATED, ok("模板创建成功", t)),
        Err(e) => {
            tracing::error!("create_template error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, err("创建失败"))
        }
    }
}

pub async fn update_template(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateTemplateReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let existing: Option<TaskTemplate> =
        sqlx::query_as("SELECT * FROM task_templates WHERE id=$1 AND user_id=$2")
            .bind(id)
            .bind(uid)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

    let mut tmpl = match existing {
        Some(t) => t,
        None => return (StatusCode::NOT_FOUND, err("模板不存在")),
    };

    if let Some(title) = body.title {
        if !title.trim().is_empty() {
            tmpl.title = title.trim().to_string();
        }
    }
    if let Some(desc) = body.description {
        tmpl.description = desc;
    }
    if let Some(cat) = body.category {
        // 与 create_template 一致：分类非法直接 400。
        if !is_valid_category(&cat) {
            return (StatusCode::BAD_REQUEST, err("分类无效"));
        }
        tmpl.category = cat;
    }
    if let Some(sr) = body.star_rating {
        tmpl.star_rating = sr;
    }
    if let Some(freq) = body.frequency {
        // 与 create_template 一致：频率非法直接 400。
        if !["daily", "weekly", "monthly"].contains(&freq.as_str()) {
            return (StatusCode::BAD_REQUEST, err("频率无效，应为 daily/weekly/monthly"));
        }
        tmpl.frequency = freq;
    }
    if let Some(gd) = body.generate_day {
        tmpl.generate_day = gd;
    }
    if let Some(gt) = body.generate_time {
        tmpl.generate_time = gt;
    }
    if let Some(dd) = body.deadline_day {
        tmpl.deadline_day = dd;
    }
    if let Some(dt) = body.deadline_time {
        tmpl.deadline_time = dt;
    }

    let updated: Option<TaskTemplate> = sqlx::query_as(
        "UPDATE task_templates SET title=$1, description=$2, category=$3, star_rating=$4, frequency=$5, \
         generate_day=$6, generate_time=$7, deadline_day=$8, deadline_time=$9 \
         WHERE id=$10 AND user_id=$11 RETURNING *",
    )
    .bind(&tmpl.title)
    .bind(&tmpl.description)
    .bind(&tmpl.category)
    .bind(tmpl.star_rating)
    .bind(&tmpl.frequency)
    .bind(tmpl.generate_day)
    .bind(&tmpl.generate_time)
    .bind(tmpl.deadline_day)
    .bind(&tmpl.deadline_time)
    .bind(id)
    .bind(uid)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    match updated {
        Some(t) => (StatusCode::OK, ok("模板更新成功", t)),
        None => (StatusCode::INTERNAL_SERVER_ERROR, err("更新失败")),
    }
}

pub async fn delete_template(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let result = sqlx::query("DELETE FROM task_templates WHERE id=$1 AND user_id=$2")
        .bind(id)
        .bind(uid)
        .execute(&state.db)
        .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, ok_msg("模板删除成功")),
        Ok(_) => (StatusCode::NOT_FOUND, err("模板不存在")),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, err("删除失败")),
    }
}

/// 从模板生成一条任务（截止时间按北京时区解释），并更新 last_generated。成功返回 true。
/// 手动生成与后台调度共用此逻辑（DRY）。
pub async fn generate_task_from_template(
    db: &sqlx::PgPool,
    tmpl: &TaskTemplate,
    today: chrono::NaiveDate,
) -> bool {
    use chrono::TimeZone;
    let deadline_date = today + chrono::Duration::days(tmpl.deadline_day as i64);
    let parts: Vec<&str> = tmpl.deadline_time.split(':').collect();
    let hour: u32 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(18);
    let min: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let deadline_dt = deadline_date.and_hms_opt(hour, min, 0).and_then(|naive| {
        crate::util::beijing_offset()
            .from_local_datetime(&naive)
            .single()
            .map(|dt| dt.with_timezone(&chrono::Utc))
    });

    let r = sqlx::query(
        "INSERT INTO tasks (user_id, title, description, category, star_rating, deadline) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(tmpl.user_id)
    .bind(&tmpl.title)
    .bind(&tmpl.description)
    .bind(&tmpl.category)
    .bind(tmpl.star_rating)
    .bind(deadline_dt)
    .execute(db)
    .await;

    if r.is_ok() {
        let _ = sqlx::query("UPDATE task_templates SET last_generated=$1 WHERE id=$2")
            .bind(today)
            .bind(tmpl.id)
            .execute(db)
            .await;
        true
    } else {
        false
    }
}

/// 手动触发生成任务：从该用户的每个模板各立即生成 1 个任务（忽略 schedule 到期判断，
/// 因为这是用户按需手动生成）。无模板时返回提示。
pub async fn generate_tasks(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let templates: Vec<TaskTemplate> =
        sqlx::query_as("SELECT * FROM task_templates WHERE user_id=$1")
            .bind(uid)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    if templates.is_empty() {
        return (StatusCode::OK, err("请先创建模板"));
    }

    let today = crate::util::beijing_today();
    let mut generated = 0u32;

    for tmpl in &templates {
        // 每个习惯每天至多生成一次：当日已生成（last_generated==今天）则跳过，保证手动生成幂等。
        if tmpl.last_generated == Some(today) {
            continue;
        }
        if generate_task_from_template(&state.db, tmpl, today).await {
            generated += 1;
        }
    }

    (
        StatusCode::OK,
        ok(
            &format!("已生成 {} 个任务", generated),
            serde_json::json!({ "generated": generated }),
        ),
    )
}
