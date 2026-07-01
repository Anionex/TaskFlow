// One-off seeder: fills the test user's past year with completed tasks so the
// 完成足迹 heatmap has something to show. All rows are tagged with a fixed title
// prefix so they can be removed in one statement (see cleanup note at bottom).
//
//   PORT unused. Run:  cargo run --bin seed_heatmap
//   Clean up:          cargo run --bin seed_heatmap -- clean

use chrono::{Duration, Timelike, Utc};
use sqlx::postgres::PgPoolOptions;

const PHONE: &str = "13800138000";
const TAG: &str = "【热力图测试】";
const CATS: [&str; 5] = ["学习", "工作", "生活", "家庭", "其他"];

// tiny deterministic PRNG so re-runs are stable
fn xorshift(mut x: u64) -> u64 {
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    x
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let db_url = std::env::var("DATABASE_URL_POOLER")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .expect("缺少 DATABASE_URL_POOLER 或 DATABASE_URL");

    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&db_url)
        .await?;

    let uid: uuid::Uuid = sqlx::query_scalar("SELECT id FROM users WHERE phone=$1")
        .bind(PHONE)
        .fetch_one(&pool)
        .await
        .expect("找不到测试用户，请先确认该账号已注册");

    // Always clear previously-seeded rows first (idempotent).
    let deleted = sqlx::query("DELETE FROM tasks WHERE user_id=$1 AND title LIKE $2")
        .bind(uid)
        .bind(format!("{TAG}%"))
        .execute(&pool)
        .await?
        .rows_affected();
    println!("已清理旧测试数据 {deleted} 条");

    if std::env::args().any(|a| a == "clean") {
        println!("clean 模式：仅清理，未插入");
        return Ok(());
    }

    // Build a year of completions. completed_at anchored at 04:00 UTC = 12:00
    // 北京时间, so the backend's +8h day bucketing lands on the intended date.
    let today = Utc::now()
        .with_hour(4).unwrap()
        .with_minute(0).unwrap()
        .with_second(0).unwrap()
        .with_nanosecond(0).unwrap();

    let mut rows: Vec<(String, String, i16, chrono::DateTime<Utc>)> = Vec::new();
    let mut seq = 0u32;
    for i in 0..365i64 {
        // i = days ago; 0 = today
        let day = today - Duration::days(i);
        let r = xorshift(i as u64 + 987_654);
        let recent = i < 63; // last ~9 weeks denser
        let mut count = match r % 10 {
            0 | 1 | 2 | 3 => 0,
            4 | 5 => 1,
            6 | 7 => 2,
            8 => 3,
            _ => 4,
        };
        if recent {
            count += (r / 16 % 4) as u64;
        }
        for k in 0..count {
            let cat = CATS[(r as usize + k as usize) % CATS.len()];
            let star = ((r / 3 + k) % 6) as i16;
            // spread completions through the working day for realism
            let at = day + Duration::minutes(((r / 7 + k * 37) % 600) as i64);
            rows.push((
                format!("{TAG}{cat}任务 #{seq}"),
                cat.to_string(),
                star,
                at,
            ));
            seq += 1;
        }
    }

    // Multi-row insert in chunks.
    let total = rows.len();
    for chunk in rows.chunks(500) {
        let mut qb = sqlx::QueryBuilder::new(
            "INSERT INTO tasks (user_id, title, description, completed, category, star_rating, created_at, completed_at) ",
        );
        qb.push_values(chunk, |mut b, (title, cat, star, at)| {
            b.push_bind(uid)
                .push_bind(title)
                .push_bind("")
                .push_bind(true)
                .push_bind(cat)
                .push_bind(star)
                .push_bind(at)
                .push_bind(at);
        });
        qb.build().execute(&pool).await?;
    }

    println!("已为 {PHONE} 插入 {total} 条历史完成任务（跨 365 天）");
    Ok(())
}
