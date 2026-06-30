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

/// 自带 key 时 base/model 的兜底（设置页申请 key 的入口就是 DeepSeek 官方）。
const DEEPSEEK_BASE: &str = "https://api.deepseek.com";
const DEEPSEEK_MODEL: &str = "deepseek-chat";

/// 把"用户显式值"与"服务端默认"解析成最终 LLM 配置。
///
/// 关键点：一旦用户自带了 key，base/model 留空时必须默认 DeepSeek 官方，
/// 而**不能**回退到服务端默认的 aihubmix——否则会把用户的 DeepSeek key 发去
/// aihubmix 导致 401（"服务不可用，请手动填写"）。只有完全没有自带 key 时，
/// 才用服务端那套同源的完整三件套。
fn resolve_llm(
    user_key: Option<String>,
    user_base: Option<String>,
    user_model: Option<String>,
    def_key: &str,
    def_base: &str,
    def_model: &str,
) -> LlmConfig {
    match user_key {
        Some(key) => LlmConfig {
            api_key: key,
            base_url: user_base.unwrap_or_else(|| DEEPSEEK_BASE.to_string()),
            model: user_model.unwrap_or_else(|| DEEPSEEK_MODEL.to_string()),
        },
        None => LlmConfig {
            api_key: def_key.to_string(),
            base_url: user_base.unwrap_or_else(|| def_base.to_string()),
            model: user_model.unwrap_or_else(|| def_model.to_string()),
        },
    }
}

/// 解析大模型配置。每个用户显式值的来源优先级：请求头(本机覆盖) → 账户已保存设置(跨设备)。
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

    let user_key = header("x-llm-key").or_else(|| non_empty(stored_key));
    let user_base = header("x-llm-base-url").or_else(|| non_empty(stored_base));
    let user_model = header("x-llm-model").or_else(|| non_empty(stored_model));

    resolve_llm(
        user_key,
        user_base,
        user_model,
        &state.config.llm_api_key,
        &state.config.llm_base_url,
        &state.config.llm_model,
    )
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

