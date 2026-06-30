use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
};
use crate::auth::current_user;
use crate::response::{err, ok, ApiResponse};
use crate::state::SharedState;
use crate::util::beijing_today;

/// 纯函数：根据上次签到日期和当前连续天数，计算新的连续天数。
/// 供测试和业务逻辑共用。
pub fn compute_new_streak(
    last_checkin_date: Option<chrono::NaiveDate>,
    current_streak: i32,
    today: chrono::NaiveDate,
) -> Option<i32> {
    // Already checked in today — return None to signal "already done"
    if last_checkin_date == Some(today) {
        return None;
    }
    let yesterday = today - chrono::Duration::days(1);
    let new_streak = if last_checkin_date == Some(yesterday) {
        current_streak + 1
    } else {
        1
    };
    Some(new_streak)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn first_checkin_starts_streak_at_1() {
        let today = date(2025, 6, 30);
        let result = compute_new_streak(None, 0, today);
        assert_eq!(result, Some(1));
    }

    #[test]
    fn consecutive_checkin_increments_streak() {
        let today = date(2025, 6, 30);
        let yesterday = date(2025, 6, 29);
        let result = compute_new_streak(Some(yesterday), 5, today);
        assert_eq!(result, Some(6));
    }

    #[test]
    fn broken_streak_resets_to_1() {
        let today = date(2025, 6, 30);
        let two_days_ago = date(2025, 6, 28);
        let result = compute_new_streak(Some(two_days_ago), 10, today);
        assert_eq!(result, Some(1));
    }

    #[test]
    fn duplicate_checkin_today_returns_none() {
        let today = date(2025, 6, 30);
        let result = compute_new_streak(Some(today), 5, today);
        assert_eq!(result, None);
    }

    #[test]
    fn gap_of_many_days_resets_to_1() {
        let today = date(2025, 6, 30);
        let long_ago = date(2025, 1, 1);
        let result = compute_new_streak(Some(long_ago), 50, today);
        assert_eq!(result, Some(1));
    }
}

pub async fn checkin_status(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    // Ensure row exists
    let _ = sqlx::query(
        "INSERT INTO checkins (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    )
    .bind(uid)
    .execute(&state.db)
    .await;

    let row: Option<(Option<chrono::NaiveDate>, i32, i32)> = sqlx::query_as(
        "SELECT last_checkin_date, current_streak, max_streak FROM checkins WHERE user_id=$1",
    )
    .bind(uid)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    let (last_checkin_date, current_streak, max_streak) = row.unwrap_or((None, 0, 0));
    let today = beijing_today();
    let today_checked = last_checkin_date == Some(today);

    (
        StatusCode::OK,
        ok(
            "获取成功",
            serde_json::json!({
                "last_checkin_date": last_checkin_date,
                "current_streak": current_streak,
                "max_streak": max_streak,
                "today_checked": today_checked
            }),
        ),
    )
}

pub async fn checkin(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse>) {
    let uid = match current_user(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e,
    };

    // Ensure row exists
    let _ = sqlx::query(
        "INSERT INTO checkins (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    )
    .bind(uid)
    .execute(&state.db)
    .await;

    let row: Option<(Option<chrono::NaiveDate>, i32, i32)> = sqlx::query_as(
        "SELECT last_checkin_date, current_streak, max_streak FROM checkins WHERE user_id=$1",
    )
    .bind(uid)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    let (last_checkin_date, current_streak, max_streak) = row.unwrap_or((None, 0, 0));
    let today = beijing_today();

    let new_streak = match compute_new_streak(last_checkin_date, current_streak, today) {
        Some(s) => s,
        None => return (StatusCode::OK, err("今日已签到")),
    };
    let new_max = new_streak.max(max_streak);

    let _ = sqlx::query(
        "UPDATE checkins SET last_checkin_date=$1, current_streak=$2, max_streak=$3 WHERE user_id=$4",
    )
    .bind(today)
    .bind(new_streak)
    .bind(new_max)
    .bind(uid)
    .execute(&state.db)
    .await;

    (
        StatusCode::OK,
        ok(
            "签到成功",
            serde_json::json!({
                "current_streak": new_streak,
                "max_streak": new_max
            }),
        ),
    )
}
