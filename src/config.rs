use std::env;

/// 运行时配置，从环境变量（含 .env）读取。
#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    /// 大模型默认配置（OpenAI 兼容）。用户可通过 X-LLM-* 请求头覆盖。
    pub llm_base_url: String,
    pub llm_api_key: String,
    pub llm_model: String,
    pub llm_model_strong: String,
    /// 账号/密码问题求助联系方式，展示在前端。
    pub contact_email: String,
}

impl Config {
    pub fn from_env() -> Self {
        // 数据库优先用 IPv4 通用的 Session Pooler，回退到直连。
        let database_url = env::var("DATABASE_URL_POOLER")
            .ok()
            .filter(|s| !s.is_empty())
            .or_else(|| env::var("DATABASE_URL").ok())
            .expect("缺少 DATABASE_URL_POOLER 或 DATABASE_URL");

        let port = env::var("PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(8080);

        Config {
            database_url,
            port,
            llm_base_url: env::var("LLM_BASE_URL")
                .unwrap_or_else(|_| "https://aihubmix.com/v1".into()),
            llm_api_key: env::var("LLM_API_KEY").unwrap_or_default(),
            llm_model: env::var("LLM_MODEL").unwrap_or_else(|_| "deepseek-v4-flash".into()),
            llm_model_strong: env::var("LLM_MODEL_STRONG")
                .unwrap_or_else(|_| "deepseek-v4-pro".into()),
            contact_email: env::var("CONTACT_EMAIL").unwrap_or_default(),
        }
    }
}
