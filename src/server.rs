use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::{Datelike, Duration, Local, NaiveDateTime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, io::Write, path::PathBuf, sync::Arc};
use tokio::sync::RwLock;
use tower_http::services::ServeDir;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::read::ZipArchive;

// ─── 数据模型 ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Task {
    id: String,
    title: String,
    description: String,
    completed: bool,
    category: String,
    star_rating: u8,
    #[serde(default)]
    start_date: String,
    #[serde(default)]
    deadline: String,
    created_at: String,
    #[serde(default)]
    completed_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct RecycleBinItem {
    task: Task,
    deleted_at: String,
}

#[derive(Debug, Deserialize)]
struct RegisterRequest {
    phone: String,
    password: String,
}

#[derive(Debug, Deserialize)]
struct LoginRequest {
    phone: String,
    password: String,
}

#[derive(Debug, Deserialize)]
struct CreateTaskRequest {
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_category")]
    category: String,
    #[serde(default)]
    star_rating: u8,
    #[serde(default)]
    start_date: String,
    #[serde(default)]
    deadline: String,
}

#[derive(Debug, Deserialize)]
struct UpdateTaskRequest {
    title: Option<String>,
    description: Option<String>,
    category: Option<String>,
    star_rating: Option<u8>,
    start_date: Option<String>,
    deadline: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TaskTemplate {
    id: String,
    title: String,
    description: String,
    category: String,
    star_rating: u8,
    frequency: String,        // "monthly", "weekly", "daily"
    generate_day: u8,         // 月：1-31，周：1-7（周一到周日），日：0
    generate_time: String,    // "09:00"
    deadline_day: u8,         // 同上
    deadline_time: String,    // "18:00"
    created_at: String,
    last_generated: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateTemplateRequest {
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_category")]
    category: String,
    #[serde(default)]
    star_rating: u8,
    frequency: String,
    #[serde(default)]
    generate_day: u8,
    #[serde(default = "default_generate_time")]
    generate_time: String,
    #[serde(default)]
    deadline_day: u8,
    #[serde(default = "default_deadline_time")]
    deadline_time: String,
}

#[derive(Debug, Deserialize)]
struct UpdateTemplateRequest {
    title: Option<String>,
    description: Option<String>,
    category: Option<String>,
    star_rating: Option<u8>,
    frequency: Option<String>,
    generate_day: Option<u8>,
    generate_time: Option<String>,
    deadline_day: Option<u8>,
    deadline_time: Option<String>,
}

fn default_generate_time() -> String { "09:00".to_string() }
fn default_deadline_time() -> String { "18:00".to_string() }

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CheckinData {
    last_checkin_date: String,
    current_streak: u32,
    max_streak: u32,
}

impl Default for CheckinData {
    fn default() -> Self {
        Self {
            last_checkin_date: String::new(),
            current_streak: 0,
            max_streak: 0,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    sort_by: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    search: String,
    #[serde(default = "default_page")]
    page: u32,
    #[serde(default = "default_per_page")]
    per_page: u32,
}

fn default_category() -> String { "其他".to_string() }
fn default_page() -> u32 { 1 }
fn default_per_page() -> u32 { 3 }

#[derive(Debug, Serialize)]
struct ApiResponse {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

#[derive(Debug, Serialize)]
struct PagedData {
    items: Vec<Task>,
    total: u32,
    page: u32,
    per_page: u32,
    total_pages: u32,
}

fn ok(message: &str, data: impl Serialize) -> Json<ApiResponse> {
    Json(ApiResponse {
        success: true,
        message: message.to_string(),
        data: Some(serde_json::to_value(data).unwrap_or(Value::Null)),
    })
}

fn err(message: &str) -> Json<ApiResponse> {
    Json(ApiResponse {
        success: false,
        message: message.to_string(),
        data: None,
    })
}

// ─── 应用状态 ───────────────────────────────────────────────

struct AppState {
    sessions: RwLock<HashMap<String, String>>,
    users_file: PathBuf,
    data_dir: PathBuf,
}

impl AppState {
    fn new() -> Self {
        let data_dir = PathBuf::from("data");
        if !data_dir.exists() {
            fs::create_dir_all(&data_dir).expect("无法创建 data 目录");
        }
        Self {
            sessions: RwLock::new(HashMap::new()),
            users_file: PathBuf::from("users.json"),
            data_dir,
        }
    }

    fn read_users(&self) -> HashMap<String, String> {
        if self.users_file.exists() {
            let content = fs::read_to_string(&self.users_file).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        }
    }

    fn write_users(&self, users: &HashMap<String, String>) -> Result<(), String> {
        let json = serde_json::to_string_pretty(users).map_err(|e| e.to_string())?;
        fs::write(&self.users_file, json).map_err(|e| e.to_string())
    }

    fn user_tasks_path(&self, phone: &str) -> PathBuf {
        self.data_dir.join(format!("{phone}.json"))
    }

    fn read_tasks(&self, phone: &str) -> Vec<Task> {
        let path = self.user_tasks_path(phone);
        if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    }

    fn write_tasks(&self, phone: &str, tasks: &[Task]) -> Result<(), String> {
        let path = self.user_tasks_path(phone);
        let json = serde_json::to_string_pretty(tasks).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    fn templates_path(&self, phone: &str) -> PathBuf {
        self.data_dir.join(format!("{phone}_templates.json"))
    }

    fn read_templates(&self, phone: &str) -> Vec<TaskTemplate> {
        let path = self.templates_path(phone);
        if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    }

    fn write_templates(&self, phone: &str, templates: &[TaskTemplate]) -> Result<(), String> {
        let path = self.templates_path(phone);
        let json = serde_json::to_string_pretty(templates).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    fn checkin_path(&self, phone: &str) -> PathBuf {
        self.data_dir.join(format!("{phone}_checkin.json"))
    }

    fn read_checkin(&self, phone: &str) -> CheckinData {
        let path = self.checkin_path(phone);
        if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            CheckinData::default()
        }
    }

    fn write_checkin(&self, phone: &str, data: &CheckinData) -> Result<(), String> {
        let path = self.checkin_path(phone);
        let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    fn recycle_bin_path(&self, phone: &str) -> PathBuf {
        self.data_dir.join(format!("{phone}_recycle.json"))
    }

    fn read_recycle_bin(&self, phone: &str) -> Vec<RecycleBinItem> {
        let path = self.recycle_bin_path(phone);
        if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    }

    fn write_recycle_bin(&self, phone: &str, items: &[RecycleBinItem]) -> Result<(), String> {
        let path = self.recycle_bin_path(phone);
        let json = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }
}

// ─── 辅助函数 ───────────────────────────────────────────────

fn hash_password(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn validate_phone(phone: &str) -> bool {
    phone.len() == 11 && phone.chars().all(|c| c.is_ascii_digit())
}

async fn get_session_phone(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<String, (StatusCode, Json<ApiResponse>)> {
    let session_id = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, err("未登录，请先登录")))?;
    let sessions = state.sessions.read().await;
    sessions
        .get(session_id)
        .cloned()
        .ok_or((StatusCode::UNAUTHORIZED, err("登录已过期，请重新登录")))
}

/// 截止日期在1天内的未完成任务，自动升级为5星
fn auto_upgrade_star(tasks: &mut Vec<Task>) -> bool {
    let now = Local::now();
    let mut changed = false;
    for t in tasks.iter_mut() {
        if t.completed || t.star_rating >= 5 || t.deadline.is_empty() {
            continue;
        }
        if let Ok(dl) = NaiveDateTime::parse_from_str(&t.deadline, "%Y-%m-%dT%H:%M") {
            let dl_local = dl - Duration::hours(8);
            if dl_local <= (now + Duration::hours(24)).naive_local() && dl_local >= now.naive_local() - Duration::hours(1) {
                t.star_rating = 5;
                changed = true;
            }
        } else if let Ok(dl_date) = chrono::NaiveDate::parse_from_str(&t.deadline, "%Y-%m-%d") {
            if dl_date <= (now + Duration::hours(24)).date_naive() && dl_date >= now.date_naive() - Duration::days(1) {
                t.star_rating = 5;
                changed = true;
            }
        }
    }
    changed
}

// ─── 用户认证 ───────────────────────────────────────────────

async fn register(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    let phone = req.phone.trim().to_string();
    let password = req.password.trim().to_string();
    if !validate_phone(&phone) {
        return (StatusCode::BAD_REQUEST, err("手机号必须为11位数字"));
    }
    if password.len() < 6 {
        return (StatusCode::BAD_REQUEST, err("密码长度不能低于6位"));
    }
    let mut users = state.read_users();
    if users.contains_key(&phone) {
        return (StatusCode::CONFLICT, err("该手机号已被注册"));
    }
    users.insert(phone, hash_password(&password));
    match state.write_users(&users) {
        Ok(_) => (StatusCode::OK, ok("注册成功", ())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("注册失败: {e}"))),
    }
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginRequest>,
) -> impl IntoResponse {
    let phone = req.phone.trim().to_string();
    let password = req.password.trim().to_string();

    // 验证手机号格式
    if !validate_phone(&phone) {
        return (StatusCode::BAD_REQUEST, err("手机号格式错误，应为11位数字"));
    }

    let users = state.read_users();
    let stored_hash = match users.get(&phone) {
        Some(h) => h.clone(),
        None => return (StatusCode::UNAUTHORIZED, err("该手机号未注册")),
    };
    if stored_hash != hash_password(&password) {
        return (StatusCode::UNAUTHORIZED, err("密码错误"));
    }
    let session_id = Uuid::new_v4().to_string();
    state.sessions.write().await.insert(session_id.clone(), phone);
    (StatusCode::OK, ok("登录成功", session_id))
}

async fn logout(headers: HeaderMap, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    if let Some(sid) = headers.get("x-session-id").and_then(|v| v.to_str().ok()) {
        state.sessions.write().await.remove(sid);
    }
    (StatusCode::OK, ok("已退出登录", ()))
}

async fn check_session(headers: HeaderMap, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match get_session_phone(&headers, &state).await {
        Ok(phone) => (StatusCode::OK, ok("已登录", phone)),
        Err((s, r)) => (s, r),
    }
}

// ─── 任务管理 ───────────────────────────────────────────────

async fn list_tasks(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };

    let mut tasks = state.read_tasks(&phone);

    // 自动升级截止临近任务
    let upgraded = auto_upgrade_star(&mut tasks);
    if upgraded {
        let _ = state.write_tasks(&phone, &tasks);
    }

    // 搜索过滤
    if !q.search.is_empty() {
        let kw = q.search.to_lowercase();
        tasks.retain(|t| t.title.to_lowercase().contains(&kw) || t.description.to_lowercase().contains(&kw));
    }

    // 分类过滤
    if !q.category.is_empty() && q.category != "全部" {
        tasks.retain(|t| t.category == q.category);
    }

    // 排序
    match q.sort_by.as_str() {
        "deadline" => {
            tasks.sort_by(|a, b| {
                let da = if a.deadline.is_empty() { "9999".to_string() } else { a.deadline.clone() };
                let db = if b.deadline.is_empty() { "9999".to_string() } else { b.deadline.clone() };
                da.cmp(&db)
            });
        }
        "importance" => {
            tasks.sort_by(|a, b| {
                b.star_rating.cmp(&a.star_rating)
                    .then(a.deadline.cmp(&b.deadline))
            });
        }
        _ => {
            // 默认：最近创建
            tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        }
    }

    let total = tasks.len() as u32;
    let per_page = q.per_page.max(1);
    let total_pages = if total == 0 { 1 } else { (total + per_page - 1) / per_page };
    let page = q.page.max(1).min(total_pages);
    let start = ((page - 1) * per_page) as usize;
    let end = (start + per_page as usize).min(tasks.len());
    let items = if start < tasks.len() { tasks[start..end].to_vec() } else { vec![] };

    (StatusCode::OK, ok("获取成功", PagedData { items, total, page, per_page, total_pages }))
}

async fn create_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTaskRequest>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let title = req.title.trim().to_string();
    if title.is_empty() {
        return (StatusCode::BAD_REQUEST, err("任务标题不能为空"));
    }
    let category = if req.category.is_empty() { "其他".to_string() } else { req.category };
    let star_rating = req.star_rating.min(5);

    let task = Task {
        id: Uuid::new_v4().to_string(),
        title,
        description: req.description.trim().to_string(),
        completed: false,
        category,
        star_rating,
        start_date: req.start_date,
        deadline: req.deadline,
        created_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        completed_at: String::new(),
    };

    let mut tasks = state.read_tasks(&phone);
    tasks.push(task.clone());
    match state.write_tasks(&phone, &tasks) {
        Ok(_) => (StatusCode::CREATED, ok("任务创建成功", task)),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("创建失败: {e}"))),
    }
}

async fn update_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<String>,
    Json(req): Json<UpdateTaskRequest>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let mut tasks = state.read_tasks(&phone);
    let task = match tasks.iter_mut().find(|t| t.id == task_id) {
        Some(t) => t,
        None => return (StatusCode::NOT_FOUND, err("任务不存在")),
    };
    if let Some(title) = req.title {
        let title = title.trim().to_string();
        if title.is_empty() { return (StatusCode::BAD_REQUEST, err("任务标题不能为空")); }
        task.title = title;
    }
    if let Some(desc) = req.description { task.description = desc.trim().to_string(); }
    if let Some(c) = req.category { task.category = c; }
    if let Some(s) = req.star_rating { task.star_rating = s.min(5); }
    if let Some(sd) = req.start_date { task.start_date = sd; }
    if let Some(dl) = req.deadline { task.deadline = dl; }
    let updated = task.clone();
    match state.write_tasks(&phone, &tasks) {
        Ok(_) => (StatusCode::OK, ok("任务更新成功", updated)),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("更新失败: {e}"))),
    }
}

