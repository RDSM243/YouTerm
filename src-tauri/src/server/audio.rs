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
use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use url::Url;

use crate::state::AppState;
use crate::youtube::cipher::is_media_url;
use crate::youtube::innertube::AudioStreamError;
use crate::youtube::models::{AudioFormat, AudioSource};

#[derive(Debug, Deserialize)]
pub struct AudioQuery {
    pub format: Option<String>,
    pub eq: Option<u8>,
    pub bass: Option<f64>,
    pub mid: Option<f64>,
    pub treble: Option<f64>,
    pub sub: Option<f64>,
    pub pres: Option<f64>,
    pub air: Option<f64>,
    pub preamp: Option<f64>,
    pub pan: Option<f64>,
    pub comp: Option<u8>,
    pub mono: Option<u8>,
    pub bands: Option<String>,
}

static RAW_TRACK_CACHE: OnceLock<Mutex<VecDeque<(String, bytes::Bytes)>>> = OnceLock::new();
static EQ_TRACK_CACHE: OnceLock<Mutex<VecDeque<(String, bytes::Bytes)>>> = OnceLock::new();

fn raw_cache() -> &'static Mutex<VecDeque<(String, bytes::Bytes)>> {
    RAW_TRACK_CACHE.get_or_init(|| Mutex::new(VecDeque::with_capacity(2)))
}

fn eq_cache() -> &'static Mutex<VecDeque<(String, bytes::Bytes)>> {
    EQ_TRACK_CACHE.get_or_init(|| Mutex::new(VecDeque::with_capacity(2)))
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

    if query.eq == Some(1) {
        if let Some(eq_bytes) = process_equalized_audio(&state, &video_id, format, &mut source, &query).await {
            return serve_cached_bytes(&method, &eq_bytes, "audio/wav", range_header.as_deref());
        }
    }

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
                        let combined_stream = async_stream_from_prefetch(
                            state.clone(),
                            video_id.clone(),
                            format,
                            source.clone(),
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
        state.innertube.media_http(),
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
            state.innertube.media_http(),
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

    let (start_offset, end_inclusive) = parse_response_bounds(
        upstream.headers(),
        range_header.as_deref(),
    );

    let mut res = if method == Method::HEAD {
        builder.body(Body::empty()).unwrap()
    } else {
        let initial_stream = upstream.bytes_stream().boxed();
        let stream = resilient_byte_stream(
            state.clone(),
            video_id,
            format,
            source,
            start_offset,
            end_inclusive,
            Some(initial_stream),
        );
        builder.body(Body::from_stream(stream)).unwrap()
    };

    set_cors_headers(res.headers_mut());
    res
}

fn parse_response_bounds(headers: &HeaderMap, range_header: Option<&str>) -> (u64, Option<u64>) {
    if let Some(cr) = headers.get(header::CONTENT_RANGE).and_then(|v| v.to_str().ok()) {
        if let Some(rest) = cr.strip_prefix("bytes ") {
            if let Some((range_part, _total)) = rest.split_once('/') {
                if let Some((start_s, end_s)) = range_part.split_once('-') {
                    if let (Ok(start), Ok(end)) = (start_s.parse::<u64>(), end_s.parse::<u64>()) {
                        return (start, Some(end));
                    }
                }
            }
        }
    }
    let start = range_header
        .and_then(parse_byte_range)
        .map(|(s, _)| s)
        .unwrap_or(0);
    let content_len = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());
    let end = content_len.and_then(|len| if len > 0 { Some(start + len - 1) } else { None });
    (start, end)
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

struct ResilientStreamState {
    app_state: Arc<AppState>,
    video_id: String,
    format: AudioFormat,
    source: AudioSource,
    current_offset: u64,
    end_inclusive: Option<u64>,
    current_stream: Option<futures_util::stream::BoxStream<'static, Result<bytes::Bytes, reqwest::Error>>>,
    retries: u8,
}

