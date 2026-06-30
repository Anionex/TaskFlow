use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::current_user;
use crate::models::Task;
use crate::response::{err, ok, ApiResponse};
use crate::state::SharedState;

// ── LLM 客户端 ─────────────────────────────────────────────────────────────

struct LlmConfig {
    base_url: String,
    api_key: String,
    model: String,
}

/// 解析大模型配置，优先级：请求头(本机覆盖) → 账户已保存设置(跨设备) → 服务端默认。
/// 账户设置存于 users 表，使得在 A 设备保存后 B 设备登录同账户也能直接使用。
async fn get_llm_config(headers: &HeaderMap, state: &SharedState, uid: Uuid) -> LlmConfig {
    // 账户持久化的设置（空字符串视为未设置）。
    let (stored_key, stored_model, stored_base): (String, String, String) =
        sqlx::query_as("SELECT llm_api_key, llm_model, llm_base_url FROM users WHERE id=$1")
            .bind(uid)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or_default();

    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
    };
    let non_empty = |s: String| if s.is_empty() { None } else { Some(s) };

    let base_url = header("x-llm-base-url")
        .or_else(|| non_empty(stored_base))
        .unwrap_or_else(|| state.config.llm_base_url.clone());
    let api_key = header("x-llm-key")
        .or_else(|| non_empty(stored_key))
        .unwrap_or_else(|| state.config.llm_api_key.clone());
    let model = header("x-llm-model")
        .or_else(|| non_empty(stored_model))
        .unwrap_or_else(|| state.config.llm_model.clone());

    LlmConfig { base_url, api_key, model }
}

async fn call_llm(
    cfg: &LlmConfig,
    system: &str,
    user_msg: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));

    let body = json!({
        "model": cfg.model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg}
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 2000,
        "temperature": 0
    });

    let resp = client
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("LLM HTTP {status}: {text}"));
    }

    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = data["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("no content")?
        .to_string();
    Ok(content)
}

fn ai_error() -> Json<ApiResponse> {
    err("智能服务暂时不可用，请手动填写")
}

// ── 请求体 ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ParseReq {
    pub text: String,
}

#[derive(Deserialize)]
pub struct BrainDumpReq {
    pub text: String,
}

