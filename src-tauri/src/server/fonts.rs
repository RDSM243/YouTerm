use axum::{
    extract::State,
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use crate::state::AppState;

const DEFAULT_FALLBACK_FONTS: &[&str] = &[
    "JetBrains Mono",
    "Fira Code",
    "Ubuntu Mono",
    "DejaVu Sans Mono",
    "Liberation Mono",
    "Courier New",
];

/// GET /api/system/fonts
pub async fn get_system_fonts(State(state): State<Arc<AppState>>) -> Response {
    {
        let cache = state.fonts_cache.read().await;
        if let Some(ref cached) = *cache {
            let mut res = Json(json!({ "fonts": cached })).into_response();
            res.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-store"),
            );
            return res;
        }
    }

    let fonts = detect_monospace_fonts().await;
    {
        let mut cache = state.fonts_cache.write().await;
        *cache = Some(fonts.clone());
    }

    let mut res = Json(json!({ "fonts": fonts })).into_response();
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    res
}

async fn detect_monospace_fonts() -> Vec<String> {
    let mut fonts = BTreeSet::new();
    let weight_re = regex::Regex::new(
        r"(?i)\b(thin|light|extralight|ultralight|extrabold|ultrabold|demibold|semibold|black|heavy|medium|nfm)\b",
    )
    .ok();

    let mut cmd = tokio::process::Command::new("fc-list");
    cmd.args([":spacing=mono", "family"]);

    if let Ok(Ok(output)) = tokio::time::timeout(Duration::from_secs(4), cmd.output()).await {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                for raw in line.split(',') {
                    let name = raw.trim();
                    if name.is_empty() || name.contains('\\') || name.len() > 60 {
                        continue;
                    }
                    if let Some(ref re) = weight_re {
                        if re.is_match(name) {
                            continue;
                        }
                    }
                    fonts.insert(name.to_string());
                }
            }
        }
    }

    if fonts.is_empty() {
        for f in DEFAULT_FALLBACK_FONTS {
            fonts.insert((*f).to_string());
        }
    }

    let mut sorted: Vec<String> = fonts.into_iter().collect();
    sorted.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    sorted
}
