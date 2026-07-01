//! Agent 模式：可多轮、有记忆的对话，通过"工具"（内部接口）读写用户的业务数据。
//!
//! 设计要点：
//! - **无状态后端**：对话记忆由前端持有并每次回传（OpenAI 格式的 `messages` 数组）。
//!   后端每次都现拼一条最新的 system 提示词放在最前，返回时再剥掉——既保证时间等
//!   上下文常新，也避免 system 被前端篡改。
//! - **读工具**（list_tasks / get_stats）即时执行；**写工具**（create/update/delete）
//!   不直接落库，而是把"拟改动"作为 `pending` 返回给前端，由用户点确认/拒绝后，
//!   下一次请求带 `decision` 回来才真正执行（或记为拒绝让模型改方案）。
//! - 单轮内最多 `MAX_STEPS` 次工具往返，避免失控循环与 token 膨胀。

use axum::{
    extract::{Json, State},
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;
use uuid::Uuid;

use crate::ai::{get_llm_config, user_context_brief, LlmConfig};
use crate::auth::current_user;
use crate::models::Task;
use crate::state::SharedState;
use crate::tasks::{clamp_star_rating, is_valid_category, status_filter_sql};

// 单轮内最多工具往返次数；对话历史长度/体量上限（粗略防滥用）。
const MAX_STEPS: usize = 8;
const MAX_MESSAGES: usize = 80;
const MAX_CHARS: usize = 80_000;

// ── 请求体 ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct Decision {
    pub tool_call_id: String,
    pub approved: bool,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct AgentReq {
    /// 前端持有的对话历史（不含 system），原样回传。首轮可为空数组。
    #[serde(default)]
    pub messages: Vec<Value>,
    /// 本轮用户新消息（首轮 / 追问时）。
    #[serde(default)]
    pub user_input: Option<String>,
    /// 对上一条 `pending` 写操作的确认/拒绝。
    #[serde(default)]
    pub decision: Option<Decision>,
}

// ── 工具名分类 ──────────────────────────────────────────────────────────────

fn is_write_tool(name: &str) -> bool {
    matches!(name, "create_task" | "update_task" | "delete_task")
}

fn is_read_tool(name: &str) -> bool {
    matches!(name, "list_tasks" | "get_stats")
}

fn write_action(name: &str) -> &'static str {
    match name {
        "create_task" => "create",
        "update_task" => "update",
        "delete_task" => "delete",
        _ => "unknown",
    }
}

// ── 工具 schema（OpenAI function calling 格式） ─────────────────────────────

fn agent_tools() -> Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "list_tasks",
                "description": "查询当前用户的任务列表（含已完成/未完成；不含回收站）。需要按星期、关键词等进一步分析时，先用本工具拉取再自行判断。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "status": {"type": "string", "enum": ["pending", "completed", "expired", "all"], "description": "待办/已完成/已过期/全部，默认全部"},
                        "category": {"type": "string", "enum": ["学习", "工作", "生活", "家庭", "其他"], "description": "按分类过滤，可选"},
                        "search": {"type": "string", "description": "标题/备注关键词模糊匹配，可选"},
                        "limit": {"type": "integer", "description": "返回条数上限，默认100，最大300"}
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_stats",
                "description": "获取任务统计：总数、已完成、待办、已过期数量。",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "create_task",
                "description": "新建一条任务（需用户确认后才真正写入）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "category": {"type": "string", "enum": ["学习", "工作", "生活", "家庭", "其他"]},
                        "star_rating": {"type": "integer", "description": "0-5，重要度"},
                        "start_date": {"type": "string", "description": "ISO8601 起始时间，可选"},
                        "deadline": {"type": "string", "description": "ISO8601 截止时间，可选"}
                    },
                    "required": ["title"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_task",
                "description": "修改一条已有任务的字段（需用户确认后才生效）。只填要改的字段；deadline/start_date 传 null 表示清空。completed=true 表示标记完成。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "任务 id（uuid）"},
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "category": {"type": "string", "enum": ["学习", "工作", "生活", "家庭", "其他"]},
                        "star_rating": {"type": "integer"},
                        "completed": {"type": "boolean"},
                        "start_date": {"type": ["string", "null"]},
                        "deadline": {"type": ["string", "null"]}
                    },
                    "required": ["id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_task",
                "description": "删除一条任务（软删除到回收站，含其子任务；需用户确认后才生效）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "任务 id（uuid）"}
                    },
                    "required": ["id"]
                }
            }
        }
    ])
}

