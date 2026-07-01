//! 时间工具：全系统"今天/当日"统一用北京时区（UTC+8），
//! 避免服务端日期口径(UTC)与发给大模型的 +08:00 提示词相互矛盾。

use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, NaiveDateTime, TimeZone, Utc, Weekday};

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

/// 中文星期几（星期一…星期日）。
fn weekday_zh(wd: Weekday) -> &'static str {
    match wd {
        Weekday::Mon => "星期一",
        Weekday::Tue => "星期二",
        Weekday::Wed => "星期三",
        Weekday::Thu => "星期四",
        Weekday::Fri => "星期五",
        Weekday::Sat => "星期六",
        Weekday::Sun => "星期日",
    }
}

/// 供大模型提示词使用的当前时间标签，含日期、星期与时刻。
/// 例如 "2026-06-30 星期二 14:30 (UTC+8)"。让模型能正确推断
/// "周三/这周末/下午3点/2小时后"等相对时间表达。
pub fn beijing_now_label() -> String {
    let now = beijing_now();
    format!(
        "{} {} {} (UTC+8)",
        now.format("%Y-%m-%d"),
        weekday_zh(now.weekday()),
        now.format("%H:%M"),
    )
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

/// 纯日期（YYYY-MM-DD，无时刻）按哪个时区的零点解释——两处调用语义有意不同。
#[derive(Clone, Copy)]
pub enum DateOnlyTz {
    /// UTC 零点：用于 HTML `<input type="date">` 往返（前端按 UTC 截取 ISO 前 10 位回显，
    /// 若按北京零点存会落到前一天）。
    Utc,
    /// 北京零点：用于自然语言/相对时间（"明天截止"应落在北京当天）。
    Beijing,
}

/// 宽松解析日期/时间字符串为 UTC 时刻：接受 RFC3339、纯日期 (YYYY-MM-DD)
/// 及若干常见无时区格式。带时刻但无时区者一律按北京时区(UTC+8)解释；纯日期按
/// `date_only` 指定的时区零点解释。供 REST 层与 Agent 工具复用（仅纯日期口径不同）。
pub fn parse_flexible_date(s: &str, date_only: DateOnlyTz) -> Option<DateTime<Utc>> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&Utc));
    }
    if let Ok(date) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        let ndt = date.and_hms_opt(0, 0, 0)?;
        return Some(match date_only {
            DateOnlyTz::Utc => Utc.from_utc_datetime(&ndt),
            DateOnlyTz::Beijing => beijing_offset()
                .from_local_datetime(&ndt)
                .single()?
                .with_timezone(&Utc),
        });
    }
    let off = beijing_offset();
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(s, fmt) {
            return off.from_local_datetime(&ndt).single().map(|d| d.with_timezone(&Utc));
        }
    }
    None
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

    #[test]
    fn parse_flexible_date_formats_and_zones() {
        // RFC3339 原样按其时区解析
        assert_eq!(
            parse_flexible_date("2026-07-01T18:00:00+08:00", DateOnlyTz::Utc).unwrap().to_rfc3339(),
            "2026-07-01T10:00:00+00:00"
        );
        // 纯日期：两种零点口径有意不同
        assert_eq!(
            parse_flexible_date("2026-06-25", DateOnlyTz::Utc).unwrap().to_rfc3339(),
            "2026-06-25T00:00:00+00:00"
        );
        assert_eq!(
            parse_flexible_date("2026-06-25", DateOnlyTz::Beijing).unwrap().to_rfc3339(),
            "2026-06-24T16:00:00+00:00" // 北京 6-25 00:00 == UTC 6-24 16:00
        );
        // 带时刻无时区：一律按北京解释
        assert_eq!(
            parse_flexible_date("2026-06-25 09:30", DateOnlyTz::Utc).unwrap().to_rfc3339(),
            "2026-06-25T01:30:00+00:00"
        );
        // 非法/空
        assert!(parse_flexible_date("下周三", DateOnlyTz::Utc).is_none());
        assert!(parse_flexible_date("  ", DateOnlyTz::Beijing).is_none());
    }
}
