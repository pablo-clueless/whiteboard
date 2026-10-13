//! The overview dashboard: headline stats, activity and retention charts, browser and device
//! split, busiest boards and recent activity.

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{Stat, logs::AuditLog, period_bounds, period_days};
use crate::{AppState, accounts::AdminUser, api::ApiError};

pub fn router() -> Router<AppState> {
    Router::new().route("/api/admin/overview", get(overview))
}

#[derive(Deserialize)]
struct Params {
    period: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    /// Board connections opened.
    sessions: Stat,
    boards: Stat,
    /// Distinct visitors (signed in or not) who opened a board.
    active_users: Stat,
    /// Accounts, not counting deleted ones.
    total_users: Stat,
}

/// One chart point. `visitors` matches the dataKey the charts use.
#[derive(Serialize, sqlx::FromRow)]
struct DayPoint {
    date: NaiveDate,
    visitors: i64,
}

#[derive(Serialize, sqlx::FromRow)]
struct BrowserSlice {
    browser: String,
    visitors: i64,
}

#[derive(Serialize, sqlx::FromRow)]
struct DeviceSlice {
    device: String,
    visitors: i64,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct TopBoard {
    id: Uuid,
    name: String,
    sessions: i64,
    visitors: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Overview {
    period: i64,
    stats: Stats,
    /// Distinct visitors per day.
    active_users: Vec<DayPoint>,
    /// Visitors per day who had been seen on an earlier day.
    retention: Vec<DayPoint>,
    users_by_browser: Vec<BrowserSlice>,
    users_by_device: Vec<DeviceSlice>,
    top_boards: Vec<TopBoard>,
    recent_activity: Vec<AuditLog>,
}

const BROWSERS: [&str; 5] = ["chrome", "firefox", "safari", "edge", "others"];
const DEVICES: [&str; 3] = ["desktop", "tablet", "mobile"];

async fn overview(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(params): Query<Params>,
) -> Result<Json<Overview>, ApiError> {
    let days = period_days(params.period);
    let (prev, start, now) = period_bounds(days);
    let pool = &state.pool;

    let (sessions, prev_sessions, active, prev_active): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE started_at >= $2),
                count(*) FILTER (WHERE started_at < $2),
                count(DISTINCT visitor_id) FILTER (WHERE started_at >= $2),
                count(DISTINCT visitor_id) FILTER (WHERE started_at < $2)
         FROM connections WHERE started_at >= $1 AND started_at < $3",
    )
    .bind(prev)
    .bind(start)
    .bind(now)
    .fetch_one(pool)
    .await?;
    let (boards, prev_boards): (i64, i64) =
        sqlx::query_as("SELECT count(*), count(*) FILTER (WHERE created_at < $1) FROM boards")
            .bind(start)
            .fetch_one(pool)
            .await?;
    let (users, prev_users): (i64, i64) = sqlx::query_as(
        "SELECT count(*), count(*) FILTER (WHERE created_at < $1) FROM users WHERE status <> 'deleted'",
    )
    .bind(start)
    .fetch_one(pool)
    .await?;

    let series: Vec<(NaiveDate, i64, i64)> = sqlx::query_as(
        "WITH days AS (
            SELECT d::date AS day FROM generate_series(($1::timestamptz AT TIME ZONE 'UTC')::date, ($2::timestamptz AT TIME ZONE 'UTC')::date, interval '1 day') d
         ),
         daily AS (
            SELECT DISTINCT (started_at AT TIME ZONE 'UTC')::date AS day, visitor_id
            FROM connections WHERE started_at >= $1
         ),
         firsts AS (
            SELECT visitor_id, min((started_at AT TIME ZONE 'UTC')::date) AS first_day
            FROM connections WHERE visitor_id IN (SELECT visitor_id FROM daily) GROUP BY visitor_id
         )
         SELECT days.day, count(daily.visitor_id), count(daily.visitor_id) FILTER (WHERE firsts.first_day < days.day)
         FROM days
         LEFT JOIN daily ON daily.day = days.day
         LEFT JOIN firsts ON firsts.visitor_id = daily.visitor_id
         GROUP BY days.day ORDER BY days.day",
    )
    .bind(now - chrono::Duration::days(days - 1))
    .bind(now)
    .fetch_all(pool)
    .await?;
    let active_users = series.iter().map(|&(date, visitors, _)| DayPoint { date, visitors }).collect();
    let retention = series.iter().map(|&(date, _, visitors)| DayPoint { date, visitors }).collect();

    let by_browser: Vec<BrowserSlice> = sqlx::query_as(
        "SELECT browser, count(DISTINCT visitor_id) AS visitors FROM connections WHERE started_at >= $1 GROUP BY browser",
    )
    .bind(start)
    .fetch_all(pool)
    .await?;
    let by_device: Vec<DeviceSlice> = sqlx::query_as(
        "SELECT device, count(DISTINCT visitor_id) AS visitors FROM connections WHERE started_at >= $1 GROUP BY device",
    )
    .bind(start)
    .fetch_all(pool)
    .await?;
    // Every slice, in a fixed order, so the charts' colours and legends stay put.
    let count_of =
        |name: &str, rows: &[(&str, i64)]| rows.iter().find(|(n, _)| *n == name).map_or(0, |(_, v)| *v);
    let browsers: Vec<(&str, i64)> = by_browser.iter().map(|s| (s.browser.as_str(), s.visitors)).collect();
    let devices: Vec<(&str, i64)> = by_device.iter().map(|s| (s.device.as_str(), s.visitors)).collect();

    let top_boards: Vec<TopBoard> = sqlx::query_as(
        "SELECT b.id, b.title AS name, count(*) AS sessions, count(DISTINCT c.visitor_id) AS visitors
         FROM connections c JOIN boards b ON b.id = c.board_id
         WHERE c.started_at >= $1
         GROUP BY b.id, b.title ORDER BY sessions DESC LIMIT 5",
    )
    .bind(start)
    .fetch_all(pool)
    .await?;

    Ok(Json(Overview {
        period: days,
        stats: Stats {
            sessions: Stat::new(sessions, prev_sessions),
            boards: Stat::new(boards, prev_boards),
            active_users: Stat::new(active, prev_active),
            total_users: Stat::new(users, prev_users),
        },
        active_users,
        retention,
        users_by_browser: BROWSERS
            .iter()
            .map(|&b| BrowserSlice { browser: b.into(), visitors: count_of(b, &browsers) })
            .collect(),
        users_by_device: DEVICES
            .iter()
            .map(|&d| DeviceSlice { device: d.into(), visitors: count_of(d, &devices) })
            .collect(),
        top_boards,
        recent_activity: super::logs::recent(pool, 10).await?,
    }))
}
