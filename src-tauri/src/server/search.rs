use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveTrackQuery {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub exclude_id: Option<String>,
    pub q: Option<String>,
}

/// GET /api/search?q=...
pub async fn search_tracks(
    Query(params): Query<SearchQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let query = params.q.unwrap_or_default();
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Json(json!({ "items": [] })).into_response();
    }

    let (items, source) = state.innertube.search_combined(trimmed).await;
    Json(json!({
        "items": items,
        "source": source,
    }))
    .into_response()
}

/// GET /api/search/suggestions?q=...
pub async fn search_suggestions(
    Query(params): Query<SearchQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let query = params.q.unwrap_or_default();
    let suggestions = state.innertube.search_suggestions(&query).await;
    Json(json!({ "suggestions": suggestions })).into_response()
}

/// GET /api/resolve-track
pub async fn resolve_track(
    Query(params): Query<ResolveTrackQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let title = params.title.unwrap_or_default();
    let artist = params.artist.unwrap_or_default();
    let exclude_id = params.exclude_id.unwrap_or_default();
    let raw_query = params
        .q
        .unwrap_or_else(|| format!("{} {}", artist, title));
    let query = raw_query.trim();

    if query.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing query or title" })),
        )
            .into_response();
    }

    // First check InnerTube direct search
    let mut yt_items = state.innertube.search_innertube(query).await;
    yt_items.sort_by(|a, b| {
        b.priority_score
            .unwrap_or(0)
            .cmp(&a.priority_score.unwrap_or(0))
    });
    for item in yt_items {
        if !item.youtube_id.is_empty() && item.youtube_id != exclude_id {
            return Json(json!({
                "success": true,
                "track": item,
                "originalExcludeId": exclude_id
            }))
            .into_response();
        }
    }

    // Fallback prioritized queries via scraping
    let search_queries = [
        format!("{} - Topic", query),
        format!("{} official audio", query),
        format!("{} audio", query),
        format!("{} lyric video", query),
        query.to_string(),
    ];

    for sq in search_queries {
        let mut items = state.innertube.search_scraping(&sq).await;
        items.sort_by(|a, b| {
            b.priority_score
                .unwrap_or(0)
                .cmp(&a.priority_score.unwrap_or(0))
        });
        for item in items {
            if !item.youtube_id.is_empty() && item.youtube_id != exclude_id {
                return Json(json!({
                    "success": true,
                    "track": item,
                    "originalExcludeId": exclude_id
                }))
                .into_response();
            }
        }
    }

    Json(json!({
        "success": false,
        "message": "No alternative track found"
    }))
    .into_response()
}
