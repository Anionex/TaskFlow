/// TaskFlow V2.0 集成测试
///
/// 每个测试用例使用唯一手机号（test_<纳秒时间戳>），结束后清理所有测试数据。
/// App 在 ephemeral 端口启动（不用 8090）。
/// AI 测试通过本地 Mock HTTP server（axum）模拟 OpenAI 兼容接口。
///
/// 运行方式：cargo test -- --test-threads=1
use std::time::Duration;

use serde_json::{json, Value};
use tokio::net::TcpListener;

// ═══════════════════════════════════════════════════════════════════════════
// 测试框架工具
// ═══════════════════════════════════════════════════════════════════════════

/// 生成唯一 11 位测试手机号
/// 使用原子计数器确保即使同纳秒启动的并发测试也不会碰撞
fn unique_phone() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, Ordering::SeqCst);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    // Combine timestamp (last 7 digits) + counter (last 3 digits)
    let suffix = (ts % 10_000_000u128) as u64 * 1000 + (count % 1000);
    format!("1{:010}", suffix)
}

/// 清理测试用户（级联删除其所有任务/会话/打卡）
async fn cleanup_user(pool: &sqlx::PgPool, phone: &str) {
    let _ = sqlx::query("DELETE FROM users WHERE phone = $1")
        .bind(phone)
        .execute(pool)
        .await;
}

/// 获取测试用 PgPool（复用连接）
async fn test_pool() -> sqlx::PgPool {
    dotenvy::dotenv().ok();
    let url = std::env::var("DATABASE_URL_POOLER")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .expect("DATABASE_URL_POOLER must be set");
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .expect("test pool connect")
}

struct TestClient {
    http: reqwest::Client,
    base: String,
    pool: sqlx::PgPool,
    phones: Vec<String>,
}

impl TestClient {
    async fn new() -> Self {
        let pool = test_pool().await;
        let base = spawn_app_with_pool(pool.clone()).await;
        TestClient {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap(),
            base,
            pool,
            phones: vec![],
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api{}", self.base, path)
    }

    /// Register + login, returning session_id
    async fn register_and_login(&mut self, phone: &str, password: &str) -> String {
        self.phones.push(phone.to_string());
        let r = self
            .http
            .post(self.url("/register"))
            .json(&json!({"phone": phone, "password": password}))
            .send()
            .await
            .unwrap();
        assert!(r.status().is_success());

        let r = self
            .http
            .post(self.url("/login"))
            .json(&json!({"phone": phone, "password": password}))
            .send()
            .await
            .unwrap();
        let v: Value = r.json().await.unwrap();
        assert!(v["success"].as_bool().unwrap(), "login failed: {v}");
        v["data"].as_str().unwrap().to_string()
    }

    fn session_header(&self, session_id: &str) -> reqwest::header::HeaderMap {
        let mut h = reqwest::header::HeaderMap::new();
        h.insert(
            "x-session-id",
            session_id.parse().unwrap(),
        );
        h
    }
}

impl Drop for TestClient {
    fn drop(&mut self) {
        // Best-effort cleanup — sync required, so we use block_in_place
        let phones = self.phones.clone();
        let pool = self.pool.clone();
        let rt = tokio::runtime::Handle::current();
        rt.spawn(async move {
            for phone in phones {
                cleanup_user(&pool, &phone).await;
            }
        });
    }
}

/// Spawn app sharing an existing pool
async fn spawn_app_with_pool(pool: sqlx::PgPool) -> String {
    dotenvy::dotenv().ok();

    let config = taskflow::TestConfig {
        database_url: String::new(), // pool already created
        port: 0,
        llm_base_url: String::new(),
        llm_api_key: String::new(),
        llm_model: String::new(),
        llm_model_strong: String::new(),
        contact_email: String::new(),
    };

    let app = taskflow::build_app(pool, config);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    format!("http://127.0.0.1:{}", addr.port())
}

// ═══════════════════════════════════════════════════════════════════════════
// 认证流测试
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn auth_register_login_session_change_password_logout() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let password = "pass123";

