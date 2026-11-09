pub mod audio;
pub mod auth;
pub mod background;
pub mod explore;
pub mod fonts;
pub mod library;
pub mod lyrics;
pub mod proxy;
pub mod search;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, options, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
};
use url::Url;

use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct OpenExternalBody {
    pub url: Option<String>,
}

pub fn build_router(state: Arc<AppState>) -> Router {
    let index_file = state.static_dir.join("index.html");
    let serve_dir = ServeDir::new(&state.static_dir).not_found_service(ServeFile::new(index_file));

    Router::new()
        .route("/api/health", get(health_check))
        .route(
            "/api/background/image",
            get(background::get_image)
                .put(background::put_image)
                .delete(background::delete_image)
                .layer(DefaultBodyLimit::max(background::MAX_IMAGE_BYTES)),
        )
        .route("/api/search", get(search::search_tracks))
        .route("/api/search/suggestions", get(search::search_suggestions))
        .route("/api/resolve-track", get(search::resolve_track))
        .route("/api/explore", get(explore::get_explore))
        .route("/api/lyrics", get(lyrics::get_lyrics))
        .route("/api/audio/:videoId", get(audio::get_audio_metadata))
        .route(
            "/api/audio/:videoId/metadata",
            get(audio::get_audio_metadata),
        )
        .route(
            "/api/audio/:videoId/stream",
            options(audio::options_audio_stream)
                .get(audio::stream_audio)
                .head(audio::stream_audio),
        )
        .route("/api/image-proxy", get(proxy::image_proxy))
        .route("/api/system/fonts", get(fonts::get_system_fonts))
        .route("/api/auth/setup", get(auth::auth_setup))
        .route("/api/auth/url", get(auth::get_auth_url))
        .route("/api/auth/desktop/start", get(auth::desktop_auth_start))
        .route("/api/auth/desktop/result", get(auth::desktop_auth_result))
        .route("/auth/callback", get(auth::auth_callback))
        .route("/auth/callback/", get(auth::auth_callback))
        .route("/api/auth/token", post(auth::exchange_auth_token))
        .route("/api/user/playlists", get(library::get_user_playlists))
        .route("/api/user/liked", get(library::get_user_liked))
        .route("/api/playlist/fetch", get(library::fetch_playlist))
        .route("/api/tracks/:videoId/album", get(library::get_track_album))
        .route(
            "/api/tracks/durations",
            post(library::get_tracks_durations),
        )
        .route("/api/desktop/open-external", post(open_external_url))
        .route("/api/desktop/smoke-report", post(smoke_test_report))
        .fallback_service(serve_dir)
        .layer(CorsLayer::permissive())
        .with_state(state)
}

pub fn health_payload() -> Value {
    let has_api_key = std::env::var("YOUTUBE_API_KEY")
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    let has_oauth = std::env::var("GOOGLE_CLIENT_ID")
        .map(|s| !s.is_empty())
        .unwrap_or(false)
        && std::env::var("GOOGLE_CLIENT_SECRET")
            .map(|s| !s.is_empty())
            .unwrap_or(false);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    json!({
        "status": "ok",
        "service": "ytmusic-unix-tui",
        "engine": "rust-tauri-v2",
        "timestamp": ts,
        "hasApiKey": has_api_key,
        "hasOAuth": has_oauth,
        "supportsDesktopAuth": true,
        "runtime": "production",
    })
}

/// GET /api/health
pub async fn health_check() -> Response {
    Json(health_payload()).into_response()
}

/// POST /api/desktop/open-external
pub async fn open_external_url(
    State(state): State<Arc<AppState>>,
    Json(body): Json<OpenExternalBody>,
) -> Response {
    let Some(raw_url) = body.url.filter(|u| !u.is_empty() && u.len() <= 16384) else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let Ok(parsed) = Url::parse(&raw_url) else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let local_origin = format!("http://localhost:{}", state.port);
    let is_local_auth = raw_url.starts_with(&format!("{}/api/auth/", local_origin));
    let is_https = parsed.scheme() == "https";

    if is_https || is_local_auth {
        let _ = std::process::Command::new("xdg-open").arg(&raw_url).spawn();
        return Json(json!({ "ok": true })).into_response();
    }

    StatusCode::BAD_REQUEST.into_response()
}

/// POST /api/desktop/smoke-report
pub async fn smoke_test_report(
    State(state): State<Arc<AppState>>,
    Json(native_report): Json<Value>,
) -> Response {
    let full_report = json!({
        "native": native_report,
        "backend": health_payload(),
    });
    println!("{}", serde_json::to_string(&full_report).unwrap_or_default());

    let ok = native_report
        .get("bridge")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        && native_report
            .get("settings")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        && native_report
            .get("themes")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        && native_report
            .get("audio")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

    let handle_opt = state.app_handle.read().await.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
        if let Some(app) = handle_opt {
            app.exit(if ok { 0 } else { 1 });
        } else {
            std::process::exit(if ok { 0 } else { 1 });
        }
    });

    Json(json!({ "ok": ok })).into_response()
}
