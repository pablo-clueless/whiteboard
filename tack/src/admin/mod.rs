//! The admin API under `/api/admin`, one module per page of the admin interface. Every handler
//! takes an [`AdminUser`](crate::accounts::AdminUser): reads need `admin:read`, changes
//! `admin:write`.
//!
//! Lists share one shape: `?page=1&limit=10&search=…&sort=…&order=asc|desc`, answered with
//! `{ data, total, page, limit }`. Stats take `?period=<days>` and compare it with the period
//! before.

mod boards;
mod live;
mod logs;
mod overview;
mod settings;
mod users;

use axum::Router;
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(overview::router())
        .merge(live::router())
        .merge(users::router())
        .merge(boards::router())
        .merge(logs::router())
        .merge(settings::router())
}

const DEFAULT_LIMIT: i64 = 10;
const MAX_LIMIT: i64 = 100;

#[derive(Debug, Serialize)]
pub struct Page<T> {
    pub data: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub limit: i64,
}

/// Limit and offset from 1-based `page` and `limit` query params.
pub fn paging(page: Option<i64>, limit: Option<i64>) -> (i64, i64, i64) {
    let page = page.unwrap_or(1).max(1);
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    (page, limit, (page - 1) * limit)
}

/// `asc` or `desc` (the default), for splicing into ORDER BY.
pub fn order(order: Option<&str>) -> &'static str {
    match order {
        Some(o) if o.eq_ignore_ascii_case("asc") => "ASC",
        _ => "DESC",
    }
}

/// A search term as an ILIKE pattern, with the user's `%`, `_` and `\` matched literally.
pub fn like_pattern(search: Option<&str>) -> Option<String> {
    let search = search.map(str::trim).filter(|s| !s.is_empty())?;
    let escaped = search.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    Some(format!("%{escaped}%"))
}

/// A comma-separated filter (`status=active,archived`) as a list, or None for no filter.
pub fn list_param(value: Option<&str>) -> Option<Vec<String>> {
    let items: Vec<String> =
        value?.split(',').map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect();
    (!items.is_empty()).then_some(items)
}

/// The stats period in days: 1 to 365, 7 by default. Matches PERIODS in the web client.
pub fn period_days(period: Option<i64>) -> i64 {
    period.unwrap_or(7).clamp(1, 365)
}

/// The current period and the one before it: `(previous_start, start, now)`.
pub fn period_bounds(days: i64) -> (DateTime<Utc>, DateTime<Utc>, DateTime<Utc>) {
    let now = Utc::now();
    let start = now - Duration::days(days);
    (start - Duration::days(days), start, now)
}

/// A number for a stat card, with the same number for the previous period and the change.
#[derive(Debug, Serialize)]
pub struct Stat {
    pub value: i64,
    pub previous: i64,
    /// Percent change from `previous`, to one decimal; null when `previous` is 0 and `value` isn't.
    pub delta: Option<f64>,
}

impl Stat {
    pub fn new(value: i64, previous: i64) -> Self {
        let delta = match (value, previous) {
            (0, 0) => Some(0.0),
            (_, 0) => None,
            (v, p) => Some(((v - p) as f64 / p as f64 * 1000.0).round() / 10.0),
        };
        Self { value, previous, delta }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(paging(None, None), (1, 10, 0));
        assert_eq!(paging(Some(3), Some(500)), (3, 100, 200));
        assert_eq!(paging(Some(-1), Some(0)), (1, 1, 0));
        assert_eq!(order(Some("ASC")), "ASC");
        assert_eq!(order(Some("drop table")), "DESC");
        assert_eq!(like_pattern(Some(" 50%_off ")).as_deref(), Some("%50\\%\\_off%"));
        assert_eq!(like_pattern(Some("  ")), None);
        assert_eq!(list_param(Some("active, archived,")), Some(vec!["active".into(), "archived".into()]));
        assert_eq!(list_param(Some(",")), None);
        assert_eq!(Stat::new(15, 10).delta, Some(50.0));
        assert_eq!(Stat::new(1, 3).delta, Some(-66.7));
        assert_eq!(Stat::new(4, 0).delta, None);
        assert_eq!(period_days(Some(9999)), 365);
    }
}
