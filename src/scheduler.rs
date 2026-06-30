//! 后台调度器：周期扫描所有循环模板，按 frequency + generate_day + generate_time
//! 在到期当日（北京时区）自动生成任务，落实需求 §1.3.9「按日/周/月自动生成」。
//!
//! generate_day 约定（与前端一致）：weekly → 0=周日..6=周六；monthly → 1-31 日；daily → 忽略。

use std::time::Duration;

use chrono::{Datelike, Timelike};
use sqlx::PgPool;

use crate::models::TaskTemplate;
use crate::templates::generate_task_from_template;
use crate::util::{beijing_now, beijing_today};

/// 扫描间隔：每 10 分钟一次。
const TICK: Duration = Duration::from_secs(600);

/// 启动后台调度循环（在 main 中 spawn）。
pub fn spawn(pool: PgPool) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(TICK);
        loop {
            ticker.tick().await;
            if let Err(e) = run_once(&pool).await {
                tracing::warn!("scheduler tick error: {e}");
            }
        }
    });
}

/// 扫描一次：对每个到期且当日尚未生成的模板生成一条任务。返回生成数量。
pub async fn run_once(pool: &PgPool) -> Result<u32, sqlx::Error> {
    let templates: Vec<TaskTemplate> = sqlx::query_as("SELECT * FROM task_templates")
        .fetch_all(pool)
        .await?;

    let today = beijing_today();
    let now = beijing_now();
    let mut generated = 0u32;

    for tmpl in &templates {
        if is_due(tmpl, today, now.hour(), now.minute())
            && generate_task_from_template(pool, tmpl, today).await
        {
            generated += 1;
        }
    }
    if generated > 0 {
        tracing::info!("scheduler generated {generated} task(s)");
    }
    Ok(generated)
}

/// 判定模板此刻是否应生成：当日未生成 + 已过 generate_time + 频率匹配。
pub fn is_due(tmpl: &TaskTemplate, today: chrono::NaiveDate, cur_hour: u32, cur_min: u32) -> bool {
    if tmpl.last_generated == Some(today) {
        return false; // 当日已生成
    }
    let (gh, gm) = parse_hhmm(&tmpl.generate_time, 9, 0);
    if (cur_hour, cur_min) < (gh, gm) {
        return false; // 未到生成时刻
    }
    match tmpl.frequency.as_str() {
        "daily" => true,
        "weekly" => today.weekday().num_days_from_sunday() as i16 == tmpl.generate_day,
        "monthly" => today.day() as i16 == tmpl.generate_day,
        _ => false,
    }
}

fn parse_hhmm(s: &str, dh: u32, dm: u32) -> (u32, u32) {
    let parts: Vec<&str> = s.split(':').collect();
    let h = parts.first().and_then(|x| x.parse().ok()).unwrap_or(dh);
    let m = parts.get(1).and_then(|x| x.parse().ok()).unwrap_or(dm);
    (h, m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn tmpl(freq: &str, gen_day: i16, gen_time: &str, last: Option<NaiveDate>) -> TaskTemplate {
        TaskTemplate {
            id: uuid::Uuid::nil(),
            user_id: uuid::Uuid::nil(),
            title: "t".into(),
            description: String::new(),
            category: "其他".into(),
            star_rating: 0,
            frequency: freq.into(),
            generate_day: gen_day,
            generate_time: gen_time.into(),
            deadline_day: 0,
            deadline_time: "18:00".into(),
            last_generated: last,
            created_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn daily_due_after_time_and_once_per_day() {
        let today = NaiveDate::from_ymd_opt(2026, 6, 30).unwrap();
        assert!(!is_due(&tmpl("daily", 0, "09:00", None), today, 8, 59));
        assert!(is_due(&tmpl("daily", 0, "09:00", None), today, 9, 0));
        assert!(!is_due(&tmpl("daily", 0, "09:00", Some(today)), today, 10, 0));
    }

    #[test]
    fn weekly_matches_weekday_sunday_zero() {
        let day = NaiveDate::from_ymd_opt(2026, 6, 30).unwrap();
        let wd = day.weekday().num_days_from_sunday() as i16;
        assert!(is_due(&tmpl("weekly", wd, "09:00", None), day, 9, 0));
        assert!(!is_due(&tmpl("weekly", (wd + 1) % 7, "09:00", None), day, 9, 0));
    }

    #[test]
    fn monthly_matches_day_of_month() {
        let d = NaiveDate::from_ymd_opt(2026, 6, 30).unwrap();
        assert!(is_due(&tmpl("monthly", 30, "09:00", None), d, 9, 0));
        assert!(!is_due(&tmpl("monthly", 15, "09:00", None), d, 9, 0));
    }
}
