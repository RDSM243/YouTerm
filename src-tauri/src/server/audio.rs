use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use url::Url;

use crate::state::AppState;
use crate::youtube::cipher::is_media_url;
use crate::youtube::innertube::AudioStreamError;
use crate::youtube::models::{AudioFormat, AudioSource};

#[derive(Debug, Deserialize)]
pub struct AudioQuery {
    pub format: Option<String>,
}

fn error_response(err: AudioStreamError) -> Response {
    let status = StatusCode::from_u16(err.status).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut res = (status, Json(json!({ "error": err.message }))).into_response();
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    res
}

/// GET /api/audio/:videoId and GET /api/audio/:videoId/metadata
pub async fn get_audio_metadata(
    Path(video_id): Path<String>,
    Query(query): Query<AudioQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let format = match AudioFormat::from_query(query.format.as_deref()) {
        Ok(f) => f,
        Err(msg) => return error_response(AudioStreamError::new(400, msg)),
    };

    match state.innertube.resolve_audio(&video_id, false, format).await {
        Ok(source) => {
            let suffix = if format == AudioFormat::Webm {
                "?format=webm"
            } else {
                ""
            };
            let mut res = Json(json!({
                "videoId": video_id,
                "duration": source.duration,
                "contentType": source.content_type,
                "streamUrl": format!("/api/audio/{}/stream{}", video_id, suffix),
            }))
            .into_response();
            res.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-store"),
            );
            res
        }
        Err(err) => error_response(err),
    }
}

/// OPTIONS /api/audio/:videoId/stream
pub async fn options_audio_stream() -> Response {
    let mut res = StatusCode::NO_CONTENT.into_response();
    set_cors_headers(res.headers_mut());
    res
}

fn set_cors_headers(headers: &mut HeaderMap) {
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Range"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Range, Content-Length, Accept-Ranges"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
}

/// GET/HEAD /api/audio/:videoId/stream
pub async fn stream_audio(
    method: Method,
    Path(video_id): Path<String>,
    Query(query): Query<AudioQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    let format = match AudioFormat::from_query(query.format.as_deref()) {
        Ok(f) => f,
        Err(msg) => return error_response(AudioStreamError::new(400, msg)),
    };

    let range_header = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Some(ref r) = range_header {
        let valid = regex::Regex::new(r"^bytes=(?:\d+-\d*|-\d+)$")
            .map(|re| re.is_match(r))
            .unwrap_or(false);
        if !valid {
            let mut res = (
                StatusCode::RANGE_NOT_SATISFIABLE,
                Json(json!({ "error": "Only a single byte range is supported." })),
            )
                .into_response();
            set_cors_headers(res.headers_mut());
            return res;
        }
    }

    let mut source = match state.innertube.resolve_audio(&video_id, false, format).await {
        Ok(s) => s,
        Err(err) => return error_response(err),
    };

    // Fast path: if this is an initial request (no Range, or Range: bytes=0-...) and we have a prefetched chunk in memory
    if method == Method::GET {
        if let Some(prefetched) = state.innertube.get_prefetched_chunk(&video_id, format).await {
            if let Some(total) = prefetched.total_length {
                let p_len = prefetched.data.len() as u64;
                if p_len > 0 && total >= p_len {
                    // Case A: Exact sub-range completely inside prefetched buffer (e.g. bytes=0-65535)
                    if let Some(ref r) = range_header {
                        if let Some((0, Some(req_end))) = parse_byte_range(r) {
                            let clamped_end = req_end.min(total - 1);
                            if clamped_end < p_len {
                                let slice = prefetched.data.slice(0..=(clamped_end as usize));
                                let mut res = Response::builder()
                                    .status(StatusCode::PARTIAL_CONTENT)
                                    .header(header::CONTENT_TYPE, &prefetched.content_type)
                                    .header(header::ACCEPT_RANGES, "bytes")
                                    .header(header::CONTENT_LENGTH, slice.len().to_string())
                                    .header(
                                        header::CONTENT_RANGE,
                                        format!("bytes 0-{}/{}", clamped_end, total),
                                    )
                                    .body(Body::from(slice))
                                    .unwrap();
                                set_cors_headers(res.headers_mut());
                                return res;
                            }
                        }
                    }

                    // Case B: Open-ended range `bytes=0-` or no Range header -> yield prefetched 512 KB in 0ms, then chain remainder!
                    let is_open_from_zero = match range_header.as_deref() {
                        None => true,
                        Some("bytes=0-") => true,
                        _ => false,
                    };

                    if is_open_from_zero {
                        let status = if range_header.is_some() {
                            StatusCode::PARTIAL_CONTENT
                        } else {
                            StatusCode::OK
                        };
                        let initial_bytes = prefetched.data.clone();
                        let http = state.innertube.http().clone();
                        let src_clone = source.clone();

                        let combined_stream = async_stream_from_prefetch(
                            http,
                            src_clone,
                            initial_bytes,
                            p_len,
                            total,
                        );

                        let mut builder = Response::builder()
                            .status(status)
                            .header(header::CONTENT_TYPE, &prefetched.content_type)
                            .header(header::ACCEPT_RANGES, "bytes")
                            .header(header::CONTENT_LENGTH, total.to_string());

                        if range_header.is_some() {
                            builder = builder.header(
                                header::CONTENT_RANGE,
                                format!("bytes 0-{}/{}", total - 1, total),
                            );
                        }

                        let mut res = builder.body(Body::from_stream(combined_stream)).unwrap();
                        set_cors_headers(res.headers_mut());
                        return res;
                    }
                }
            }
        }
    }

    // Standard streaming path from upstream googlevideo.com with automatic retry on 401/403/410
    let mut upstream = match open_upstream_media(
        state.innertube.http(),
        &source,
        range_header.as_deref(),
        0,
    )
    .await
    {
        Ok(resp) => resp,
        Err(err) => return error_response(err),
    };

    if matches!(upstream.status().as_u16(), 401 | 403 | 410) {
        source = match state.innertube.resolve_audio(&video_id, true, format).await {
            Ok(s) => s,
            Err(err) => return error_response(err),
        };
        upstream = match open_upstream_media(
            state.innertube.http(),
            &source,
            range_header.as_deref(),
            0,
        )
        .await
        {
            Ok(resp) => resp,
            Err(err) => return error_response(err),
        };
    }

    let status_code = upstream.status().as_u16();
    if status_code == 416 {
        let mut res = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
        set_cors_headers(res.headers_mut());
        if let Some(cr) = upstream.headers().get(header::CONTENT_RANGE) {
            res.headers_mut().insert(header::CONTENT_RANGE, cr.clone());
        }
        return res;
    }

    if !matches!(status_code, 200 | 206) {
        return error_response(AudioStreamError::new(
            502,
            "YouTube refused the audio stream. Please try again.",
        ));
    }

    let mut builder = Response::builder()
        .status(StatusCode::from_u16(status_code).unwrap_or(StatusCode::OK))
        .header(header::CONTENT_TYPE, &source.content_type);

    for name in [
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::ETAG,
        header::LAST_MODIFIED,
    ] {
        if let Some(val) = upstream.headers().get(&name) {
            builder = builder.header(name, val.clone());
        }
    }

    let mut res = if method == Method::HEAD {
        builder.body(Body::empty()).unwrap()
    } else {
        let stream = upstream
            .bytes_stream()
            .map(|res| res.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)));
        builder.body(Body::from_stream(stream)).unwrap()
    };

    set_cors_headers(res.headers_mut());
    res
}