#[derive(Deserialize)]
pub struct RewriteReq {
    pub title: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct DecomposeReq {
    pub title: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct SearchReq {
    pub query: String,
}

// ── 3.10.1 自然语言解析 ────────────────────────────────────────────────────

pub async fn parse_task(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<ParseReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let cfg = get_llm_config(&headers, &state, uid).await;
    let today = crate::util::beijing_today().format("%Y-%m-%d").to_string();

    let system = format!(
        r#"你是任务解析助手。今天日期：{}。
用户输入一段文字，由你判断里面包含几件事：一句话通常是1件，一段含多件事则拆成多条。
以严格JSON格式输出一个数组：
{{
  "items": [
    {{
      "title": "任务标题（简洁可执行）",
      "description": "备注（可为空字符串）",
      "category": "学习|工作|生活|家庭|其他",
      "star_rating": 0-5整数（0=普通，5=最重要）,
      "start_date": "ISO8601时间字符串或null",
      "deadline": "ISO8601时间字符串或null",
      "suggestion": "改写建议（若任务含糊则给出更具体的建议，否则null）"
    }}
  ]
}}
即使只有1件事也要放进items数组。只输出JSON，不要其他文字。时区使用+08:00。category只能是以上5个之一。"#,
        today
    );

    match call_llm(&cfg, &system, &body.text).await {
        Ok(content) => {
            match serde_json::from_str::<Value>(&content) {
                Ok(data) => (StatusCode::OK, ok("解析成功", normalize_items(data))),
                Err(_) => (StatusCode::OK, (ai_error())),
            }
        }
        Err(e) => {
            tracing::warn!("parse_task LLM error: {e}");
            (StatusCode::OK, ai_error())
        }
    }
}

/// Normalize the LLM output into `{ "items": [ ... ] }`.
/// Accepts either a bare task object, a `{items:[...]}` wrapper, or a top-level array.
fn normalize_items(data: Value) -> Value {
    if let Some(items) = data.get("items") {
        if items.is_array() {
            return json!({ "items": items });
        }
    }
    if data.is_array() {
        return json!({ "items": data });
    }
    // Single task object → wrap into a one-element array.
    json!({ "items": [data] })
}

// ── 3.10.2 批量捕获 ────────────────────────────────────────────────────────

pub async fn brain_dump(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<BrainDumpReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let cfg = get_llm_config(&headers, &state, uid).await;
    let today = crate::util::beijing_today().format("%Y-%m-%d").to_string();

    let system = format!(
        r#"你是任务整理助手。今天日期：{}。
用户会一次输入多件事，请拆分成多条任务，以严格JSON格式输出：
{{
  "items": [
    {{
      "title": "...",
      "description": "",
      "category": "学习|工作|生活|家庭|其他",
      "star_rating": 0-5,
      "start_date": null,
      "deadline": null,
      "suggestion": null
    }}
  ]
}}
只输出JSON，不要其他文字。时区+08:00。"#,
        today
    );

    match call_llm(&cfg, &system, &body.text).await {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(data) => (StatusCode::OK, ok("解析成功", normalize_items(data))),
            Err(_) => (StatusCode::OK, ai_error()),
        },
        Err(e) => {
            tracing::warn!("brain_dump LLM error: {e}");
            (StatusCode::OK, ai_error())
        }
    }
}

// ── 3.10.3 下一步改写 ─────────────────────────────────────────────────────

pub async fn rewrite_task(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<RewriteReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let cfg = get_llm_config(&headers, &state, uid).await;

    let system = r#"你是GTD任务改写助手。
判断任务是否为"含糊、不可执行"的大目标，并输出严格JSON：
{
  "actionable": true/false,
  "suggested_title": "若actionable=false，给出具体可执行的下一步行动；否则与原标题相同",
  "reason": "说明原因"
}
只输出JSON，不要其他文字。"#;

    let user_msg = format!(
        "标题：{}\n备注：{}",
        body.title,
        body.description.as_deref().unwrap_or("")
    );

    match call_llm(&cfg, system, &user_msg).await {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(data) => (StatusCode::OK, ok("改写完成", data)),
            Err(_) => (StatusCode::OK, ai_error()),
        },
        Err(e) => {
            tracing::warn!("rewrite_task LLM error: {e}");
            (StatusCode::OK, ai_error())
        }
    }
}

// ── 3.10.4 大任务拆解 ─────────────────────────────────────────────────────

pub async fn decompose_task(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<DecomposeReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let cfg = get_llm_config(&headers, &state, uid).await;
    let today = crate::util::beijing_today().format("%Y-%m-%d").to_string();

    let system = format!(
        r#"你是任务拆解助手。今天日期：{}。
判断该任务是否为大目标需要拆解，输出严格JSON：
{{
  "is_big_task": true/false,
  "parent": {{"title": "...", "category": "学习|工作|生活|家庭|其他"}},
  "subtasks": [
    {{"title": "...", "sort_order": 1, "star_rating": 3}},
    ...
  ]
}}
若is_big_task=false则subtasks为空数组。每个子任务需有sort_order（从1开始）。只输出JSON。"#,
        today
    );

    let user_msg = format!(
        "标题：{}\n备注：{}",
        body.title,
        body.description.as_deref().unwrap_or("")
    );

    match call_llm(&cfg, &system, &user_msg).await {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(data) => (StatusCode::OK, ok("拆解完成", data)),
            Err(_) => (StatusCode::OK, ai_error()),
        },
        Err(e) => {
            tracing::warn!("decompose_task LLM error: {e}");
            (StatusCode::OK, ai_error())
        }
    }
}

