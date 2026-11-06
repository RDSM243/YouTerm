use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use url::Url;

use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ProxyQuery {
    pub url: Option<String>,
}

/// GET /api/image-proxy?url=...
pub async fn image_proxy(
    Query(query): Query<ProxyQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let Some(raw_url) = query.url.filter(|s| !s.trim().is_empty()) else {
        return (StatusCode::BAD_REQUEST, "Missing url").into_response();
    };

    let Ok(parsed_url) = Url::parse(&raw_url) else {
        return (StatusCode::BAD_REQUEST, "Invalid URL").into_response();
    };

    if !matches!(parsed_url.scheme(), "http" | "https") {
        return (StatusCode::BAD_REQUEST, "Invalid URL").into_response();
    }

    // Check in-memory LRU-like image cache for instant ASCII cover rendering
    {
        let cache = state.image_cache.read().await;
        if let Some((bytes, content_type, expires_at)) = cache.get(&raw_url) {
            if *expires_at > Instant::now() {
                return build_image_response(bytes.clone(), content_type);
            }
        }
    }

    let Ok(resp) = state
        .innertube
        .http()
        .get(parsed_url.as_str())
        .timeout(Duration::from_secs(10))
        .send()
        .await
    else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Error fetching image").into_response();
    };

    if !resp.status().is_success() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Error fetching image").into_response();
    }

    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let Ok(bytes) = resp.bytes().await else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Error reading image").into_response();
    };

    {
        let mut cache = state.image_cache.write().await;
        if cache.len() >= 64 {
            if let Some(first_key) = cache.keys().next().cloned() {
                cache.remove(&first_key);
            }
        }
        cache.insert(
            raw_url,
            (
                bytes.clone(),
                content_type.clone(),
                Instant::now() + Duration::from_secs(3600),
            ),
        );
    }

    build_image_response(bytes, &content_type)
}

fn build_image_response(bytes: bytes::Bytes, content_type: &str) -> Response {
    let mut res = Response::new(Body::from(bytes));
    if let Ok(ct) = HeaderValue::from_str(content_type) {
        res.headers_mut().insert(header::CONTENT_TYPE, ct);
    }
    res.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=86400"),
    );
    res
}