fn resilient_byte_stream(
    app_state: Arc<AppState>,
    video_id: String,
    format: AudioFormat,
    source: AudioSource,
    start_offset: u64,
    end_inclusive: Option<u64>,
    initial_stream: Option<futures_util::stream::BoxStream<'static, Result<bytes::Bytes, reqwest::Error>>>,
) -> futures_util::stream::BoxStream<'static, Result<bytes::Bytes, std::io::Error>> {
    let state = ResilientStreamState {
        app_state,
        video_id,
        format,
        source,
        current_offset: start_offset,
        end_inclusive,
        current_stream: initial_stream,
        retries: 0,
    };

    futures_util::stream::unfold(state, |mut st| async move {
        loop {
            if let Some(end) = st.end_inclusive {
                if st.current_offset > end {
                    return None;
                }
            }

            if let Some(ref mut stream) = st.current_stream {
                match stream.next().await {
                    Some(Ok(chunk)) => {
                        if chunk.is_empty() {
                            continue;
                        }
                        st.current_offset += chunk.len() as u64;
                        st.retries = 0;
                        return Some((Ok(chunk), st));
                    }
                    Some(Err(_err)) => {
                        st.current_stream = None;
                        if st.retries >= 3 {
                            return Some((
                                Err(std::io::Error::new(
                                    std::io::ErrorKind::ConnectionReset,
                                    "Upstream audio stream interrupted",
                                )),
                                st,
                            ));
                        }
                    }
                    None => {
                        st.current_stream = None;
                        let premature = match st.end_inclusive {
                            Some(end) => st.current_offset <= end,
                            None => false,
                        };
                        if !premature || st.retries >= 3 {
                            return None;
                        }
                    }
                }
            }

            // Reconnect at exact byte offset (refreshing signed URL if needed)
            st.retries += 1;
            let force_refresh = st.retries >= 2;
            if force_refresh {
                if let Ok(fresh) = st
                    .app_state
                    .innertube
                    .resolve_audio(&st.video_id, true, st.format)
                    .await
                {
                    st.source = fresh;
                }
            }

            let range = match st.end_inclusive {
                Some(end) => format!("bytes={}-{}", st.current_offset, end),
                None => format!("bytes={}-", st.current_offset),
            };

            let mut resp = match open_upstream_media(
                st.app_state.innertube.media_http(),
                &st.source,
                Some(&range),
                0,
            )
            .await
            {
                Ok(r) => r,
                Err(e) => {
                    if st.retries >= 3 {
                        return Some((
                            Err(std::io::Error::new(std::io::ErrorKind::Other, e.message)),
                            st,
                        ));
                    }
                    continue;
                }
            };

            if matches!(resp.status().as_u16(), 401 | 403 | 410) {
                if let Ok(fresh) = st
                    .app_state
                    .innertube
                    .resolve_audio(&st.video_id, true, st.format)
                    .await
                {
                    st.source = fresh;
                    if let Ok(retry_resp) = open_upstream_media(
                        st.app_state.innertube.media_http(),
                        &st.source,
                        Some(&range),
                        0,
                    )
                    .await
                    {
                        resp = retry_resp;
                    }
                }
            }

            if !matches!(resp.status().as_u16(), 200 | 206) {
                if st.retries >= 3 {
                    return Some((
                        Err(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            "Upstream audio stream refused resume",
                        )),
                        st,
                    ));
                }
                continue;
            }

            // Avoid duplicating bytes if upstream ignored Range and returned 200 from byte 0
            if resp.status().as_u16() == 200 && st.current_offset > 0 {
                return Some((
                    Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "Upstream ignored byte-range resume",
                    )),
                    st,
                ));
            }

            st.current_stream = Some(resp.bytes_stream().boxed());
        }
    })
    .boxed()
}

fn async_stream_from_prefetch(
    app_state: Arc<AppState>,
    video_id: String,
    format: AudioFormat,
    source: AudioSource,
    initial_bytes: bytes::Bytes,
    offset: u64,
    total: u64,
) -> futures_util::stream::BoxStream<'static, Result<bytes::Bytes, std::io::Error>> {
    let initial = futures_util::stream::once(async move { Ok(initial_bytes) });
    if offset >= total {
        return initial.boxed();
    }

    let tail = resilient_byte_stream(
        app_state,
        video_id,
        format,
        source,
        offset,
        Some(total - 1),
        None,
    );

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

