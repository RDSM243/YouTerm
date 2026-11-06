use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::state::AppState;
use crate::youtube::models::{AudioFormat, ExploreCategory};

const EXPLORE_CACHE_TTL: Duration = Duration::from_secs(900); // 15 minutes

/// GET /api/explore
pub async fn get_explore(State(state): State<Arc<AppState>>) -> Response {
    if state.smoke_test {
        return Json(json!({ "categories": [] })).into_response();
    }

    {
        let cache = state.explore_cache.read().await;
        if let Some((ref cats, expires_at)) = *cache {
            if expires_at > Instant::now() && !cats.is_empty() {
                return Json(json!({ "categories": cats })).into_response();
            }
        }
    }

    let definitions = [
        ("top_brasil", "Top Hits Brasil", "Top Brasil"),
        ("global_hits", "Global Top Charts", "Top Hits Global"),
        ("lofi_chill", "Lofi & Chill Beats", "Lofi Beats Chill"),
        ("synthwave", "Synthwave / Cyberpunk", "Synthwave Retrowave"),
        ("mpb_classics", "Grandes Clássicos MPB", "MPB Bossa Nova"),
        ("rock_legends", "Rock & Indie Essentials", "Classic Rock Hits"),
    ];

    let mut handles = Vec::with_capacity(definitions.len());
    for (id, name, query) in definitions {
        let innertube = state.innertube.clone();
        handles.push(tokio::spawn(async move {
            let mut tracks = innertube.search_innertube(query).await;
            if tracks.is_empty() {
                tracks = innertube
                    .search_scraping(&format!("{} - Topic", query))
                    .await;
            }
            tracks.truncate(15);
            ExploreCategory {
                id: id.to_string(),
                name: name.to_string(),
                query: query.to_string(),
                tracks,
            }
        }));
    }

    let mut categories = Vec::new();
    for h in handles {
        if let Ok(cat) = h.await {
            if !cat.tracks.is_empty() {
                categories.push(cat);
            }
        }
    }

    if !categories.is_empty() {
        // Prefetch the very first track of the first category so pressing Play immediately has 0ms latency
        if let Some(first_track) = categories.first().and_then(|c| c.tracks.first()) {
            let innertube = state.innertube.clone();
            let vid = first_track.youtube_id.clone();
            tokio::spawn(async move {
                let _ = innertube.resolve_audio(&vid, false, AudioFormat::M4a).await;
            });
        }

        let mut cache = state.explore_cache.write().await;
        *cache = Some((categories.clone(), Instant::now() + EXPLORE_CACHE_TTL));
    }

    Json(json!({ "categories": categories })).into_response()
}