/// 轻量的"用户当前在做什么"梗概，注入到创建/拆解类提示词，
/// 帮助模型避免与既有任务重复、保持分类与重要度风格一致。
/// 只取概要（最近若干条未完成任务标题 + 分类分布），不塞全量任务，控制 token 与跑偏风险。
async fn user_context_brief(state: &SharedState, uid: Uuid) -> String {
    let tasks: Vec<(String, String)> = sqlx::query_as(
        "SELECT title, category FROM tasks \
         WHERE user_id=$1 AND deleted_at IS NULL AND completed=false \
         ORDER BY created_at DESC LIMIT 30",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if tasks.is_empty() {
        return "用户当前没有未完成任务。".to_string();
    }

    let recent: Vec<&str> = tasks.iter().take(8).map(|(t, _)| t.as_str()).collect();

    use std::collections::BTreeMap;
    let mut by_cat: BTreeMap<&str, i32> = BTreeMap::new();
    for (_, c) in &tasks {
        *by_cat.entry(c.as_str()).or_insert(0) += 1;
    }
    let cats: Vec<String> = by_cat.iter().map(|(c, n)| format!("{c}×{n}")).collect();

    format!(
        "用户最近的未完成任务（仅供参考，用于避免重复、保持分类与重要度风格一致；不要把用户的新输入合并进这些已有任务）：{}。常见分类：{}。",
        recent.join("、"),
        cats.join("、"),
    )
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
    /// 任务页当前的筛选选择器（待办/已完成/已过期、分类）一并作为检索上下文，
    /// 用于把候选任务限定在用户当前关注的范围内。
    pub status: Option<String>,
    pub category: Option<String>,
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
    let now = crate::util::beijing_now_label();
    let brief = user_context_brief(&state, uid).await;

    let system = format!(
        r#"你是任务解析助手。当前时间：{}。
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
即使只有1件事也要放进items数组。只输出JSON，不要其他文字。时区使用+08:00。"周三/这周末/下午3点/2小时后"等相对时间请基于上面的当前时间换算。category只能是以上5个之一。
{}"#,
        now, brief
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
    let now = crate::util::beijing_now_label();
    let brief = user_context_brief(&state, uid).await;

    let system = format!(
        r#"你是任务整理助手。当前时间：{}。
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
只输出JSON，不要其他文字。时区+08:00。相对时间请基于上面的当前时间换算。
{}"#,
        now, brief
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
    let now = crate::util::beijing_now_label();

    let system = format!(
        r#"你是GTD任务改写助手。当前时间：{}。
判断任务是否为"含糊、不可执行"的大目标，并输出严格JSON：
{{
  "actionable": true/false,
  "suggested_title": "若actionable=false，给出具体可执行的下一步行动；否则与原标题相同",
  "reason": "说明原因"
}}
只输出JSON，不要其他文字。"#,
        now
    );

    let user_msg = format!(
        "标题：{}\n备注：{}",
        body.title,
        body.description.as_deref().unwrap_or("")
    );

    match call_llm(&cfg, &system, &user_msg).await {
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
    let now = crate::util::beijing_now_label();
    let brief = user_context_brief(&state, uid).await;

    let system = format!(
        r#"你是任务拆解助手。当前时间：{}。
判断该任务是否为大目标需要拆解，输出严格JSON：
{{
  "is_big_task": true/false,
  "parent": {{"title": "...", "category": "学习|工作|生活|家庭|其他"}},
  "subtasks": [
    {{"title": "...", "sort_order": 1, "star_rating": 3}},
    ...
  ]
}}
若is_big_task=false则subtasks为空数组。每个子任务需有sort_order（从1开始）。只输出JSON。
{}"#,
        now, brief
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

    // 候选任务范围 = 用户当前筛选选择器（状态 + 分类）。把这些选择作为检索上下文，
    // 让"和学习有关的重要任务"这类查询只在所选状态/分类内匹配。
    let status_clause = crate::tasks::status_filter_sql(body.status.as_deref(), "");
    let category = body.category.clone().unwrap_or_default();
    let sql = format!(
        "SELECT * FROM tasks WHERE user_id=$1 AND deleted_at IS NULL \
         AND ($2 = '' OR category = $2){status_clause} \
         ORDER BY created_at DESC LIMIT 200"
    );
    let tasks: Vec<Task> = sqlx::query_as(&sql)
        .bind(uid)
        .bind(&category)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    if tasks.is_empty() {
        return (StatusCode::OK, ok("检索完成", json!({"items": [], "explanation": "当前筛选范围内暂无任务"})));
    }

    let cfg = get_llm_config(&headers, &state, uid).await;
    let today = crate::util::beijing_now_label();

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

    let scope = {
        let st = match body.status.as_deref() {
            Some("completed") => "已完成",
            Some("expired") => "已过期",
            Some("pending") => "待办",
            _ => "全部状态",
        };
        let cat = if category.is_empty() { "全部分类".to_string() } else { category.clone() };
        format!("{st} / {cat}")
    };

    let system = format!(
        r#"你是任务检索助手。当前时间：{}。
用户已在任务页选择了筛选范围：{}。下面的任务列表已按该范围预筛选，请只在其中按查询语义筛选最相关的任务，按相关性和紧迫度排序，输出严格JSON：
{{
  "items": [
    {{"id": "uuid", "title": "...", "reason": "匹配原因"}},
    ...
  ],
  "explanation": "总体说明"
}}
任务列表：
{}"#,
        today, scope, tasks_json
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
    let today = crate::util::beijing_now_label();

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
        r#"你是任务推荐助手，语气风格：{}。当前时间：{}。
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
    let today = crate::util::beijing_now_label();

    let context = json!({
        "today": today,
        "completed_today": completed_today.iter().map(|t| &t.title).collect::<Vec<_>>(),
        "created_today": created_today.iter().map(|t| &t.title).collect::<Vec<_>>(),
        "overdue": overdue.iter().map(|t| &t.title).collect::<Vec<_>>(),
    });

    let system = format!(
        r#"你是任务总结助手，语气风格：{}。当前时间：{}。
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
    use super::{normalize_items, resolve_llm};
    use serde_json::json;

    const DEF_KEY: &str = "server-key";
    const DEF_BASE: &str = "https://aihubmix.com/v1";
    const DEF_MODEL: &str = "deepseek-v4-flash";

    fn s(v: &str) -> Option<String> {
        Some(v.to_string())
    }

    // 用户没自带 key → 用服务端完整三件套（同源）。
    #[test]
    fn no_user_key_uses_server_triplet() {
        let c = resolve_llm(None, None, None, DEF_KEY, DEF_BASE, DEF_MODEL);
        assert_eq!(c.api_key, DEF_KEY);
        assert_eq!(c.base_url, DEF_BASE);
        assert_eq!(c.model, DEF_MODEL);
    }

    // 复现并锁定 bug：自带 key、model/base 留空 → 必须默认 DeepSeek 官方，
    // 绝不能回退到服务端的 aihubmix（否则把用户 key 发错服务商）。
    #[test]
    fn byo_key_only_defaults_to_deepseek_not_aihubmix() {
        let c = resolve_llm(s("sk-user"), None, None, DEF_KEY, DEF_BASE, DEF_MODEL);
        assert_eq!(c.api_key, "sk-user");
        assert_eq!(c.base_url, "https://api.deepseek.com");
        assert_eq!(c.model, "deepseek-chat");
    }

    // 自带 key 且显式给了 base/model → 原样使用（如 aihubmix 用户或测试 mock）。
    #[test]
    fn byo_key_with_explicit_base_model_is_respected() {
        let c = resolve_llm(
            s("sk-user"),
            s("https://mock/v1"),
            s("test-model"),
            DEF_KEY,
            DEF_BASE,
            DEF_MODEL,
        );
        assert_eq!(c.api_key, "sk-user");
        assert_eq!(c.base_url, "https://mock/v1");
        assert_eq!(c.model, "test-model");
    }

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