fn system_message(now: &str, brief: &str) -> Value {
    let content = format!(
        r#"你是 TaskFlow 的智能助理（Agent 模式）。TaskFlow 是一个 GTD 个人任务管理应用。
当前时间：{now}。任务分类只有：学习 / 工作 / 生活 / 家庭 / 其他。星级 star_rating 取值 0-5。

你可以调用工具读写用户的任务数据，规则：
- 回答前先用工具取真实数据，不要凭空编造任务或 id。
- **一次只调用一个工具**，拿到结果再决定下一步。
- 涉及"周一/本周/最近"等时间或关键词筛选时，用 list_tasks 拉取后，基于任务的 created_at / deadline 自行判断，再做统计或归纳。
- 需要新增、修改、删除任务时，调用对应的写工具（create_task/update_task/delete_task）。系统会把这次改动展示给用户确认，**用户确认后才真正生效**，所以参数要完整、准确。
- 如果用户拒绝了某次修改，请礼貌询问他希望怎么调整，不要原样重复同一个改动。
- 最终回答用简洁中文，可以自由使用 Markdown（列表、**加粗**、表格、标题等）让信息清晰易读；按内容需要排版即可，不必强行套用格式。

{brief}"#
    );
    json!({"role": "system", "content": content})
}

// ── 消息构造辅助 ────────────────────────────────────────────────────────────

fn tool_result(tool_call_id: &str, content: &str) -> Value {
    json!({"role": "tool", "tool_call_id": tool_call_id, "content": content})
}

fn tool_step(name: &str, args: &Value, ok: bool, result: &Value) -> Value {
    json!({"kind": "tool", "name": name, "args": args, "ok": ok, "result": result})
}

/// 解析单个 tool_call → (id, name, args)。`function.arguments` 可能是 JSON 字符串或对象。
fn parse_tool_call(tc: &Value) -> Option<(String, String, Value)> {
    let id = tc.get("id").and_then(|v| v.as_str())?.to_string();
    let func = tc.get("function")?;
    let name = func.get("name").and_then(|v| v.as_str())?.to_string();
    let args = match func.get("arguments") {
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or_else(|_| json!({})),
        Some(v) => v.clone(),
        None => json!({}),
    };
    Some((id, name, args))
}

/// 在历史里按 id 找回某个 tool_call（用于 decision 落地时取回 name+args）。
fn find_tool_call(messages: &[Value], id: &str) -> Option<(String, Value)> {
    for m in messages {
        if let Some(calls) = m.get("tool_calls").and_then(|v| v.as_array()) {
            for tc in calls {
                if let Some((cid, name, args)) = parse_tool_call(tc) {
                    if cid == id {
                        return Some((name, args));
                    }
                }
            }
        }
    }
    None
}