async fn toggle_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<String>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let mut tasks = state.read_tasks(&phone);
    let task = match tasks.iter_mut().find(|t| t.id == task_id) {
        Some(t) => t,
        None => return (StatusCode::NOT_FOUND, err("任务不存在")),
    };
    task.completed = !task.completed;
    // 记录完成时间
    if task.completed {
        task.completed_at = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    } else {
        task.completed_at = String::new();
    }
    let updated = task.clone();
    match state.write_tasks(&phone, &tasks) {
        Ok(_) => {
            let label = if updated.completed { "已完成" } else { "已重新打开" };
            (StatusCode::OK, ok(&format!("任务{label}"), updated))
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("操作失败: {e}"))),
    }
}

async fn delete_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<String>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let mut tasks = state.read_tasks(&phone);
    let task_index = tasks.iter().position(|t| t.id == task_id);
    let task = match task_index {
        Some(idx) => tasks.remove(idx),
        None => return (StatusCode::NOT_FOUND, err("任务不存在")),
    };

    // 移动到回收站
    let mut recycle_bin = state.read_recycle_bin(&phone);
    recycle_bin.insert(0, RecycleBinItem {
        task,
        deleted_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    });

    // 保留最近100条
    if recycle_bin.len() > 100 {
        recycle_bin.truncate(100);
    }

    match state.write_recycle_bin(&phone, &recycle_bin) {
        Ok(_) => match state.write_tasks(&phone, &tasks) {
            Ok(_) => (StatusCode::OK, ok("任务已移到回收站", ())),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("删除失败: {e}"))),
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("删除失败: {e}"))),
    }
}