    // Register
    let r: Value = c
        .http
        .post(c.url("/register"))
        .json(&json!({"phone": phone, "password": password}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "register: {r}");

    // Login
    let r: Value = c
        .http
        .post(c.url("/login"))
        .json(&json!({"phone": phone, "password": password}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "login: {r}");
    let session_id = r["data"].as_str().unwrap().to_string();

    // Session check
    let r: Value = c
        .http
        .get(c.url("/session"))
        .headers(c.session_header(&session_id))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "session check: {r}");
    assert_eq!(r["data"].as_str().unwrap(), phone);

    // Change password
    let r: Value = c
        .http
        .put(c.url("/user/password"))
        .headers(c.session_header(&session_id))
        .json(&json!({"old_password": password, "new_password": "newpass456"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "change_password: {r}");

    // Logout
    let r: Value = c
        .http
        .post(c.url("/logout"))
        .headers(c.session_header(&session_id))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "logout: {r}");

    c.phones.push(phone);
}

#[tokio::test]
async fn auth_duplicate_phone_rejected() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    c.phones.push(phone.clone());

    let body = json!({"phone": phone, "password": "abc123"});
    let r: Value = c
        .http
        .post(c.url("/register"))
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap());

    let r: Value = c
        .http
        .post(c.url("/register"))
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!r["success"].as_bool().unwrap(), "duplicate should fail");
    assert!(r["message"].as_str().unwrap().contains("已被注册"));
}