// ── 3.10.5 语义检索 ────────────────────────────────────────────────────────

pub async fn semantic_search(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<SearchReq>,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    // Load all non-deleted tasks for this user
    let tasks: Vec<Task> = sqlx::query_as(
        "SELECT * FROM tasks WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if tasks.is_empty() {
        return (StatusCode::OK, ok("检索完成", json!({"items": [], "explanation": "暂无任务"})));
    }

    let cfg = get_llm_config(&headers, &state, uid).await;
    let today = crate::util::beijing_today().format("%Y-%m-%d").to_string();

    // Serialize tasks as context
    let tasks_json = serde_json::to_string(
        &tasks
            .iter()
            .map(|t| {
                json!({
                    "id": t.id,
                    "title": t.title,
                    "description": t.description,
                    "category": t.category,
                    "star_rating": t.star_rating,
                    "completed": t.completed,
                    "deadline": t.deadline,
                    "created_at": t.created_at,
                })
            })
            .collect::<Vec<_>>(),
    )
    .unwrap_or_default();

    let system = format!(
        r#"你是任务检索助手。今天日期：{}。
以下是用户的任务列表（JSON），请根据查询语义筛选出最相关的任务，按相关性和紧迫度排序，输出严格JSON：
{{
  "items": [
    {{"id": "uuid", "title": "...", "reason": "匹配原因"}},
    ...
  ],
  "explanation": "总体说明"
}}
任务列表：
{}"#,
        today, tasks_json
    );

    match call_llm(&cfg, &system, &body.query).await {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(data) => {
                // 用 LLM 返回的 id 回查真实任务，输出完整 Task 对象（前端按 Task 渲染元信息）
                use std::collections::HashMap;
                let by_id: HashMap<String, &Task> =
                    tasks.iter().map(|t| (t.id.to_string(), t)).collect();
                let mut items: Vec<Value> = Vec::new();
                if let Some(arr) = data.get("items").and_then(|v| v.as_array()) {
                    for it in arr {
                        if let Some(id) = it.get("id").and_then(|v| v.as_str()) {
                            if let Some(t) = by_id.get(id) {
                                items.push(serde_json::to_value(t).unwrap_or(Value::Null));
                            }
                        }
                    }
                }
                let explanation = data.get("explanation").cloned().unwrap_or(Value::Null);
                (
                    StatusCode::OK,
                    ok("检索完成", json!({"items": items, "explanation": explanation})),
                )
            }
            Err(_) => (StatusCode::OK, ai_error()),
        },
        Err(e) => {
            tracing::warn!("semantic_search LLM error: {e}");
            (StatusCode::OK, ai_error())
        }
    }
}

// ── 3.10.6 早间推荐 ────────────────────────────────────────────────────────

pub async fn morning_recommend(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    let tasks: Vec<Task> = sqlx::query_as(
        "SELECT * FROM tasks WHERE user_id=$1 AND deleted_at IS NULL AND completed=false ORDER BY deadline ASC NULLS LAST LIMIT 100",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let tone: String = sqlx::query_scalar("SELECT summary_tone FROM users WHERE id=$1")
        .bind(uid)
        .fetch_one(&state.db)
        .await
        .unwrap_or_else(|_| "温暖鼓励型".into());

    let cfg = get_llm_config(&headers, &state, uid).await;
    let today = crate::util::beijing_today().format("%Y-%m-%d").to_string();

    let tasks_json = serde_json::to_string(
        &tasks
            .iter()
            .map(|t| {
                json!({
                    "id": t.id,
                    "title": t.title,
                    "category": t.category,
                    "star_rating": t.star_rating,
                    "deadline": t.deadline,
                    "created_at": t.created_at,
                })
            })
            .collect::<Vec<_>>(),
    )
    .unwrap_or_default();

    let system = format!(
        r#"你是任务推荐助手，语气风格：{}。今天日期：{}。
根据以下未完成任务，推荐今天最值得做的3-5件事，综合考虑截止时间、重要程度、任务类型。
输出严格JSON：
{{
  "recommendations": [
    {{"task_id": "uuid", "title": "...", "reason": "推荐理由"}}
  ]
}}
只输出JSON。
任务列表：{}"#,
        tone, today, tasks_json
    );

    match call_llm(&cfg, &system, "请给出今日推荐").await {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(data) => (StatusCode::OK, ok("推荐成功", data)),
            Err(_) => (StatusCode::OK, ai_error()),
        },
        Err(e) => {
            tracing::warn!("morning_recommend LLM error: {e}");
            (StatusCode::OK, ai_error())
        }
    }
}