#[derive(Debug, Deserialize)]
struct BatchDeleteRequest {
    task_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ClearTasksRequest {
    status: String, // "pending", "completed", "expired"
}

async fn batch_delete_tasks(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Json(req): Json<BatchDeleteRequest>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };

    if req.task_ids.is_empty() {
        return (StatusCode::BAD_REQUEST, err("请选择要删除的任务"));
    }

    let mut tasks = state.read_tasks(&phone);
    let mut recycle_bin = state.read_recycle_bin(&phone);
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut deleted_count = 0;

    // 找到并移除指定的任务
    let mut to_remove = Vec::new();
    for (idx, task) in tasks.iter().enumerate() {
        if req.task_ids.contains(&task.id) {
            to_remove.push(idx);
        }
    }

    // 从后往前删除，避免索引问题
    for idx in to_remove.into_iter().rev() {
        let task = tasks.remove(idx);
        recycle_bin.insert(0, RecycleBinItem {
            task,
            deleted_at: now.clone(),
        });
        deleted_count += 1;
    }

    // 保留最近100条
    if recycle_bin.len() > 100 {
        recycle_bin.truncate(100);
    }

    match state.write_recycle_bin(&phone, &recycle_bin) {
        Ok(_) => match state.write_tasks(&phone, &tasks) {
            Ok(_) => (StatusCode::OK, ok(&format!("已删除{}个任务", deleted_count), ())),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("删除失败: {e}"))),
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("删除失败: {e}"))),
    }
}

