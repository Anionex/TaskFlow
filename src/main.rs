use taskflow::{build_app, TestConfig};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .init();

    let config = taskflow::config::Config::from_env();
    let port = config.port;

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;

    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&pool)
        .await?;
    tracing::info!("数据库连接成功");

    let test_cfg = TestConfig {
        database_url: config.database_url.clone(),
        port: config.port,
        llm_base_url: config.llm_base_url.clone(),
        llm_api_key: config.llm_api_key.clone(),
        llm_model: config.llm_model.clone(),
        llm_model_strong: config.llm_model_strong.clone(),
        contact_email: config.contact_email.clone(),
    };

    // 启动模板自动生成后台调度器（§1.3.9 按日/周/月自动生成）
    taskflow::scheduler::spawn(pool.clone());

    let app = build_app(pool, test_cfg);

    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0".to_string());
    let listener = tokio::net::TcpListener::bind((bind_addr.as_str(), port)).await?;
    tracing::info!("TaskFlow 后端已启动: http://{bind_addr}:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}