fn parse_byte_range(range_str: &str) -> Option<(u64, Option<u64>)> {
    let rest = range_str.strip_prefix("bytes=")?;
    let (start_s, end_s) = rest.split_once('-')?;
    let start = start_s.parse::<u64>().ok()?;
    let end = if end_s.is_empty() {
        None
    } else {
        Some(end_s.parse::<u64>().ok()?)
    };
    Some((start, end))
}

fn async_stream_from_prefetch(
    http: reqwest::Client,
    source: AudioSource,
    initial_bytes: bytes::Bytes,
    offset: u64,
    total: u64,
) -> futures_util::stream::BoxStream<'static, Result<bytes::Bytes, std::io::Error>> {
    let initial = futures_util::stream::once(async move { Ok(initial_bytes) });
    if offset >= total {
        return initial.boxed();
    }

    let tail = futures_util::stream::once(async move {
        let range = format!("bytes={}-{}", offset, total - 1);
        match open_upstream_media(&http, &source, Some(&range), 0).await {
            Ok(resp) => resp
                .bytes_stream()
                .map(|r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)))
                .boxed(),
            Err(e) => futures_util::stream::once(async move {
                Err(std::io::Error::new(std::io::ErrorKind::Other, e.message))
            })
            .boxed(),
        }
    })
    .flatten();

    initial.chain(tail).boxed()
}

async fn open_upstream_media(
    http: &reqwest::Client,
    source: &AudioSource,
    range: Option<&str>,
    redirects: u8,
) -> Result<reqwest::Response, AudioStreamError> {
    let mut current_url = source.url.clone();
    let mut count = redirects;

    loop {
        let mut req = http
            .get(&current_url)
            .header(header::ACCEPT_ENCODING, "identity");

        for (k, v) in &source.headers {
            req = req.header(k, v);
        }
        if let Some(r) = range {
            req = req.header(header::RANGE, r);
        }

        let resp = req.send().await.map_err(|_| {
            AudioStreamError::new(502, "Could not connect to the audio server.")
        })?;

        if matches!(resp.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            if count >= 3 {
                return Err(AudioStreamError::new(502, "Too many audio server redirects."));
            }
            let Some(loc) = resp
                .headers()
                .get(header::LOCATION)
                .and_then(|v| v.to_str().ok())
            else {
                return Err(AudioStreamError::new(502, "Too many audio server redirects."));
            };
            let base = Url::parse(&current_url)
                .map_err(|_| AudioStreamError::new(502, "Invalid media URL."))?;
            let target = base
                .join(loc)
                .map_err(|_| AudioStreamError::new(502, "Unexpected audio server redirect."))?;
            if !is_media_url(&target) {
                return Err(AudioStreamError::new(
                    502,
                    "Unexpected audio server redirect.",
                ));
            }
            current_url = target.to_string();
            count += 1;
            continue;
        }

        return Ok(resp);
    }
}