async fn clear_tasks(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Query(req): Query<ClearTasksRequest>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };

    let mut tasks = state.read_tasks(&phone);
    let mut recycle_bin = state.read_recycle_bin(&phone);
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let now_naive = Local::now().naive_local();

    // 根据状态筛选要删除的任务
    let mut to_remove = Vec::new();
    for (idx, task) in tasks.iter().enumerate() {
        let should_delete = match req.status.as_str() {
            "pending" => !task.completed && !is_task_expired(task, now_naive),
            "completed" => task.completed,
            "expired" => !task.completed && is_task_expired(task, now_naive),
            _ => false,
        };
        if should_delete {
            to_remove.push(idx);
        }
    }

    let deleted_count = to_remove.len();

    // 从后往前删除
    for idx in to_remove.into_iter().rev() {
        let task = tasks.remove(idx);
        recycle_bin.insert(0, RecycleBinItem {
            task,
            deleted_at: now.clone(),
        });
    }

    // 保留最近100条
    if recycle_bin.len() > 100 {
        recycle_bin.truncate(100);
    }

    match state.write_recycle_bin(&phone, &recycle_bin) {
        Ok(_) => match state.write_tasks(&phone, &tasks) {
            Ok(_) => (StatusCode::OK, ok(&format!("已清空{}个任务", deleted_count), ())),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("清空失败: {e}"))),
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("清空失败: {e}"))),
    }
}

fn is_task_expired(task: &Task, now: chrono::NaiveDateTime) -> bool {
    if task.deadline.is_empty() {
        return false;
    }
    if let Ok(dl) = NaiveDateTime::parse_from_str(&task.deadline, "%Y-%m-%dT%H:%M") {
        let dl_local = dl - Duration::hours(8);
        dl_local < now
    } else if let Ok(dl_date) = chrono::NaiveDate::parse_from_str(&task.deadline, "%Y-%m-%d") {
        dl_date < now.date()
    } else {
        false
    }
}

async fn list_recycle_bin(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let recycle_bin = state.read_recycle_bin(&phone);
    (StatusCode::OK, ok("获取成功", recycle_bin))
}

async fn restore_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<String>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let mut recycle_bin = state.read_recycle_bin(&phone);
    let item_index = recycle_bin.iter().position(|item| item.task.id == task_id);
    let item = match item_index {
        Some(idx) => recycle_bin.remove(idx),
        None => return (StatusCode::NOT_FOUND, err("任务不在回收站中")),
    };

    let mut restored_task = item.task;

    // 检查任务是否已过期（如果有截止日期且未完成）
    if !restored_task.deadline.is_empty() && !restored_task.completed {
        if let Ok(dl) = NaiveDateTime::parse_from_str(&restored_task.deadline, "%Y-%m-%dT%H:%M") {
            let dl_local = dl - Duration::hours(8);
            if dl_local < Local::now().naive_local() {
                // 任务已过期，保持原样，前端会将其显示在已过期区域
            }
        }
    }

    let mut tasks = state.read_tasks(&phone);
    tasks.insert(0, restored_task);

    match state.write_recycle_bin(&phone, &recycle_bin) {
        Ok(_) => match state.write_tasks(&phone, &tasks) {
            Ok(_) => (StatusCode::OK, ok("任务已恢复", ())),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("恢复失败: {e}"))),
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("恢复失败: {e}"))),
    }
}