fn serve_cached_bytes(
    method: &Method,
    data: &bytes::Bytes,
    content_type: &str,
    range_header: Option<&str>,
) -> Response {
    let total = data.len() as u64;
    if total == 0 {
        let mut res = StatusCode::BAD_GATEWAY.into_response();
        set_cors_headers(res.headers_mut());
        return res;
    }

    if let Some(r) = range_header {
        if let Some((start, end_opt)) = parse_byte_range(r) {
            if start >= total {
                let mut res = Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{}", total))
                    .body(Body::empty())
                    .unwrap();
                set_cors_headers(res.headers_mut());
                return res;
            }
            let end = end_opt.unwrap_or(total - 1).min(total - 1);
            if end < start {
                let mut res = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
                set_cors_headers(res.headers_mut());
                return res;
            }
            let slice = data.slice((start as usize)..=(end as usize));
            let body = if *method == Method::HEAD {
                Body::empty()
            } else {
                Body::from(slice.clone())
            };
            let mut res = Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, ((end - start) + 1).to_string())
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", start, end, total),
                )
                .body(body)
                .unwrap();
            set_cors_headers(res.headers_mut());
            return res;
        }
    }

    let body = if *method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(data.clone())
    };
    let mut res = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, total.to_string())
        .body(body)
        .unwrap();
    set_cors_headers(res.headers_mut());
    res
}

async fn fetch_raw_track_bytes(
    state: &Arc<AppState>,
    video_id: &str,
    format: AudioFormat,
    source: &mut AudioSource,
) -> Option<bytes::Bytes> {
    let raw_key = format!("{}:{:?}", video_id, format);
    {
        let cache = raw_cache().lock().await;
        if let Some((_, bytes)) = cache.iter().find(|(k, _)| k == &raw_key) {
            return Some(bytes.clone());
        }
    }

    let mut resp = open_upstream_media(state.innertube.media_http(), source, None, 0)
        .await
        .ok()?;
    if matches!(resp.status().as_u16(), 401 | 403 | 410) {
        *source = state
            .innertube
            .resolve_audio(video_id, true, format)
            .await
            .ok()?;
        resp = open_upstream_media(state.innertube.media_http(), source, None, 0)
            .await
            .ok()?;
    }
    if !matches!(resp.status().as_u16(), 200 | 206) {
        return None;
    }

    let data = resp.bytes().await.ok()?;
    if data.is_empty() {
        return None;
    }

    let mut cache = raw_cache().lock().await;
    cache.retain(|(k, _)| k != &raw_key);
    if cache.len() >= 2 {
        cache.pop_front();
    }
    cache.push_back((raw_key, data.clone()));
    Some(data)
}