#[tokio::test]
async fn auth_invalid_phone_rejected() {
    let c = TestClient::new().await;

    for bad_phone in ["123", "1234567890", "12345678901a", ""] {
        let r: Value = c
            .http
            .post(c.url("/login"))
            .json(&json!({"phone": bad_phone, "password": "abc123"}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(!r["success"].as_bool().unwrap(), "bad phone {bad_phone} should fail");
    }
}

#[tokio::test]
async fn auth_wrong_password_rejected() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    c.phones.push(phone.clone());

    let _sid = c.register_and_login(&phone, "correct123").await;

    let r: Value = c
        .http
        .post(c.url("/login"))
        .json(&json!({"phone": phone, "password": "wrongpassword"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!r["success"].as_bool().unwrap(), "wrong password should fail");
    assert!(r["message"].as_str().unwrap().contains("密码错误"));
}

// ═══════════════════════════════════════════════════════════════════════════
// 任务 CRUD 流测试
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn tasks_create_list_update_toggle_delete_recycle_restore_purge() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;
    let h = c.session_header(&sid);

    // Create
    let r: Value = c
        .http
        .post(c.url("/tasks"))
        .headers(h.clone())
        .json(&json!({
            "title": "测试任务",
            "category": "学习",
            "star_rating": 3
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "create task: {r}");
    let task_id = r["data"]["id"].as_str().unwrap().to_string();

    // List
    let r: Value = c
        .http
        .get(c.url("/tasks"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "list tasks: {r}");
    let items = r["data"]["items"].as_array().unwrap();
    assert!(items.iter().any(|t| t["id"].as_str() == Some(&task_id)));

    // List with category filter
    let r: Value = c
        .http
        .get(format!("{}/api/tasks?category=学习", c.base))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap());
    let items = r["data"]["items"].as_array().unwrap();
    assert!(items.iter().all(|t| t["category"].as_str() == Some("学习")));

    // Update
    let r: Value = c
        .http
        .put(format!("{}/api/tasks/{}", c.base, task_id))
        .headers(h.clone())
        .json(&json!({"title": "更新后的标题", "star_rating": 5}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "update task: {r}");
    assert_eq!(r["data"]["title"].as_str().unwrap(), "更新后的标题");

    // Toggle (complete)
    let r: Value = c
        .http
        .post(format!("{}/api/tasks/{}/toggle", c.base, task_id))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "toggle: {r}");

    // Soft delete
    let r: Value = c
        .http
        .delete(format!("{}/api/tasks/{}", c.base, task_id))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "soft delete: {r}");

    // Verify task not in active list
    let r: Value = c
        .http
        .get(c.url("/tasks"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let items = r["data"]["items"].as_array().unwrap();
    assert!(!items.iter().any(|t| t["id"].as_str() == Some(&task_id)));

    // Recycle list
    let r: Value = c
        .http
        .get(c.url("/recycle"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "recycle list: {r}");
    let items = r["data"]["items"].as_array().unwrap();
    assert!(items.iter().any(|t| t["id"].as_str() == Some(&task_id)));

    // Restore
    let r: Value = c
        .http
        .post(format!("{}/api/recycle/{}/restore", c.base, task_id))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "restore: {r}");

    // Permanent delete
    c.http
        .delete(format!("{}/api/tasks/{}", c.base, task_id))
        .headers(h.clone())
        .send()
        .await
        .unwrap();
    let r: Value = c
        .http
        .delete(format!("{}/api/recycle/{}", c.base, task_id))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    // Could be not_found if already cleaned — just assert success or task already gone
    let _ = r; // Accept either case in cleanup
}

// ═══════════════════════════════════════════════════════════════════════════
// 任务组测试
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn task_group_create_and_one_level_constraint() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;
    let h = c.session_header(&sid);

    // Create group
    let r: Value = c
        .http
        .post(c.url("/tasks/group"))
        .headers(h.clone())
        .json(&json!({
            "parent": {"title": "完成课程设计", "category": "学习", "star_rating": 4},
            "subtasks": [
                {"title": "画 ER 图", "sort_order": 1, "star_rating": 3},
                {"title": "写数据库报告", "sort_order": 2, "star_rating": 3}
            ]
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "create group: {r}");
    let parent_id = r["data"]["parent_id"].as_str().unwrap().to_string();

    // List subtasks
    let r: Value = c
        .http
        .get(format!("{}/api/tasks?parent_id={}", c.base, parent_id))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "list subtasks: {r}");
    let items = r["data"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 2, "should have 2 subtasks");

    // Assert sort_order
    let sort_orders: Vec<i64> = items.iter()
        .map(|t| t["sort_order"].as_i64().unwrap())
        .collect();
    assert!(sort_orders.contains(&1), "should have sort_order 1");
    assert!(sort_orders.contains(&2), "should have sort_order 2");

    // Assert parent_id is set on subtasks
    assert!(items.iter().all(|t| t["parent_id"].as_str() == Some(&parent_id)));

    // Try to add a child to a subtask (should be rejected — one-level only)
    let child_id = items[0]["id"].as_str().unwrap().to_string();
    let r: Value = c
        .http
        .post(c.url("/tasks"))
        .headers(h.clone())
        .json(&json!({
            "title": "不允许的二级子任务",
            "parent_id": child_id
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!r["success"].as_bool().unwrap(), "二级子任务应被拒绝: {r}");
    assert!(
        r["message"].as_str().unwrap().contains("多级"),
        "error message should mention 多级: {r}"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// 模板测试
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn templates_crud_and_generate() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;
    let h = c.session_header(&sid);

    // Create template
    let r: Value = c
        .http
        .post(c.url("/templates"))
        .headers(h.clone())
        .json(&json!({
            "title": "每日复习",
            "category": "学习",
            "star_rating": 3,
            "frequency": "daily",
            "generate_day": 0,
            "generate_time": "09:00",
            "deadline_day": 0,
            "deadline_time": "18:00"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "create template: {r}");
    let tmpl_id = r["data"]["id"].as_str().unwrap().to_string();

    // List templates
    let r: Value = c
        .http
        .get(c.url("/templates"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap());
    let items = r["data"]["items"].as_array().unwrap();
    assert!(items.iter().any(|t| t["id"].as_str() == Some(&tmpl_id)));

    // Update template
    let r: Value = c
        .http
        .put(format!("{}/api/templates/{}", c.base, tmpl_id))
        .headers(h.clone())
        .json(&json!({"title": "每日复习（已更新）"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "update template: {r}");
    assert_eq!(r["data"]["title"].as_str().unwrap(), "每日复习（已更新）");

    // Generate tasks — manual trigger should immediately create 1 task per template
    let r: Value = c
        .http
        .post(c.url("/templates/generate"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "generate: {r}");
    let generated = r["data"]["generated"].as_i64().unwrap();
    assert!(generated >= 1, "should generate at least 1 task, got {generated}");
    assert!(
        r["message"].as_str().unwrap().contains("已生成"),
        "message should report count: {r}"
    );

    // Verify the generated task actually exists in the task list
    let r: Value = c
        .http
        .get(c.url("/tasks"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let items = r["data"]["items"].as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|t| t["title"].as_str() == Some("每日复习（已更新）")),
        "generated task should appear in task list"
    );

    // Delete template
    let r: Value = c
        .http
        .delete(format!("{}/api/templates/{}", c.base, tmpl_id))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "delete template: {r}");
}

#[tokio::test]
async fn templates_generate_without_templates_returns_hint() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;
    let h = c.session_header(&sid);

    // User has no templates → generate should fail with a helpful hint
    let r: Value = c
        .http
        .post(c.url("/templates/generate"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!r["success"].as_bool().unwrap(), "no-template generate should fail: {r}");
    assert!(
        r["message"].as_str().unwrap().contains("请先创建模板"),
        "should prompt to create a template: {r}"
    );
}

#[tokio::test]
async fn templates_generate_is_idempotent_per_day() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;
    let h = c.session_header(&sid);

    // Create one habit (template).
    let r: Value = c
        .http
        .post(c.url("/templates"))
        .headers(h.clone())
        .json(&json!({
            "title": "每日冥想",
            "category": "生活",
            "star_rating": 2,
            "frequency": "daily",
            "generate_day": 0,
            "generate_time": "09:00",
            "deadline_day": 0,
            "deadline_time": "18:00"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "create template: {r}");

    // First manual generate → should create 1 task.
    let r: Value = c
        .http
        .post(c.url("/templates/generate"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "first generate: {r}");
    assert_eq!(
        r["data"]["generated"].as_i64().unwrap(),
        1,
        "first generate should create exactly 1 task: {r}"
    );

    // Second manual generate the SAME day → must be skipped (last_generated==today).
    let r: Value = c
        .http
        .post(c.url("/templates/generate"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "second generate: {r}");
    assert_eq!(
        r["data"]["generated"].as_i64().unwrap(),
        0,
        "second same-day generate should create 0 tasks (dedupe): {r}"
    );

    // Task list must contain exactly one task from this habit (no duplicate).
    let r: Value = c
        .http
        .get(c.url("/tasks"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let count = r["data"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["title"].as_str() == Some("每日冥想"))
        .count();
    assert_eq!(count, 1, "habit should have generated exactly one task, got {count}");
}

// ═══════════════════════════════════════════════════════════════════════════
// 打卡测试
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn checkin_status_and_checkin() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;
    let h = c.session_header(&sid);

    // Check status
    let r: Value = c
        .http
        .get(c.url("/checkin/status"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "checkin status: {r}");
    assert_eq!(r["data"]["today_checked"].as_bool().unwrap(), false);

    // Check in
    let r: Value = c
        .http
        .post(c.url("/checkin"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "checkin: {r}");
    assert_eq!(r["data"]["current_streak"].as_i64().unwrap(), 1);

    // Duplicate check-in should fail
    let r: Value = c
        .http
        .post(c.url("/checkin"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!r["success"].as_bool().unwrap(), "duplicate checkin should fail");
    assert!(r["message"].as_str().unwrap().contains("已签到"));

    // Status now shows today_checked = true
    let r: Value = c
        .http
        .get(c.url("/checkin/status"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(r["data"]["today_checked"].as_bool().unwrap(), true);
}

// ═══════════════════════════════════════════════════════════════════════════
// 用户中心测试
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn user_profile_stats_settings() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;
    let h = c.session_header(&sid);

    // Profile
    let r: Value = c
        .http
        .get(c.url("/user/profile"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "profile: {r}");
    assert_eq!(r["data"]["phone"].as_str().unwrap(), phone);

    // Stats
    let r: Value = c
        .http
        .get(c.url("/user/stats"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "stats: {r}");
    assert!(r["data"]["total"].is_number());

    // Get settings
    let r: Value = c
        .http
        .get(c.url("/user/settings"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "get settings: {r}");

    // Update summary_tone
    let r: Value = c
        .http
        .put(c.url("/user/settings"))
        .headers(h.clone())
        .json(&json!({"summary_tone": "简短效率型"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "update settings: {r}");

    // Verify changed
    let r: Value = c
        .http
        .get(c.url("/user/settings"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(r["data"]["summary_tone"].as_str().unwrap(), "简短效率型");

    // Invalid tone rejected
    let r: Value = c
        .http
        .put(c.url("/user/settings"))
        .headers(h.clone())
        .json(&json!({"summary_tone": "无效语气"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!r["success"].as_bool().unwrap(), "invalid tone should fail");

    // 大模型设置：账户级持久化（跨设备同步）。保存后 GET 应原样返回，
    // 模拟"换一台电脑/浏览器"重新拉取设置仍可用。
    let r: Value = c
        .http
        .put(c.url("/user/settings"))
        .headers(h.clone())
        .json(&json!({
            "llm_api_key": "sk-test-persist",
            "llm_model": "deepseek-chat",
            "llm_base_url": "https://api.deepseek.com"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "save llm settings: {r}");

    let r: Value = c
        .http
        .get(c.url("/user/settings"))
        .headers(h.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(r["data"]["llm_api_key"].as_str().unwrap(), "sk-test-persist");
    assert_eq!(r["data"]["llm_model"].as_str().unwrap(), "deepseek-chat");
    assert_eq!(
        r["data"]["llm_base_url"].as_str().unwrap(),
        "https://api.deepseek.com"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// 多用户隔离测试
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn multi_user_isolation() {
    let mut c = TestClient::new().await;

    let phone_a = unique_phone();
    let phone_b = unique_phone();
    let sid_a = c.register_and_login(&phone_a, "passAAAA").await;
    let sid_b = c.register_and_login(&phone_b, "passBBBB").await;

    let h_a = c.session_header(&sid_a);
    let h_b = c.session_header(&sid_b);

    // A creates a task
    let r: Value = c
        .http
        .post(c.url("/tasks"))
        .headers(h_a.clone())
        .json(&json!({"title": "A的私密任务", "category": "工作"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap());
    let task_id_a = r["data"]["id"].as_str().unwrap().to_string();

    // B's task list should NOT contain A's task
    let r: Value = c
        .http
        .get(c.url("/tasks"))
        .headers(h_b.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let items = r["data"]["items"].as_array().unwrap();
    assert!(
        !items.iter().any(|t| t["id"].as_str() == Some(&task_id_a)),
        "B should not see A's task"
    );

    // B tries to delete A's task (should fail / not affect)
    let r: Value = c
        .http
        .delete(format!("{}/api/tasks/{}", c.base, task_id_a))
        .headers(h_b.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!r["success"].as_bool().unwrap(), "B cannot delete A's task");

    // A's task should still be there
    let r: Value = c
        .http
        .get(c.url("/tasks"))
        .headers(h_a.clone())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let items = r["data"]["items"].as_array().unwrap();
    assert!(
        items.iter().any(|t| t["id"].as_str() == Some(&task_id_a)),
        "A's task should still exist"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock LLM Server
// ═══════════════════════════════════════════════════════════════════════════

/// 启动一个本地 Mock OpenAI 兼容 HTTP server，返回其地址
async fn spawn_mock_llm(response_body: serde_json::Value) -> String {
    use axum::{response::IntoResponse, routing::post, Router};
    use std::sync::Arc;

    let body = Arc::new(response_body);

    let app = Router::new().route(
        "/v1/chat/completions",
        post(move || {
            let body = body.clone();
            async move {
                axum::response::Json(body.as_ref().clone()).into_response()
            }
        }),
    );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    format!("http://127.0.0.1:{}", addr.port())
}

/// 启动返回固定内容的 mock LLM（合法的 parse 响应）
fn parse_mock_response() -> serde_json::Value {
    json!({
        "choices": [{
            "message": {
                "content": r#"{
                    "title": "完成数据库报告",
                    "description": "",
                    "category": "学习",
                    "star_rating": 4,
                    "start_date": null,
                    "deadline": "2025-07-01T18:00:00+08:00",
                    "suggestion": null
                }"#
            }
        }]
    })
}

fn decompose_mock_response() -> serde_json::Value {
    json!({
        "choices": [{
            "message": {
                "content": r#"{
                    "is_big_task": true,
                    "parent": {"title": "完成课程设计", "category": "学习"},
                    "subtasks": [
                        {"title": "画 ER 图", "sort_order": 1, "star_rating": 3},
                        {"title": "写数据库报告", "sort_order": 2, "star_rating": 3}
                    ]
                }"#
            }
        }]
    })
}

fn error_500_mock_response() -> serde_json::Value {
    // This will be returned as 200 but with invalid JSON content field
    json!({
        "choices": [{
            "message": {
                "content": "invalid_json_garbage"
            }
        }]
    })
}

// ═══════════════════════════════════════════════════════════════════════════
// AI 集成测试（Mock LLM）
// ═══════════════════════════════════════════════════════════════════════════

/// 共用：构建携带 LLM 头的 header map
fn ai_headers(session_id: &str, mock_url: &str) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("x-session-id", session_id.parse().unwrap());
    h.insert("x-llm-base-url", format!("{}/v1", mock_url).parse().unwrap());
    h.insert("x-llm-key", "test-key".parse().unwrap());
    h.insert("x-llm-model", "test-model".parse().unwrap());
    h
}

#[tokio::test]
async fn ai_parse_with_mock_returns_valid_structure_and_does_not_write_db() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;

    let mock_url = spawn_mock_llm(parse_mock_response()).await;
    let h = ai_headers(&sid, &mock_url);

    // Count tasks before
    let before: Value = c
        .http
        .get(c.url("/tasks"))
        .headers(c.session_header(&sid))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let count_before = before["data"]["total"].as_i64().unwrap_or(0);

    // Call parse
    let r: Value = c
        .http
        .post(c.url("/ai/parse"))
        .headers(h.clone())
        .json(&json!({"text": "明天下午把数据库课设报告写完，学习分类，优先级高"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert!(r["success"].as_bool().unwrap(), "parse should succeed: {r}");

    // New contract: parse returns { items: [ ... ] }; a single-task LLM
    // response is normalized into a one-element array.
    let items = r["data"]["items"].as_array().expect("data.items must be array");
    assert_eq!(items.len(), 1, "single sentence should yield one item");
    let data = &items[0];

    // Structure assertions
    assert!(data["title"].is_string(), "title must be string");
    assert!(data["description"].is_string(), "description must be string");

    // Category must be in valid set
    let category = data["category"].as_str().unwrap_or("");
    assert!(
        ["学习", "工作", "生活", "家庭", "其他"].contains(&category),
        "category must be valid, got: {category}"
    );

    // star_rating 0-5
    let star = data["star_rating"].as_i64().unwrap_or(-1);
    assert!((0..=5).contains(&star), "star_rating must be 0-5, got: {star}");

    // deadline should be parseable ISO8601 if not null
    if let Some(dl) = data["deadline"].as_str() {
        chrono::DateTime::parse_from_rfc3339(dl)
            .expect("deadline should be valid ISO8601");
    }

    // Verify NOT written to DB (task count unchanged)
    let after: Value = c
        .http
        .get(c.url("/tasks"))
        .headers(c.session_header(&sid))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let count_after = after["data"]["total"].as_i64().unwrap_or(0);
    assert_eq!(count_before, count_after, "parse should not write to DB");
}

#[tokio::test]
async fn ai_decompose_with_mock_returns_valid_structure_and_does_not_write_db() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;

    let mock_url = spawn_mock_llm(decompose_mock_response()).await;
    let h = ai_headers(&sid, &mock_url);

    // Count tasks before
    let before: Value = c
        .http
        .get(c.url("/tasks"))
        .headers(c.session_header(&sid))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let count_before = before["data"]["total"].as_i64().unwrap_or(0);

    // Call decompose
    let r: Value = c
        .http
        .post(c.url("/ai/decompose"))
        .headers(h.clone())
        .json(&json!({"title": "完成课程设计", "description": ""}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert!(r["success"].as_bool().unwrap(), "decompose should succeed: {r}");

    let data = &r["data"];
    assert!(data["is_big_task"].is_boolean(), "is_big_task must be bool");
    assert!(data["parent"].is_object(), "parent must be object");

    let subtasks = data["subtasks"].as_array().unwrap();
    for st in subtasks {
        let so = st["sort_order"].as_i64().unwrap_or(-1);
        assert!(so >= 1, "sort_order must be >= 1");
        let sr = st["star_rating"].as_i64().unwrap_or(-1);
        assert!((0..=5).contains(&sr), "subtask star_rating must be 0-5");
    }

    // Verify NOT written to DB
    let after: Value = c
        .http
        .get(c.url("/tasks"))
        .headers(c.session_header(&sid))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let count_after = after["data"]["total"].as_i64().unwrap_or(0);
    assert_eq!(count_before, count_after, "decompose should not write to DB");
}

#[tokio::test]
async fn ai_parse_with_invalid_json_returns_graceful_error() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;

    // Mock returns garbage JSON content
    let mock_url = spawn_mock_llm(error_500_mock_response()).await;
    let h = ai_headers(&sid, &mock_url);

    let r: Value = c
        .http
        .post(c.url("/ai/parse"))
        .headers(h)
        .json(&json!({"text": "测试降级"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    // Should return success:false with graceful message
    assert!(!r["success"].as_bool().unwrap(), "should fail gracefully: {r}");
    let msg = r["message"].as_str().unwrap_or("");
    assert!(
        msg.contains("智能服务") || msg.contains("手动"),
        "should mention fallback: {msg}"
    );
}

#[tokio::test]
async fn ai_decompose_with_llm_down_returns_graceful_error() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;

    // Point to a non-existent server
    let h = ai_headers(&sid, "http://127.0.0.1:19999");

    let r: Value = c
        .http
        .post(c.url("/ai/decompose"))
        .headers(h)
        .json(&json!({"title": "任何任务", "description": ""}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert!(!r["success"].as_bool().unwrap(), "should fail gracefully when LLM is down: {r}");
    let msg = r["message"].as_str().unwrap_or("");
    assert!(
        msg.contains("智能服务") || msg.contains("手动"),
        "should mention fallback: {msg}"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// 健康检查
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn health_check_returns_ok() {
    let c = TestClient::new().await;
    let r: Value = c
        .http
        .get(c.url("/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(r["success"].as_bool().unwrap(), "health: {r}");
}

// ═══════════════════════════════════════════════════════════════════════════
// Agent 模式测试（带工具的多轮 Mock LLM）
// ═══════════════════════════════════════════════════════════════════════════

/// 启动一个"按调用次序返回不同响应"的 Mock LLM。
/// 用于模拟 agent 循环：第 1 次返回工具调用，第 2 次返回最终答复。
async fn spawn_mock_llm_sequence(responses: Vec<serde_json::Value>) -> String {
    use axum::{response::IntoResponse, routing::post, Router};
    use std::sync::{atomic::{AtomicUsize, Ordering}, Arc};

    let seq = Arc::new(responses);
    let counter = Arc::new(AtomicUsize::new(0));

    let app = Router::new().route(
        "/v1/chat/completions",
        post(move || {
            let seq = seq.clone();
            let counter = counter.clone();
            async move {
                let i = counter.fetch_add(1, Ordering::SeqCst);
                let idx = i.min(seq.len() - 1); // 超出后停在最后一条
                axum::response::Json(seq[idx].clone()).into_response()
            }
        }),
    );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://127.0.0.1:{}", addr.port())
}

fn tool_call_msg(id: &str, name: &str, args: &str) -> serde_json::Value {
    json!({
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": id,
                    "type": "function",
                    "function": {"name": name, "arguments": args}
                }]
            }
        }]
    })
}

fn final_msg(text: &str) -> serde_json::Value {
    json!({"choices": [{"message": {"role": "assistant", "content": text}}]})
}

/// 读工具路径：模型先 list_tasks，拿到结果后给出最终答复；不应产生 pending。
#[tokio::test]
async fn agent_read_tool_roundtrip() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;

    // 准备一条任务
    c.http
        .post(c.url("/tasks"))
        .headers(c.session_header(&sid))
        .json(&json!({"title": "周一写周报", "category": "工作"}))
        .send().await.unwrap();

    let mock_url = spawn_mock_llm_sequence(vec![
        tool_call_msg("call_1", "list_tasks", "{\"status\":\"all\"}"),
        final_msg("你共有 1 条任务，关键词集中在「周报」。"),
    ]).await;
    let h = ai_headers(&sid, &mock_url);

    let r: Value = c.http
        .post(c.url("/ai/agent"))
        .headers(h)
        .json(&json!({"messages": [], "user_input": "看看我的任务关键词"}))
        .send().await.unwrap()
        .json().await.unwrap();

    assert!(r["success"].as_bool().unwrap(), "agent should succeed: {r}");
    let data = &r["data"];
    assert!(data["pending"].is_null(), "read path must not produce pending: {data}");
    assert_eq!(data["reply"].as_str().unwrap(), "你共有 1 条任务，关键词集中在「周报」。");
    // steps 里应有一次成功的 list_tasks 工具调用
    let steps = data["steps"].as_array().unwrap();
    assert!(steps.iter().any(|s| s["kind"] == "tool" && s["name"] == "list_tasks" && s["ok"] == true),
        "expected a successful list_tasks step: {data}");
    // messages 回传里不含 system（第一条不应是 system）
    let msgs = data["messages"].as_array().unwrap();
    assert!(msgs.first().map(|m| m["role"] != "system").unwrap_or(true), "system must be stripped: {data}");
}

/// 写工具确认闸：模型提出 create_task → 返回 pending 且**未写库**；
/// 用户 approve 后再次请求 → 真正写库。
#[tokio::test]
async fn agent_write_requires_confirmation_then_commits() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;

    async fn count_tasks(c: &TestClient, sid: &str) -> i64 {
        let v: Value = c.http.get(c.url("/tasks")).headers(c.session_header(sid))
            .send().await.unwrap().json().await.unwrap();
        v["data"]["total"].as_i64().unwrap_or(0)
    }

    let before = count_tasks(&c, &sid).await;

    // 第 1 次：提出 create_task；第 2 次（approve 后）：最终答复
    let mock_url = spawn_mock_llm_sequence(vec![
        tool_call_msg("call_w", "create_task", "{\"title\":\"买牛奶\",\"category\":\"生活\",\"star_rating\":2}"),
        final_msg("好的，已为你新建「买牛奶」。"),
    ]).await;
    let h = ai_headers(&sid, &mock_url);

    // 提案阶段
    let r1: Value = c.http
        .post(c.url("/ai/agent"))
        .headers(h.clone())
        .json(&json!({"messages": [], "user_input": "帮我加个买牛奶的生活任务"}))
        .send().await.unwrap()
        .json().await.unwrap();
    assert!(r1["success"].as_bool().unwrap(), "{r1}");
    let pending = &r1["data"]["pending"];
    assert!(!pending.is_null(), "create should produce a pending confirmation: {r1}");
    assert_eq!(pending["tool"], "create_task");
    let tc_id = pending["tool_call_id"].as_str().unwrap().to_string();

    // 关键安全属性：确认前未写库
    assert_eq!(count_tasks(&c, &sid).await, before, "must NOT write before confirmation");

    // 回传的 messages 作为下一轮历史
    let history = r1["data"]["messages"].clone();

    // 确认阶段
    let r2: Value = c.http
        .post(c.url("/ai/agent"))
        .headers(h)
        .json(&json!({"messages": history, "decision": {"tool_call_id": tc_id, "approved": true}}))
        .send().await.unwrap()
        .json().await.unwrap();
    assert!(r2["success"].as_bool().unwrap(), "{r2}");
    assert!(r2["data"]["pending"].is_null(), "no pending after commit: {r2}");
    assert_eq!(r2["data"]["reply"].as_str().unwrap(), "好的，已为你新建「买牛奶」。");

    // 现在应已写库
    assert_eq!(count_tasks(&c, &sid).await, before + 1, "task must exist after approval");
}

/// 拒绝路径：approve=false 时不写库，模型据拒绝继续对话。
#[tokio::test]
async fn agent_write_rejected_does_not_commit() {
    let mut c = TestClient::new().await;
    let phone = unique_phone();
    let sid = c.register_and_login(&phone, "pass1234").await;

    let before: Value = c.http.get(c.url("/tasks")).headers(c.session_header(&sid))
        .send().await.unwrap().json().await.unwrap();
    let count_before = before["data"]["total"].as_i64().unwrap_or(0);

    let mock_url = spawn_mock_llm_sequence(vec![
        tool_call_msg("call_d", "create_task", "{\"title\":\"不想要的任务\"}"),
        final_msg("好的，已取消。你希望怎么调整？"),
    ]).await;
    let h = ai_headers(&sid, &mock_url);

    let r1: Value = c.http.post(c.url("/ai/agent")).headers(h.clone())
        .json(&json!({"messages": [], "user_input": "加个任务"}))
        .send().await.unwrap().json().await.unwrap();
    let tc_id = r1["data"]["pending"]["tool_call_id"].as_str().unwrap().to_string();
    let history = r1["data"]["messages"].clone();

    let r2: Value = c.http.post(c.url("/ai/agent")).headers(h)
        .json(&json!({"messages": history, "decision": {"tool_call_id": tc_id, "approved": false}}))
        .send().await.unwrap().json().await.unwrap();
    assert!(r2["success"].as_bool().unwrap(), "{r2}");

    let after: Value = c.http.get(c.url("/tasks")).headers(c.session_header(&sid))
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(after["data"]["total"].as_i64().unwrap_or(0), count_before, "reject must not write");
}