async fn permanent_delete_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<String>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let mut recycle_bin = state.read_recycle_bin(&phone);
    let before = recycle_bin.len();
    recycle_bin.retain(|item| item.task.id != task_id);
    if recycle_bin.len() == before {
        return (StatusCode::NOT_FOUND, err("任务不在回收站中"));
    }
    match state.write_recycle_bin(&phone, &recycle_bin) {
        Ok(_) => (StatusCode::OK, ok("任务已永久删除", ())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("删除失败: {e}"))),
    }
}

async fn clear_recycle_bin(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    match state.write_recycle_bin(&phone, &[]) {
        Ok(_) => (StatusCode::OK, ok("回收站已清空", ())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("清空失败: {e}"))),
    }
}

// ─── 任务模板 ───────────────────────────────────────────────

async fn create_template(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTemplateRequest>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let title = req.title.trim().to_string();
    if title.is_empty() {
        return (StatusCode::BAD_REQUEST, err("任务标题不能为空"));
    }
    if !["monthly", "weekly", "daily"].contains(&req.frequency.as_str()) {
        return (StatusCode::BAD_REQUEST, err("频率必须为 monthly/weekly/daily"));
    }
    let template = TaskTemplate {
        id: Uuid::new_v4().to_string(),
        title,
        description: req.description.trim().to_string(),
        category: if req.category.is_empty() { "其他".to_string() } else { req.category },
        star_rating: req.star_rating.min(5),
        frequency: req.frequency,
        generate_day: req.generate_day,
        generate_time: req.generate_time,
        deadline_day: req.deadline_day,
        deadline_time: req.deadline_time,
        created_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        last_generated: None,
    };
    let mut templates = state.read_templates(&phone);
    templates.push(template.clone());
    match state.write_templates(&phone, &templates) {
        Ok(_) => (StatusCode::CREATED, ok("模板创建成功", template)),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("创建失败: {e}"))),
    }
}

async fn list_templates(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let templates = state.read_templates(&phone);
    (StatusCode::OK, ok("获取成功", templates))
}

async fn delete_template(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(template_id): Path<String>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let mut templates = state.read_templates(&phone);
    let before = templates.len();
    templates.retain(|t| t.id != template_id);
    if templates.len() == before {
        return (StatusCode::NOT_FOUND, err("模板不存在"));
    }
    match state.write_templates(&phone, &templates) {
        Ok(_) => (StatusCode::OK, ok("模板已删除", ())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("删除失败: {e}"))),
    }
}

async fn update_template(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(template_id): Path<String>,
    Json(req): Json<UpdateTemplateRequest>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let mut templates = state.read_templates(&phone);
    let template = match templates.iter_mut().find(|t| t.id == template_id) {
        Some(t) => t,
        None => return (StatusCode::NOT_FOUND, err("模板不存在")),
    };
    if let Some(title) = req.title {
        let title = title.trim().to_string();
        if title.is_empty() { return (StatusCode::BAD_REQUEST, err("模板标题不能为空")); }
        template.title = title;
    }
    if let Some(desc) = req.description { template.description = desc.trim().to_string(); }
    if let Some(c) = req.category { template.category = c; }
    if let Some(s) = req.star_rating { template.star_rating = s.min(5); }
    if let Some(f) = req.frequency {
        if !["monthly", "weekly", "daily"].contains(&f.as_str()) {
            return (StatusCode::BAD_REQUEST, err("频率必须为 monthly/weekly/daily"));
        }
        template.frequency = f;
    }
    if let Some(d) = req.generate_day { template.generate_day = d; }
    if let Some(t) = req.generate_time { template.generate_time = t; }
    if let Some(d) = req.deadline_day { template.deadline_day = d; }
    if let Some(t) = req.deadline_time { template.deadline_time = t; }
    let updated = template.clone();
    match state.write_templates(&phone, &templates) {
        Ok(_) => (StatusCode::OK, ok("模板更新成功", updated)),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("更新失败: {e}"))),
    }
}

/// 获取某月的最后一天
fn last_day_of_month(year: i32, month: u32) -> u32 {
    if month == 12 {
        31
    } else {
        NaiveDateTime::parse_from_str(
            &format!("{:04}-{:02}-01 00:00:00", year, month + 1),
            "%Y-%m-%d %H:%M:%S",
        )
        .map(|dt| (dt - Duration::days(1)).day())
        .unwrap_or(30)
    }
}

/// 将用户输入的1-7（周一到周日）转换为chrono::Weekday
fn weekday_from_day(day: u8) -> chrono::Weekday {
    match day {
        1 => chrono::Weekday::Mon,
        2 => chrono::Weekday::Tue,
        3 => chrono::Weekday::Wed,
        4 => chrono::Weekday::Thu,
        5 => chrono::Weekday::Fri,
        6 => chrono::Weekday::Sat,
        _ => chrono::Weekday::Sun, // 7 或其他
    }
}

/// 计算某个日期所在周的指定星期几的日期
fn weekday_of_same_week(base_date: chrono::NaiveDate, target_weekday: chrono::Weekday) -> chrono::NaiveDate {
    let base_weekday = base_date.weekday();
    let base_num = base_weekday.num_days_from_monday();
    let target_num = target_weekday.num_days_from_monday();
    let diff = target_num as i32 - base_num as i32;
    base_date + Duration::days(diff as i64)
}