async fn process_equalized_audio(
    state: &Arc<AppState>,
    video_id: &str,
    format: AudioFormat,
    source: &mut AudioSource,
    query: &AudioQuery,
) -> Option<bytes::Bytes> {
    let bass = query.bass.unwrap_or(0.0).clamp(-24.0, 12.0);
    let mid = query.mid.unwrap_or(0.0).clamp(-24.0, 12.0);
    let treble = query.treble.unwrap_or(0.0).clamp(-24.0, 12.0);
    let sub = query.sub.unwrap_or(0.0).clamp(-12.0, 12.0);
    let pres = query.pres.unwrap_or(0.0).clamp(-12.0, 12.0);
    let air = query.air.unwrap_or(0.0).clamp(-12.0, 12.0);
    let preamp_db = query.preamp.unwrap_or(0.0).clamp(-18.0, 12.0);
    let pan = query.pan.unwrap_or(0.0).clamp(-1.0, 1.0);
    let comp = query.comp.unwrap_or(0) == 1;
    let mono = query.mono.unwrap_or(0) == 1;

    let mut bands = [0.0f64; 10];
    if let Some(ref b_str) = query.bands {
        for (i, part) in b_str.split(',').take(10).enumerate() {
            if let Ok(val) = part.trim().parse::<f64>() {
                bands[i] = val.clamp(-24.0, 12.0);
            }
        }
    }
    // Fold sub-bass (55Hz), vocal presence (2.8kHz), and air (13.5kHz) contours into their matching ISO bands
    bands[0] = (bands[0] + sub * 0.85).clamp(-24.0, 12.0);
    bands[1] = (bands[1] + sub * 0.95).clamp(-24.0, 12.0);
    bands[6] = (bands[6] + pres * 0.75).clamp(-24.0, 12.0);
    bands[7] = (bands[7] + pres * 0.85).clamp(-24.0, 12.0);
    bands[8] = (bands[8] + air * 0.70).clamp(-24.0, 12.0);
    bands[9] = (bands[9] + air * 0.95).clamp(-24.0, 12.0);

    let eq_key = format!(
        "{}:{:.1}:{:.1}:{:.1}:{:.1}:{:.2}:{}:{}:{:.1},{:.1},{:.1},{:.1},{:.1},{:.1},{:.1},{:.1},{:.1},{:.1}",
        video_id,
        bass,
        mid,
        treble,
        preamp_db,
        pan,
        comp as u8,
        mono as u8,
        bands[0],
        bands[1],
        bands[2],
        bands[3],
        bands[4],
        bands[5],
        bands[6],
        bands[7],
        bands[8],
        bands[9]
    );

    {
        let cache = eq_cache().lock().await;
        if let Some((_, bytes)) = cache.iter().find(|(k, _)| k == &eq_key) {
            return Some(bytes.clone());
        }
    }

    let raw_bytes = fetch_raw_track_bytes(state, video_id, format, source).await?;
    let amp = 10.0f64.powf(preamp_db / 20.0).clamp(0.1, 4.0);

    let mut args: Vec<String> = vec![
        "-q".to_string(),
        "fdsrc".to_string(),
        "!".to_string(),
        "decodebin".to_string(),
        "!".to_string(),
        "audioconvert".to_string(),
        "!".to_string(),
        "audioamplify".to_string(),
        format!("amplification={:.3}", amp),
        "!".to_string(),
        "equalizer-3bands".to_string(),
        format!("band0={:.2}", bass),
        format!("band1={:.2}", mid),
        format!("band2={:.2}", treble),
        "!".to_string(),
        "equalizer-10bands".to_string(),
    ];

    for (i, b) in bands.iter().enumerate() {
        args.push(format!("band{}={:.2}", i, b));
    }

    if comp {
        args.extend([
            "!".to_string(),
            "audiodynamic".to_string(),
            "characteristics=soft-knee".to_string(),
            "mode=compressor".to_string(),
            "threshold=0.25".to_string(),
            "ratio=2.5".to_string(),
        ]);
    }

    if pan.abs() >= 0.01 {
        args.extend([
            "!".to_string(),
            "audiopanorama".to_string(),
            format!("panorama={:.2}", pan),
        ]);
    }

    if mono {
        args.extend([
            "!".to_string(),
            "audioconvert".to_string(),
            "!".to_string(),
            "audio/x-raw,channels=1".to_string(),
            "!".to_string(),
            "audioconvert".to_string(),
            "!".to_string(),
            "audio/x-raw,format=S16LE,channels=2".to_string(),
        ]);
    } else {
        args.extend([
            "!".to_string(),
            "audioconvert".to_string(),
            "!".to_string(),
            "audio/x-raw,format=S16LE".to_string(),
        ]);
    }

    args.extend([
        "!".to_string(),
        "wavenc".to_string(),
        "!".to_string(),
        "fdsink".to_string(),
    ]);

    let mut child = Command::new("gst-launch-1.0")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    if let Some(mut stdin) = child.stdin.take() {
        let input = raw_bytes.clone();
        tokio::spawn(async move {
            let _ = stdin.write_all(&input).await;
            let _ = stdin.shutdown().await;
        });
    }

    let output = child.wait_with_output().await.ok()?;
    if !output.status.success() || output.stdout.len() <= 44 {
        return None;
    }

    // Patch WAV RIFF/data chunk header lengths when fdsink was non-seekable so WebKitGTK can seek accurately
    let mut wav = output.stdout;
    let total_len = wav.len();
    if total_len > 44 && &wav[0..4] == b"RIFF" && &wav[8..12] == b"WAVE" {
        let riff_size = ((total_len - 8) as u32).to_le_bytes();
        wav[4..8].copy_from_slice(&riff_size);
        // Locate the "data" subchunk header inside the first 128 bytes
        let search_end = total_len.min(128);
        for offset in 12..(search_end - 8) {
            if &wav[offset..offset + 4] == b"data" {
                let data_size = ((total_len - (offset + 8)) as u32).to_le_bytes();
                wav[offset + 4..offset + 8].copy_from_slice(&data_size);
                break;
            }
        }
    }

    let result = bytes::Bytes::from(wav);
    let mut cache = eq_cache().lock().await;
    cache.retain(|(k, _)| k != &eq_key);
    if cache.len() >= 2 {
        cache.pop_front();
    }
    cache.push_back((eq_key, result.clone()));
    Some(result)
}