/// 历史最后一条 assistant 若带未应答的 tool_calls，返回这些悬空 id（用于容错补一条结果）。
fn dangling_tool_call_ids(messages: &[Value]) -> Vec<String> {
    // 找最后一条带 tool_calls 的 assistant 的位置
    let mut idx = None;
    for (i, m) in messages.iter().enumerate() {
        let is_assistant = m.get("role").and_then(|v| v.as_str()) == Some("assistant");
        if is_assistant && m.get("tool_calls").and_then(|v| v.as_array()).is_some() {
            idx = Some(i);
        }
    }
    let Some(i) = idx else { return Vec::new() };
    let ids: Vec<String> = messages[i]
        .get("tool_calls")
        .and_then(|v| v.as_array())
        .map(|calls| {
            calls
                .iter()
                .filter_map(|tc| tc.get("id").and_then(|v| v.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    // 收集其后已出现的 tool 结果 id
    use std::collections::HashSet;
    let answered: HashSet<&str> = messages[i + 1..]
        .iter()
        .filter_map(|m| m.get("tool_call_id").and_then(|v| v.as_str()))
        .collect();
    ids.into_iter().filter(|id| !answered.contains(id.as_str())).collect()
}

// ── 日期/字段解析 ──────────────────────────────────────────────────────────

/// 宽松解析模型给的时间字符串：RFC3339（带时区）/ 纯日期 / "日期 时:分[:秒]"。
/// 自然语言场景纯日期按北京零点解释（"明天截止"应落在北京当天）。
fn parse_dt_str(s: &str) -> Option<DateTime<Utc>> {
    crate::util::parse_flexible_date(s, crate::util::DateOnlyTz::Beijing)
}

fn parse_dt(v: Option<&Value>) -> Option<DateTime<Utc>> {
    match v {
        Some(Value::String(s)) => parse_dt_str(s),
        _ => None,
    }
}

/// 更新可空日期字段时三态语义：显式 null/空串=清空；可解析字符串=设置；
/// 不可解析的非空字符串=保持原值（绝不因解析失败而误清空，避免与预览不一致）。
enum DateUpdate {
    Clear,
    Set(DateTime<Utc>),
    Leave,
}

fn resolve_date_update(v: &Value) -> DateUpdate {
    match v {
        Value::Null => DateUpdate::Clear,
        Value::String(s) if s.trim().is_empty() => DateUpdate::Clear,
        Value::String(s) => match parse_dt_str(s) {
            Some(d) => DateUpdate::Set(d),
            None => DateUpdate::Leave,
        },
        _ => DateUpdate::Leave,
    }
}

/// 任务精简视图（喂给模型 / 用于预览，控制 token）。
fn compact(t: &Task) -> Value {
    json!({
        "id": t.id,
        "parent_id": t.parent_id,
        "title": t.title,
        "description": t.description,
        "category": t.category,
        "star_rating": t.star_rating,
        "completed": t.completed,
        "start_date": t.start_date,
        "deadline": t.deadline,
        "created_at": t.created_at,
        "completed_at": t.completed_at,
    })
}

// ── 读工具执行 ──────────────────────────────────────────────────────────────

async fn exec_read(
    state: &SharedState,
    uid: Uuid,
    name: &str,
    args: &Value,
) -> Result<Value, String> {
    match name {
        "list_tasks" => exec_list_tasks(state, uid, args).await,
        "get_stats" => exec_get_stats(state, uid).await,
        _ => Err(format!("未知读工具：{name}")),
    }
}

async fn exec_list_tasks(state: &SharedState, uid: Uuid, args: &Value) -> Result<Value, String> {
    let status = args.get("status").and_then(|v| v.as_str());
    // "all" 等同不过滤
    let status = match status {
        Some("all") => None,
        s => s,
    };
    let category = args.get("category").and_then(|v| v.as_str()).unwrap_or("");
    let search = args.get("search").and_then(|v| v.as_str()).unwrap_or("");
    // 上限收紧到 150：避免一次拉取把对话历史撑过体量护栏而卡死后续轮次。
    let limit = args
        .get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(80)
        .clamp(1, 150);

    let status_clause = status_filter_sql(status, "");
    let pattern = if search.is_empty() {
        String::new()
    } else {
        format!("%{}%", search)
    };
    let sql = format!(
        "SELECT * FROM tasks WHERE user_id=$1 AND deleted_at IS NULL \
         AND ($2='' OR category=$2) \
         AND ($3='' OR (title ILIKE $4 OR description ILIKE $4)){status_clause} \
         ORDER BY created_at DESC LIMIT $5"
    );
    let tasks: Vec<Task> = sqlx::query_as(&sql)
        .bind(uid)
        .bind(category)
        .bind(search)
        .bind(&pattern)
        .bind(limit)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let items: Vec<Value> = tasks.iter().map(compact).collect();
    Ok(json!({"count": items.len(), "tasks": items}))
}

async fn exec_get_stats(state: &SharedState, uid: Uuid) -> Result<Value, String> {
    let row: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT \
           count(*), \
           count(*) FILTER (WHERE completed), \
           count(*) FILTER (WHERE NOT completed AND deadline IS NOT NULL AND deadline < now()), \
           count(*) FILTER (WHERE NOT completed AND (deadline IS NULL OR deadline >= now())) \
         FROM tasks WHERE user_id=$1 AND deleted_at IS NULL",
    )
    .bind(uid)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(json!({"total": row.0, "completed": row.1, "expired": row.2, "pending": row.3}))
}

// ── 写工具执行（仅在用户确认后调用） ───────────────────────────────────────

async fn exec_write(
    state: &SharedState,
    uid: Uuid,
    name: &str,
    args: &Value,
) -> Result<Value, String> {
    match name {
        "create_task" => exec_create(state, uid, args).await,
        "update_task" => exec_update(state, uid, args).await,
        "delete_task" => exec_delete(state, uid, args).await,
        _ => Err(format!("未知写工具：{name}")),
    }
}

async fn exec_create(state: &SharedState, uid: Uuid, args: &Value) -> Result<Value, String> {
    let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
    if title.is_empty() {
        return Err("任务标题不能为空".into());
    }
    let category = args.get("category").and_then(|v| v.as_str()).unwrap_or("其他");
    let category = if is_valid_category(category) { category } else { "其他" };
    let star = clamp_star_rating(args.get("star_rating").and_then(|v| v.as_i64()).unwrap_or(0) as i16);
    let description = args.get("description").and_then(|v| v.as_str()).unwrap_or("");
    let start_date = parse_dt(args.get("start_date"));
    let deadline = parse_dt(args.get("deadline"));

    let task: Task = sqlx::query_as(
        "INSERT INTO tasks (user_id, title, description, category, star_rating, start_date, deadline) \
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    )
    .bind(uid)
    .bind(title)
    .bind(description)
    .bind(category)
    .bind(star)
    .bind(start_date)
    .bind(deadline)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(json!({"ok": true, "message": "已创建任务", "task": compact(&task)}))
}

async fn exec_update(state: &SharedState, uid: Uuid, args: &Value) -> Result<Value, String> {
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or("缺少有效的任务 id")?;

    let existing: Option<Task> =
        sqlx::query_as("SELECT * FROM tasks WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL")
            .bind(id)
            .bind(uid)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    let mut task = existing.ok_or("任务不存在")?;

    if let Some(t) = args.get("title").and_then(|v| v.as_str()) {
        if !t.trim().is_empty() {
            task.title = t.trim().to_string();
        }
    }
    if let Some(d) = args.get("description").and_then(|v| v.as_str()) {
        task.description = d.to_string();
    }
    if let Some(c) = args.get("category").and_then(|v| v.as_str()) {
        if is_valid_category(c) {
            task.category = c.to_string();
        }
    }
    if let Some(s) = args.get("star_rating").and_then(|v| v.as_i64()) {
        task.star_rating = clamp_star_rating(s as i16);
    }
    // deadline / start_date：键缺省=保持；null/空串=清空；可解析=设置；
    // 不可解析的字符串=保持原值（不误清空，且与确认卡所示一致）。
    if let Some(v) = args.get("deadline") {
        match resolve_date_update(v) {
            DateUpdate::Clear => task.deadline = None,
            DateUpdate::Set(d) => task.deadline = Some(d),
            DateUpdate::Leave => {}
        }
    }
    if let Some(v) = args.get("start_date") {
        match resolve_date_update(v) {
            DateUpdate::Clear => task.start_date = None,
            DateUpdate::Set(d) => task.start_date = Some(d),
            DateUpdate::Leave => {}
        }
    }
    let completed_at = match args.get("completed").and_then(|v| v.as_bool()) {
        Some(c) => {
            task.completed = c;
            if c { Some(Utc::now()) } else { None }
        }
        None => task.completed_at,
    };

    let updated: Task = sqlx::query_as(
        "UPDATE tasks SET title=$1, description=$2, category=$3, star_rating=$4, \
         start_date=$5, deadline=$6, completed=$7, completed_at=$8 \
         WHERE id=$9 AND user_id=$10 AND deleted_at IS NULL RETURNING *",
    )
    .bind(&task.title)
    .bind(&task.description)
    .bind(&task.category)
    .bind(task.star_rating)
    .bind(task.start_date)
    .bind(task.deadline)
    .bind(task.completed)
    .bind(completed_at)
    .bind(id)
    .bind(uid)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(json!({"ok": true, "message": "已更新任务", "task": compact(&updated)}))
}

async fn exec_delete(state: &SharedState, uid: Uuid, args: &Value) -> Result<Value, String> {
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or("缺少有效的任务 id")?;

    let res = sqlx::query(
        "UPDATE tasks SET deleted_at=now() \
         WHERE (id=$1 OR parent_id=$1) AND user_id=$2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(uid)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    if res.rows_affected() == 0 {
        return Err("任务不存在".into());
    }
    Ok(json!({"ok": true, "message": "已移到回收站", "deleted": res.rows_affected()}))
}

// ── 写操作预览（提案时只读取，不改库） ─────────────────────────────────────

/// 拟改动时，取回受影响任务的当前快照，用于确认卡的"当前 → 拟改"对照。
async fn fetch_current_for_preview(
    state: &SharedState,
    uid: Uuid,
    name: &str,
    args: &Value,
) -> Option<Value> {
    if name == "create_task" {
        return None;
    }
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())?;
    let task: Option<Task> =
        sqlx::query_as("SELECT * FROM tasks WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL")
            .bind(id)
            .bind(uid)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
    task.as_ref().map(compact)
}

/// 生成确认卡的中文摘要（纯函数，便于测试）。
fn propose_summary(name: &str, args: &Value, current: Option<&Value>) -> String {
    let cur_title = current
        .and_then(|c| c.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("该任务");
    match name {
        "create_task" => {
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
            format!("新建任务「{title}」")
        }
        "update_task" => {
            let mut changes: Vec<String> = Vec::new();
            if let Some(t) = args.get("title").and_then(|v| v.as_str()) {
                changes.push(format!("标题→「{t}」"));
            }
            if let Some(c) = args.get("category").and_then(|v| v.as_str()) {
                changes.push(format!("分类→{c}"));
            }
            if let Some(s) = args.get("star_rating").and_then(|v| v.as_i64()) {
                changes.push(format!("星级→{s}"));
            }
            if let Some(v) = args.get("deadline") {
                changes.push(if v.is_null() {
                    "清空截止时间".into()
                } else {
                    format!("截止→{}", v.as_str().unwrap_or(""))
                });
            }
            if let Some(v) = args.get("start_date") {
                changes.push(if v.is_null() {
                    "清空开始时间".into()
                } else {
                    format!("开始→{}", v.as_str().unwrap_or(""))
                });
            }
            if let Some(c) = args.get("completed").and_then(|v| v.as_bool()) {
                changes.push(if c { "标记为完成".into() } else { "标记为未完成".into() });
            }
            if let Some(d) = args.get("description").and_then(|v| v.as_str()) {
                changes.push(format!("备注→「{d}」"));
            }
            if changes.is_empty() {
                format!("修改任务「{cur_title}」")
            } else {
                format!("修改任务「{cur_title}」：{}", changes.join("、"))
            }
        }
        "delete_task" => format!("删除任务「{cur_title}」（移到回收站，含其子任务）"),
        _ => "未知操作".into(),
    }
}

// ── SSE 流式：LLM 调用 ──────────────────────────────────────────────────────

fn sse(name: &str, data: Value) -> Result<Event, Infallible> {
    Ok(Event::default().event(name).data(data.to_string()))
}

/// 把流式返回的 tool_call 增量按 index 累加成完整对象。
fn accumulate_tool_call(acc: &mut Vec<Value>, d: &Value) {
    let idx = d.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    while acc.len() <= idx {
        acc.push(json!({"id": "", "type": "function", "function": {"name": "", "arguments": ""}}));
    }
    let slot = &mut acc[idx];
    if let Some(id) = d.get("id").and_then(|v| v.as_str()) {
        if !id.is_empty() {
            slot["id"] = json!(id);
        }
    }
    if let Some(f) = d.get("function") {
        if let Some(n) = f.get("name").and_then(|v| v.as_str()) {
            if !n.is_empty() {
                slot["function"]["name"] = json!(n);
            }
        }
        if let Some(a) = f.get("arguments").and_then(|v| v.as_str()) {
            let cur = slot["function"]["arguments"].as_str().unwrap_or("").to_string();
            slot["function"]["arguments"] = json!(cur + a);
        }
    }
}

/// 流式调用 LLM：边收边把 content/reasoning 增量通过 `tx` 发给前端（delta/thinking 事件），
/// 同时累加出完整的 assistant 消息（含 tool_calls）返回给循环继续驱动。
async fn stream_llm(
    cfg: &LlmConfig,
    messages: &[Value],
    tools: &Value,
    tx: &mpsc::Sender<Result<Event, Infallible>>,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let body = json!({
        "model": cfg.model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "max_tokens": 1500,
        "temperature": 0,
        "stream": true
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

    let mut stream = resp.bytes_stream();
    // 用字节缓冲按行切分：'\n' 是 ASCII，不会落在多字节 UTF-8 中间，故整行必为合法 UTF-8。
    let mut buf: Vec<u8> = Vec::new();
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut tool_calls: Vec<Value> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        buf.extend_from_slice(&bytes);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                continue;
            }
            let Ok(chunk_json) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            let delta = &chunk_json["choices"][0]["delta"];
            if let Some(c) = delta.get("content").and_then(|v| v.as_str()) {
                if !c.is_empty() {
                    content.push_str(c);
                    let _ = tx.send(sse("delta", json!({"text": c}))).await;
                }
            }
            if let Some(r) = delta.get("reasoning_content").and_then(|v| v.as_str()) {
                if !r.is_empty() {
                    reasoning.push_str(r);
                    let _ = tx.send(sse("thinking", json!({"text": r}))).await;
                }
            }
            if let Some(tcs) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                for tc in tcs {
                    accumulate_tool_call(&mut tool_calls, tc);
                }
            }
        }
    }

    let mut msg = json!({"role": "assistant", "content": content});
    if !tool_calls.is_empty() {
        msg["tool_calls"] = json!(tool_calls);
    }
    if !reasoning.is_empty() {
        msg["reasoning_content"] = json!(reasoning);
    }
    Ok(msg)
}

// ── 主处理器（SSE 流式） ────────────────────────────────────────────────────

pub async fn agent_chat(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(req): Json<AgentReq>,
) -> impl axum::response::IntoResponse {
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(64);

    tokio::spawn(async move {
        // 鉴权失败：SSE 无法回 401，改发一条 error 事件由前端处理。
        let uid = match current_user(&headers, &state).await {
            Ok(u) => u,
            Err(_) => {
                let _ = tx.send(sse("error", json!({"message": "未登录，请重新登录"}))).await;
                return;
            }
        };

        // 体量护栏（仅拦新消息；decision 必须放行以便落地已弹出的待确认写操作）。
        if req.decision.is_none() {
            let over = req.messages.len() > MAX_MESSAGES
                || req.messages.iter().map(|m| m.to_string().len()).sum::<usize>() > MAX_CHARS;
            if over {
                let _ = tx.send(sse("error", json!({"message": "对话过长，请新开一段对话"}))).await;
                return;
            }
        }

        let cfg = get_llm_config(&headers, &state, uid).await;
        let brief = user_context_brief(&state, uid).await;
        let now = crate::util::beijing_now_label();
        let tools = agent_tools();

        let mut msgs: Vec<Value> = Vec::with_capacity(req.messages.len() + MAX_STEPS + 2);
        msgs.push(system_message(&now, &brief));
        msgs.extend(req.messages.into_iter());

        run_agent_stream(state, uid, cfg, msgs, req.decision, req.user_input, tools, tx).await;
    });

    Sse::new(ReceiverStream::new(rx)).keep_alive(KeepAlive::default())
}

/// 一轮 agent 循环，把过程以 SSE 事件流式发出：
/// start(新的模型段) / delta(答复增量) / thinking(推理增量) / tool(工具已执行) / done(收尾) / error。
async fn run_agent_stream(
    state: SharedState,
    uid: Uuid,
    cfg: LlmConfig,
    mut msgs: Vec<Value>,
    decision: Option<Decision>,
    user_input: Option<String>,
    tools: Value,
    tx: mpsc::Sender<Result<Event, Infallible>>,
) {
    // 收尾：剥掉 system，发 done 事件。
    async fn done(
        tx: &mpsc::Sender<Result<Event, Infallible>>,
        msgs: &[Value],
        reply: Value,
        pending: Value,
    ) {
        let out: Vec<&Value> = msgs.iter().skip(1).collect();
        let _ = tx
            .send(sse("done", json!({"messages": out, "reply": reply, "pending": pending})))
            .await;
    }

    // 1) 先落地上一条 pending 的确认/拒绝（若有）
    if let Some(dec) = decision {
        // 安全闸：只允许落地"当前真正悬空(未应答)的写工具调用"，挡住伪造历史直接 approve，
        // 以及写已执行后重发 decision 造成的重复写（此时已不在悬空集合里）。
        let dangling = dangling_tool_call_ids(&msgs);
        let is_pending_write = dangling.contains(&dec.tool_call_id)
            && find_tool_call(&msgs, &dec.tool_call_id)
                .map(|(name, _)| is_write_tool(&name))
                .unwrap_or(false);
        if !is_pending_write {
            done(&tx, &msgs, json!("这个操作似乎已经处理过了，我们继续吧。"), Value::Null).await;
            return;
        }
        let (name, args) = find_tool_call(&msgs, &dec.tool_call_id).expect("checked above");
        if dec.approved {
            match exec_write(&state, uid, &name, &args).await {
                Ok(v) => {
                    let _ = tx.send(sse("tool", tool_step(&name, &args, true, &v))).await;
                    msgs.push(tool_result(&dec.tool_call_id, &v.to_string()));
                }
                Err(e) => {
                    let payload = json!({"error": e});
                    let _ = tx.send(sse("tool", tool_step(&name, &args, false, &payload))).await;
                    msgs.push(tool_result(&dec.tool_call_id, &payload.to_string()));
                }
            }
        } else {
            let note = dec.note.unwrap_or_default();
            let content = if note.trim().is_empty() {
                "用户拒绝了此操作。请询问他希望如何调整。".to_string()
            } else {
                format!("用户拒绝了此操作，并补充：{}。请据此调整。", note.trim())
            };
            msgs.push(tool_result(&dec.tool_call_id, &content));
        }
    } else if let Some(text) = user_input.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        for id in dangling_tool_call_ids(&msgs) {
            msgs.push(tool_result(&id, "用户未确认该操作，已跳过。"));
        }
        msgs.push(json!({"role": "user", "content": text}));
    } else {
        done(&tx, &msgs, json!("缺少消息内容。"), Value::Null).await;
        return;
    }

    // 2) 工具循环（流式）
    for _ in 0..MAX_STEPS {
        let _ = tx.send(sse("start", json!({}))).await;
        let assistant = match stream_llm(&cfg, &msgs, &tools, &tx).await {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("agent stream LLM error: {e}");
                let fallback = "智能服务暂时不稳定，这一步没能完成。你已确认的改动（如有）已经生效；可以稍后再试或换个说法。";
                msgs.push(json!({"role": "assistant", "content": fallback}));
                done(&tx, &msgs, json!(fallback), Value::Null).await;
                return;
            }
        };
        msgs.push(assistant.clone());

        let tool_calls = assistant
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        if tool_calls.is_empty() {
            let content = assistant.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let reply = if content.trim().is_empty() {
                json!("（我这边没有更多补充了，需要我帮你做点什么吗？）")
            } else {
                json!(content)
            };
            done(&tx, &msgs, reply, Value::Null).await;
            return;
        }

        // 一次只处理第一个工具调用；其余补"已跳过"结果，保持协议合法。
        if tool_calls.len() > 1 {
            for extra in &tool_calls[1..] {
                if let Some(id) = extra.get("id").and_then(|v| v.as_str()) {
                    msgs.push(tool_result(id, "一次只处理一个操作，已跳过其余调用。"));
                }
            }
        }

        let Some((tc_id, name, args)) = parse_tool_call(&tool_calls[0]) else {
            let id = tool_calls[0].get("id").and_then(|v| v.as_str()).unwrap_or("");
            msgs.push(tool_result(id, "工具调用格式错误，已忽略。"));
            continue;
        };

        if is_write_tool(&name) {
            let current = fetch_current_for_preview(&state, uid, &name, &args).await;
            let summary = propose_summary(&name, &args, current.as_ref());
            let pending = json!({
                "tool_call_id": tc_id,
                "tool": name,
                "summary": summary,
                "preview": {"action": write_action(&name), "args": args, "current": current},
            });
            done(&tx, &msgs, Value::Null, pending).await;
            return;
        } else if is_read_tool(&name) {
            match exec_read(&state, uid, &name, &args).await {
                Ok(v) => {
                    let _ = tx.send(sse("tool", tool_step(&name, &args, true, &v))).await;
                    msgs.push(tool_result(&tc_id, &v.to_string()));
                }
                Err(e) => {
                    let payload = json!({"error": e});
                    let _ = tx.send(sse("tool", tool_step(&name, &args, false, &payload))).await;
                    msgs.push(tool_result(&tc_id, &payload.to_string()));
                }
            }
        } else {
            msgs.push(tool_result(&tc_id, &format!("未知工具：{name}")));
        }
    }

    done(
        &tx,
        &msgs,
        json!("这次处理的步骤有点多，我先停一下。你可以把问题说得更具体一些。"),
        Value::Null,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_read_classification() {
        for w in ["create_task", "update_task", "delete_task"] {
            assert!(is_write_tool(w));
            assert!(!is_read_tool(w));
        }
        for r in ["list_tasks", "get_stats"] {
            assert!(is_read_tool(r));
            assert!(!is_write_tool(r));
        }
        assert!(!is_write_tool("unknown"));
        assert!(!is_read_tool("unknown"));
    }

    #[test]
    fn parse_tool_call_handles_string_and_object_args() {
        let s = json!({"id": "c1", "function": {"name": "list_tasks", "arguments": "{\"status\":\"all\"}"}});
        let (id, name, args) = parse_tool_call(&s).unwrap();
        assert_eq!(id, "c1");
        assert_eq!(name, "list_tasks");
        assert_eq!(args["status"], "all");

        let o = json!({"id": "c2", "function": {"name": "get_stats", "arguments": {"x": 1}}});
        let (_, _, args2) = parse_tool_call(&o).unwrap();
        assert_eq!(args2["x"], 1);

        // 无 arguments → 空对象
        let n = json!({"id": "c3", "function": {"name": "get_stats"}});
        let (_, _, args3) = parse_tool_call(&n).unwrap();
        assert_eq!(args3, json!({}));
    }

    #[test]
    fn find_tool_call_scans_history() {
        let msgs = vec![
            json!({"role": "user", "content": "hi"}),
            json!({"role": "assistant", "tool_calls": [
                {"id": "tc_9", "function": {"name": "delete_task", "arguments": "{\"id\":\"abc\"}"}}
            ]}),
        ];
        let (name, args) = find_tool_call(&msgs, "tc_9").unwrap();
        assert_eq!(name, "delete_task");
        assert_eq!(args["id"], "abc");
        assert!(find_tool_call(&msgs, "nope").is_none());
    }

    #[test]
    fn dangling_ids_excludes_answered() {
        let msgs = vec![
            json!({"role": "assistant", "tool_calls": [
                {"id": "a", "function": {"name": "list_tasks", "arguments": "{}"}},
                {"id": "b", "function": {"name": "get_stats", "arguments": "{}"}}
            ]}),
            json!({"role": "tool", "tool_call_id": "a", "content": "ok"}),
        ];
        let d = dangling_tool_call_ids(&msgs);
        assert_eq!(d, vec!["b".to_string()]);
    }

    #[test]
    fn propose_summary_describes_changes() {
        let create = propose_summary("create_task", &json!({"title": "买菜"}), None);
        assert!(create.contains("买菜"));

        let cur = json!({"title": "写报告"});
        let upd = propose_summary(
            "update_task",
            &json!({"deadline": null, "star_rating": 5}),
            Some(&cur),
        );
        assert!(upd.contains("写报告"));
        assert!(upd.contains("清空截止时间"));
        assert!(upd.contains("星级→5"));

        let del = propose_summary("delete_task", &json!({"id": "x"}), Some(&cur));
        assert!(del.contains("写报告"));
        assert!(del.contains("回收站"));
    }

    #[test]
    fn parse_dt_handles_null_and_iso() {
        assert!(parse_dt(Some(&Value::Null)).is_none());
        assert!(parse_dt(Some(&json!(""))).is_none());
        assert!(parse_dt(None).is_none());
        assert!(parse_dt(Some(&json!("2026-07-01T18:00:00+08:00"))).is_some());
        // 纯日期 / "日期 时:分" 也应被接受（按北京时区解释）
        assert!(parse_dt(Some(&json!("2026-07-10"))).is_some());
        assert!(parse_dt(Some(&json!("2026-07-10 09:30"))).is_some());
        assert!(parse_dt_str("not-a-date").is_none());
    }

    #[test]
    fn resolve_date_update_three_states() {
        // 显式 null / 空串 → 清空
        assert!(matches!(resolve_date_update(&Value::Null), DateUpdate::Clear));
        assert!(matches!(resolve_date_update(&json!("  ")), DateUpdate::Clear));
        // 可解析 → 设置
        assert!(matches!(resolve_date_update(&json!("2026-07-10")), DateUpdate::Set(_)));
        // 不可解析的非空字符串 → 保持（绝不误清空）
        assert!(matches!(resolve_date_update(&json!("下周三")), DateUpdate::Leave));
    }
}