// ── 3.10.7 晚间总结 ────────────────────────────────────────────────────────

pub async fn evening_summary(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    // 北京时区今天 0 点（对应 UTC 时刻），与提示词的 +08:00 口径一致
    let today_start = crate::util::beijing_today_start_utc();

    // Today's tasks
    let completed_today: Vec<Task> = sqlx::query_as(
        "SELECT * FROM tasks WHERE user_id=$1 AND deleted_at IS NULL AND completed=true AND completed_at >= $2",
    )
    .bind(uid)
    .bind(today_start)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let created_today: Vec<Task> = sqlx::query_as(
        "SELECT * FROM tasks WHERE user_id=$1 AND deleted_at IS NULL AND created_at >= $2",
    )
    .bind(uid)
    .bind(today_start)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let overdue: Vec<Task> = sqlx::query_as(
        "SELECT * FROM tasks WHERE user_id=$1 AND deleted_at IS NULL AND completed=false AND deadline < now()",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let tone: String = sqlx::query_scalar("SELECT summary_tone FROM users WHERE id=$1")
        .bind(uid)
        .fetch_one(&state.db)
        .await
        .unwrap_or_else(|_| "温暖鼓励型".into());

    let cfg = get_llm_config(&headers, &state, uid).await;
    let today = crate::util::beijing_today().format("%Y-%m-%d").to_string();

    let context = json!({
        "today": today,
        "completed_today": completed_today.iter().map(|t| &t.title).collect::<Vec<_>>(),
        "created_today": created_today.iter().map(|t| &t.title).collect::<Vec<_>>(),
        "overdue": overdue.iter().map(|t| &t.title).collect::<Vec<_>>(),
    });

    let system = format!(
        r#"你是任务总结助手，语气风格：{}。今天日期：{}。
根据以下今日任务数据，生成一段今日回顾与推进建议。
输出严格JSON：
{{
  "summary": "总结文字（2-4句话）"
}}
只输出JSON。"#,
        tone, today
    );

    match call_llm(&cfg, &system, &context.to_string()).await {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(data) => (StatusCode::OK, ok("总结生成成功", data)),
            Err(_) => (StatusCode::OK, ai_error()),
        },
        Err(e) => {
            tracing::warn!("evening_summary LLM error: {e}");
            (StatusCode::OK, ai_error())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_items;
    use serde_json::json;

    #[test]
    fn wraps_items_array() {
        let input = json!({ "items": [{ "title": "a" }, { "title": "b" }] });
        let out = normalize_items(input);
        assert_eq!(out["items"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn wraps_top_level_array() {
        let input = json!([{ "title": "a" }]);
        let out = normalize_items(input);
        assert_eq!(out["items"].as_array().unwrap().len(), 1);
        assert_eq!(out["items"][0]["title"], "a");
    }

    #[test]
    fn wraps_single_object() {
        let input = json!({ "title": "solo", "category": "工作" });
        let out = normalize_items(input);
        assert_eq!(out["items"].as_array().unwrap().len(), 1);
        assert_eq!(out["items"][0]["title"], "solo");
    }
}
