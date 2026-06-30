//! 时间工具：全系统"今天/当日"统一用北京时区（UTC+8），
//! 避免服务端日期口径(UTC)与发给大模型的 +08:00 提示词相互矛盾。

use chrono::{DateTime, FixedOffset, NaiveDate, TimeZone, Utc};

/// 北京时区偏移 (UTC+8)。
pub fn beijing_offset() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).expect("UTC+8 is a valid offset")
}

/// 当前北京时间。
pub fn beijing_now() -> DateTime<FixedOffset> {
    Utc::now().with_timezone(&beijing_offset())
}

/// 北京时区的"今天"日期。
pub fn beijing_today() -> NaiveDate {
    beijing_now().date_naive()
}

/// 北京时区今天 0 点对应的 UTC 时刻。
/// 用于按 created_at / completed_at（库内为 UTC）过滤"今天"的记录。
pub fn beijing_today_start_utc() -> DateTime<Utc> {
    let off = beijing_offset();
    let midnight = beijing_today()
        .and_hms_opt(0, 0, 0)
        .expect("midnight is valid");
    off.from_local_datetime(&midnight)
        .single()
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn today_start_is_midnight_beijing() {
        let start = beijing_today_start_utc();
        // 转回北京时间应为当天 0:00:00
        let bj = start.with_timezone(&beijing_offset());
        assert_eq!(bj.time(), chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap());
        assert_eq!(bj.date_naive(), beijing_today());
    }
}