async fn generate_tasks(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };

    let now = Local::now();
    let today = now.date_naive();

    let mut templates = state.read_templates(&phone);
    let mut tasks = state.read_tasks(&phone);
    let mut generated_count = 0;
    let mut changed = false;

    for tmpl in templates.iter_mut() {
        match tmpl.frequency.as_str() {
            "daily" => {
                let gen_date_str = today.format("%Y-%m-%d").to_string();
                let gen_datetime = format!("{} {}", gen_date_str, tmpl.generate_time);
                let should_generate = now.format("%Y-%m-%d %H:%M").to_string() >= gen_datetime
                    && tmpl.last_generated.as_deref() != Some(&gen_date_str);

                if should_generate {
                    let deadline = format!("{} {}", gen_date_str, tmpl.deadline_time);
                    let task = Task {
                        id: Uuid::new_v4().to_string(),
                        title: tmpl.title.clone(),
                        description: tmpl.description.clone(),
                        completed: false,
                        category: tmpl.category.clone(),
                        star_rating: tmpl.star_rating,
                        start_date: gen_datetime,
                        deadline,
                        created_at: now.format("%Y-%m-%d %H:%M:%S").to_string(),
                        completed_at: String::new(),
                    };
                    tasks.push(task);
                    tmpl.last_generated = Some(gen_date_str);
                    generated_count += 1;
                    changed = true;
                }
            }
            "weekly" => {
                let gen_weekday = weekday_from_day(tmpl.generate_day);
                let dl_weekday = weekday_from_day(tmpl.deadline_day);

                // 找到本周的生成日
                let gen_date = weekday_of_same_week(today, gen_weekday);
                // 如果截止日 < 生成日，截止日算下周
                let mut dl_date = weekday_of_same_week(today, dl_weekday);
                if dl_date <= gen_date {
                    dl_date = dl_date + Duration::weeks(1);
                }

                let gen_date_str = gen_date.format("%Y-%m-%d").to_string();
                let gen_datetime = format!("{} {}", gen_date_str, tmpl.generate_time);

                let should_generate = now.format("%Y-%m-%d %H:%M").to_string() >= gen_datetime
                    && tmpl.last_generated.as_deref() != Some(&gen_date_str);

                if should_generate {
                    let deadline = format!("{} {}", dl_date.format("%Y-%m-%d"), tmpl.deadline_time);
                    let task = Task {
                        id: Uuid::new_v4().to_string(),
                        title: tmpl.title.clone(),
                        description: tmpl.description.clone(),
                        completed: false,
                        category: tmpl.category.clone(),
                        star_rating: tmpl.star_rating,
                        start_date: gen_datetime,
                        deadline,
                        created_at: now.format("%Y-%m-%d %H:%M:%S").to_string(),
                        completed_at: String::new(),
                    };
                    tasks.push(task);
                    tmpl.last_generated = Some(gen_date_str);
                    generated_count += 1;
                    changed = true;
                }
            }
            "monthly" => {
                let year = today.year();
                let month = today.month();

                // 调整生成日（如果当月没有那么多天）
                let max_day = last_day_of_month(year, month) as u8;
                let gen_day = tmpl.generate_day.min(max_day);
                let dl_max_day = last_day_of_month(year, month) as u8;
                let dl_day = tmpl.deadline_day.min(dl_max_day);

                // 如果截止日 < 生成日，本月不生成
                if dl_day < gen_day {
                    continue;
                }

                let gen_date = chrono::NaiveDate::from_ymd_opt(year, month, gen_day as u32).unwrap_or(today);
                let gen_date_str = gen_date.format("%Y-%m-%d").to_string();
                let gen_datetime = format!("{} {}", gen_date_str, tmpl.generate_time);

                let should_generate = now.format("%Y-%m-%d %H:%M").to_string() >= gen_datetime
                    && tmpl.last_generated.as_deref() != Some(&gen_date_str);

                if should_generate {
                    let dl_date = chrono::NaiveDate::from_ymd_opt(year, month, dl_day as u32).unwrap_or(today);
                    let deadline = format!("{} {}", dl_date.format("%Y-%m-%d"), tmpl.deadline_time);
                    let task = Task {
                        id: Uuid::new_v4().to_string(),
                        title: tmpl.title.clone(),
                        description: tmpl.description.clone(),
                        completed: false,
                        category: tmpl.category.clone(),
                        star_rating: tmpl.star_rating,
                        start_date: gen_datetime,
                        deadline,
                        created_at: now.format("%Y-%m-%d %H:%M:%S").to_string(),
                        completed_at: String::new(),
                    };
                    tasks.push(task);
                    tmpl.last_generated = Some(gen_date_str);
                    generated_count += 1;
                    changed = true;
                }
            }
            _ => {}
        }
    }

    if changed {
        let _ = state.write_templates(&phone, &templates);
        let _ = state.write_tasks(&phone, &tasks);
    }

    (StatusCode::OK, ok(&format!("生成了{}个任务", generated_count), generated_count))
}

// ─── 每日打卡 ───────────────────────────────────────────────

async fn checkin_status(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let data = state.read_checkin(&phone);
    let today = Local::now().format("%Y-%m-%d").to_string();
    let checked_in_today = data.last_checkin_date == today;
    (StatusCode::OK, ok("获取成功", serde_json::json!({
        "current_streak": data.current_streak,
        "max_streak": data.max_streak,
        "checked_in_today": checked_in_today
    })))
}

async fn checkin(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let today = Local::now().format("%Y-%m-%d").to_string();
    let yesterday = (Local::now() - Duration::days(1)).format("%Y-%m-%d").to_string();

    let mut data = state.read_checkin(&phone);

    if data.last_checkin_date == today {
        return (StatusCode::BAD_REQUEST, err("今日已签到"));
    }

    if data.last_checkin_date == yesterday {
        // 连续签到
        data.current_streak += 1;
    } else {
        // 断签，重新开始
        data.current_streak = 1;
    }

    if data.current_streak > data.max_streak {
        data.max_streak = data.current_streak;
    }

    data.last_checkin_date = today;

    match state.write_checkin(&phone, &data) {
        Ok(_) => (StatusCode::OK, ok("签到成功", serde_json::json!({
            "current_streak": data.current_streak,
            "max_streak": data.max_streak
        }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("签到失败: {e}"))),
    }
}

// ─── 用户中心 ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ChangePasswordRequest {
    old_password: String,
    new_password: String,
}

async fn get_user_profile(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    (StatusCode::OK, ok("获取成功", serde_json::json!({ "phone": phone })))
}

async fn change_password(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Json(req): Json<ChangePasswordRequest>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };

    let new_password = req.new_password.trim().to_string();
    if new_password.len() < 6 {
        return (StatusCode::BAD_REQUEST, err("新密码长度不能低于6位"));
    }

    let mut users = state.read_users();
    let stored_hash = match users.get(&phone) {
        Some(h) => h.clone(),
        None => return (StatusCode::NOT_FOUND, err("用户不存在")),
    };

    if stored_hash != hash_password(&req.old_password) {
        return (StatusCode::BAD_REQUEST, err("原密码错误"));
    }

    users.insert(phone.clone(), hash_password(&new_password));
    match state.write_users(&users) {
        Ok(_) => (StatusCode::OK, ok("密码修改成功", ())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("修改失败: {e}"))),
    }
}

async fn get_user_stats(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };

    let tasks = state.read_tasks(&phone);
    let now = Local::now();
    let now_naive = now.naive_local();

    // 统计任务状态
    let total = tasks.len();
    let completed = tasks.iter().filter(|t| t.completed).count();
    let expired = tasks.iter().filter(|t| {
        if t.completed || t.deadline.is_empty() {
            return false;
        }
        if let Ok(dl) = NaiveDateTime::parse_from_str(&t.deadline, "%Y-%m-%dT%H:%M") {
            let dl_local = dl - Duration::hours(8);
            dl_local < now_naive
        } else if let Ok(dl_date) = chrono::NaiveDate::parse_from_str(&t.deadline, "%Y-%m-%d") {
            dl_date < now.date_naive()
        } else {
            false
        }
    }).count();
    let pending = total - completed - expired;

    // 统计每月完成量（最近12个月）
    let mut monthly_completed: HashMap<String, u32> = HashMap::new();
    // 初始化最近12个月
    for i in 0..12 {
        let month = (now - Duration::days(30 * i)).format("%Y-%m").to_string();
        monthly_completed.insert(month, 0);
    }
    // 统计已完成任务（使用 completed_at 字段）
    for task in &tasks {
        if task.completed && !task.completed_at.is_empty() {
            if let Ok(completed) = NaiveDateTime::parse_from_str(&task.completed_at, "%Y-%m-%dT%H:%M:%S") {
                let month = completed.format("%Y-%m").to_string();
                if let Some(count) = monthly_completed.get_mut(&month) {
                    *count += 1;
                }
            }
        }
    }

    // 转换为有序数组
    let mut monthly_data: Vec<(String, u32)> = monthly_completed.into_iter().collect();
    monthly_data.sort_by(|a, b| a.0.cmp(&b.0));

    (StatusCode::OK, ok("获取成功", serde_json::json!({
        "total": total,
        "completed": completed,
        "pending": pending,
        "expired": expired,
        "monthly_completed": monthly_data
    })))
}

// ─── 数据导出 ───────────────────────────────────────────────

async fn export_data(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    // 验证登录
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r).into_response(),
    };

    // 收集该用户的所有相关文件
    let files_to_export = vec![
        state.user_tasks_path(&phone),
        state.templates_path(&phone),
        state.checkin_path(&phone),
    ];

    let mut zip_buf = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut zip_buf);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for file_path in &files_to_export {
            if file_path.exists() {
                let file_name = file_path.file_name().unwrap().to_str().unwrap();
                if let Ok(content) = fs::read(file_path) {
                    let _ = zip.start_file(format!("data/{}", file_name), options);
                    let _ = zip.write_all(&content);
                }
            }
        }

        // 也导出users.json中该用户的记录
        let users = state.read_users();
        if let Some(hash) = users.get(&phone) {
            let user_data = serde_json::json!({ phone: hash });
            let _ = zip.start_file("users.json", options);
            let _ = zip.write_all(user_data.to_string().as_bytes());
        }

        let _ = zip.finish();
    }

    let zip_bytes = zip_buf.into_inner();
    let filename = format!("taskflow_backup_{}.zip", Local::now().format("%Y%m%d_%H%M%S"));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", filename))
        .body(Body::from(zip_bytes))
        .unwrap()
}

// ─── 数据导入 ───────────────────────────────────────────────

async fn import_data(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // 验证登录
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };

    // 获取上传的文件
    let mut zip_data: Option<Vec<u8>> = None;
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        if let Some(name) = field.name() {
            if name == "file" {
                if let Ok(data) = field.bytes().await {
                    zip_data = Some(data.to_vec());
                }
            }
        }
    }

    let zip_data = match zip_data {
        Some(d) => d,
        None => return (StatusCode::BAD_REQUEST, err("未找到上传文件")),
    };

    // 解压并合并数据
    let cursor = std::io::Cursor::new(zip_data);
    let mut archive = match ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return (StatusCode::BAD_REQUEST, err("无效的zip文件")),
    };

    let mut imported_tasks = false;
    let mut imported_templates = false;
    let mut imported_checkin = false;

    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };

        let name = file.name().to_string();
        let mut content = Vec::new();
        if std::io::Read::read_to_end(&mut file, &mut content).is_err() {
            continue;
        }

        if name.ends_with("_templates.json") || name.contains("templates") {
            // 合并模板
            if let Ok(imported) = serde_json::from_slice::<Vec<TaskTemplate>>(&content) {
                let mut existing = state.read_templates(&phone);
                for tmpl in imported {
                    if !existing.iter().any(|t| t.id == tmpl.id) {
                        existing.push(tmpl);
                    }
                }
                let _ = state.write_templates(&phone, &existing);
                imported_templates = true;
            }
        } else if name.ends_with("_checkin.json") || name.contains("checkin") {
            // 合并签到数据（取较新的）
            if let Ok(imported) = serde_json::from_slice::<CheckinData>(&content) {
                let mut existing = state.read_checkin(&phone);
                if imported.last_checkin_date > existing.last_checkin_date {
                    existing.last_checkin_date = imported.last_checkin_date;
                }
                if imported.max_streak > existing.max_streak {
                    existing.max_streak = imported.max_streak;
                }
                if imported.current_streak > existing.current_streak {
                    existing.current_streak = imported.current_streak;
                }
                let _ = state.write_checkin(&phone, &existing);
                imported_checkin = true;
            }
        } else if name.ends_with(".json") && !name.contains("users") {
            // 合并任务
            if let Ok(imported) = serde_json::from_slice::<Vec<Task>>(&content) {
                let mut existing = state.read_tasks(&phone);
                for task in imported {
                    if !existing.iter().any(|t| t.id == task.id) {
                        existing.push(task);
                    }
                }
                let _ = state.write_tasks(&phone, &existing);
                imported_tasks = true;
            }
        }
    }

    let mut msg = String::from("导入完成：");
    if imported_tasks { msg.push_str("任务 "); }
    if imported_templates { msg.push_str("模板 "); }
    if imported_checkin { msg.push_str("签到 "); }
    if !imported_tasks && !imported_templates && !imported_checkin {
        msg = "未找到可导入的数据".to_string();
    }

    (StatusCode::OK, ok(&msg, ()))
}

// ─── 主函数 ─────────────────────────────────────────────────

pub async fn run_server() {
    let state = Arc::new(AppState::new());

    let api_routes = Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/session", get(check_session))
        .route("/tasks", get(list_tasks).post(create_task))
        .route("/tasks/{id}", put(update_task).delete(delete_task))
        .route("/tasks/{id}/toggle", post(toggle_task))
        .route("/tasks/batch-delete", post(batch_delete_tasks))
        .route("/tasks/clear", delete(clear_tasks))
        .route("/templates", get(list_templates).post(create_template))
        .route("/templates/{id}", put(update_template).delete(delete_template))
        .route("/templates/generate", post(generate_tasks))
        .route("/recycle", get(list_recycle_bin).delete(clear_recycle_bin))
        .route("/recycle/{id}/restore", post(restore_task))
        .route("/recycle/{id}", delete(permanent_delete_task))
        .route("/checkin", post(checkin))
        .route("/checkin/status", get(checkin_status))
        .route("/user/profile", get(get_user_profile))
        .route("/user/password", put(change_password))
        .route("/user/stats", get(get_user_stats))
        .route("/export", get(export_data))
        .route("/import", post(import_data));

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(ServeDir::new("static"))
        .with_state(state);

    let port = 8080;
    println!("========================================");
    println!("  TaskFlow - 多用户局域网任务管理工具");
    println!("========================================");
    println!("  服务已启动！");
    println!();
    println!("  请在浏览器中访问:");
    println!("  http://localhost:{port}");
    println!();
    println!("  局域网内其他设备访问:");
    println!("  http://<你的IP>:{port}");
    println!("========================================");

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .expect("无法绑定端口");
    axum::serve(listener, app).await.expect("服务器启动失败");
}

// 独立运行时的入口
#[tokio::main]
async fn main() {
    run_server().await;
}
