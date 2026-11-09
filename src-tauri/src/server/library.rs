use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use url::Url;

use crate::state::AppState;
use crate::youtube::cipher::{extract_session_cookies, is_valid_video_id};
use crate::youtube::innertube::extract_yt_initial_data;
use crate::youtube::models::{
    clean_artist_name, clean_track_title, format_duration_sec, parse_iso8601_duration, Playlist,
    Track,
};

#[derive(Debug, Deserialize)]
pub struct PlaylistFetchQuery {
    pub id: Option<String>,
    pub url: Option<String>,
    pub key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DurationsBody {
    pub ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ApiKeyQuery {
    pub key: Option<String>,
}

/// Resolve the album from the exact video in YouTube Music's watch queue.
pub async fn get_track_album(
    Path(video_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !is_valid_video_id(&video_id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid video ID" })),
        ).into_response();
    }
    if let Some((album, _)) = state.album_cache.read().await
        .get(&video_id)
        .filter(|(_, expires)| *expires > Instant::now())
    {
        return Json(json!({ "album": album })).into_response();
    }
    match state.innertube.fetch_track_album(&video_id).await {
        Ok(album) => {
            let mut cache = state.album_cache.write().await;
            cache.retain(|_, (_, expires)| *expires > Instant::now());
            if cache.len() >= 128 {
                if let Some(oldest) = cache.iter()
                    .min_by_key(|(_, (_, expires))| *expires)
                    .map(|(id, _)| id.clone())
                {
                    cache.remove(&oldest);
                }
            }
            let ttl = if album.is_some() { 6 * 60 * 60 } else { 5 * 60 };
            cache.insert(
                video_id,
                (album.clone(), Instant::now() + Duration::from_secs(ttl)),
            );
            Json(json!({ "album": album })).into_response()
        }
        Err(()) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "Could not load song album" })),
        ).into_response(),
    }
}

fn is_non_music_keyword(text: &str) -> bool {
    regex::Regex::new(
        r"(?i)\b(cs50[a-z0-9]*|web\s*dev|data\s*science|gamedev|godot|unity|unreal|programação|programming|curso|course|tutorial|aulas?|videos?\s+(de|sobre|para|da|do)|review|unboxing|gameplay|walkthrough|podcast\s*de)\b",
    )
    .map(|re| re.is_match(text))
    .unwrap_or(false)
}

fn is_music_item(item: &Value) -> bool {
    let snippet = item.get("snippet").unwrap_or(&Value::Null);
    let channel = snippet
        .get("videoOwnerChannelTitle")
        .or_else(|| snippet.get("channelTitle"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if snippet.get("categoryId").and_then(|v| v.as_str()) == Some("10") {
        return true;
    }

    let lower_channel = channel.to_lowercase();
    if lower_channel.ends_with(" - topic") || lower_channel.ends_with("vevo") {
        return true;
    }

    if let Some(topics) = item
        .pointer("/topicDetails/topicCategories")
        .and_then(|v| v.as_array())
    {
        for uri in topics {
            if let Some(u) = uri.as_str() {
                if regex::Regex::new(r"(?i)music|song|musician|singing|album|soundtrack")
                    .map(|re| re.is_match(u))
                    .unwrap_or(false)
                {
                    return true;
                }
            }
        }
    }

    if let Some(cat_id) = snippet.get("categoryId").and_then(|v| v.as_str()) {
        if matches!(
            cat_id,
            "1" | "2" | "15" | "17" | "20" | "22" | "23" | "24" | "25" | "26" | "27" | "28" | "29"
        ) {
            return false;
        }
    }

    let dur_str = item
        .pointer("/contentDetails/duration")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let duration = if dur_str.is_empty() {
        0
    } else {
        parse_iso8601_duration(dur_str)
    };
    if duration > 1200 {
        return false;
    }

    let title = snippet.get("title").and_then(|v| v.as_str()).unwrap_or("");
    if is_non_music_keyword(title) {
        return false;
    }

    true
}

fn is_music_track(track: &Track) -> bool {
    if track.duration > 1500 {
        return false;
    }
    if is_non_music_keyword(&track.title) {
        return false;
    }
    true
}

fn is_music_playlist(item: &Value, tracks: &[Track]) -> bool {
    let title = item
        .pointer("/snippet/title")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if is_non_music_keyword(title) {
        return false;
    }
    if tracks.is_empty() {
        return true;
    }
    let non_music_count = tracks
        .iter()
        .filter(|t| t.duration > 1200 || is_non_music_keyword(&t.title))
        .count();
    non_music_count != tracks.len()
}

fn item_to_track(item: &Value, is_liked: Option<bool>) -> Track {
    let snippet = item.get("snippet").unwrap_or(&Value::Null);
    let id = snippet
        .pointer("/resourceId/videoId")
        .or_else(|| item.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let dur_str = item
        .pointer("/contentDetails/duration")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let duration = parse_iso8601_duration(dur_str);

    let raw_title = snippet
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Title");
    let raw_artist = snippet
        .get("videoOwnerChannelTitle")
        .or_else(|| snippet.get("channelTitle"))
        .and_then(|v| v.as_str())
        .unwrap_or("YouTube Music");

    let thumb = snippet
        .pointer("/thumbnails/high/url")
        .or_else(|| snippet.pointer("/thumbnails/medium/url"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", id));

    Track {
        id: id.clone(),
        title: raw_title.to_string(),
        artist: clean_artist_name(raw_artist),
        album: String::new(),
        album_id: None,
        thumbnail_url: thumb,
        youtube_id: id,
        duration,
        duration_formatted: format_duration_sec(duration),
        source_type: None,
        priority_score: None,
        is_liked,
    }
}

async fn fetch_youtube_pages(
    http: &reqwest::Client,
    endpoint: &str,
    params: &[(&str, &str)],
    authorization: &str,
) -> Result<Vec<Value>, (u16, String)> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    let mut page_token = String::new();

    loop {
        let mut url =
            Url::parse(&format!("https://www.googleapis.com/youtube/v3/{}", endpoint)).unwrap();
        {
            let mut qp = url.query_pairs_mut();
            for (k, v) in params {
                qp.append_pair(k, v);
            }
            qp.append_pair("maxResults", "50");
            if !page_token.is_empty() {
                qp.append_pair("pageToken", &page_token);
            }
        }

        let resp = http
            .get(url.as_str())
            .header(header::AUTHORIZATION, authorization)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|_| {
                (
                    502,
                    "The server could not load your YouTube library. Check its internet connection and try again."
                        .to_string(),
                )
            })?;

        let status = resp.status().as_u16();
        let data: Value = resp.json().await.map_err(|_| {
            (
                502,
                "YouTube returned an invalid library response. Please try again.".to_string(),
            )
        })?;

        if !(200..300).contains(&status) || data.get("error").is_some() {
            let err_status = if (200..300).contains(&status) {
                data.pointer("/error/code")
                    .and_then(|v| v.as_u64())
                    .map(|c| c as u16)
                    .unwrap_or(502)
            } else {
                status
            };
            let msg = if err_status == 401 {
                "Your Google access token has expired or is invalid. Connect with Google again."
                    .to_string()
            } else if err_status == 403 {
                let detail = data
                    .pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Check the YouTube Data API and sign-in permissions.");
                format!("YouTube denied access. {}", detail)
            } else {
                data.pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("YouTube could not load your library. Please try again.")
                    .to_string()
            };
            return Err((err_status, msg));
        }

        let Some(arr) = data.get("items").and_then(|v| v.as_array()) else {
            return Err((
                502,
                "YouTube returned an invalid library response. Please try again.".to_string(),
            ));
        };

        items.extend(arr.iter().cloned());
        page_token = data
            .get("nextPageToken")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if page_token.is_empty() {
            break;
        }
        if !seen.insert(page_token.clone()) {
            return Err((
                502,
                "YouTube returned a repeated library page. Please try again.".to_string(),
            ));
        }
    }

    Ok(items)
}

enum UserAuthCreds {
    SessionCookies(String),
    OAuthBearer(String),
}

fn check_user_auth(headers: &HeaderMap) -> Result<UserAuthCreds, Response> {
    let auth = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim();

    if let Some(cookies) = extract_session_cookies(auth) {
        return Ok(UserAuthCreds::SessionCookies(cookies));
    }

    let valid = regex::Regex::new(r"^Bearer\s+\S+$")
        .map(|re| re.is_match(auth))
        .unwrap_or(false)
        && !auth.starts_with("Bearer AIza")
        && !auth.contains("ytm_session:");
    if !valid {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "Connect with Google or enter a valid session/OAuth token to sync your personal library. A YouTube API key cannot access your account."
            })),
        )
            .into_response());
    }
    Ok(UserAuthCreds::OAuthBearer(auth.to_string()))
}

/// GET /api/user/liked
pub async fn get_user_liked(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    let creds = match check_user_auth(&headers) {
        Ok(c) => c,
        Err(res) => return res,
    };

    if let UserAuthCreds::SessionCookies(cookies) = creds {
        return match state.innertube.fetch_authenticated_liked_tracks(&cookies).await {
            Ok(raw_tracks) => {
                let tracks: Vec<Track> = raw_tracks
                    .into_iter()
                    .filter(is_music_track)
                    .collect();
                Json(json!({ "tracks": tracks })).into_response()
            }
            Err((status, msg)) => (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(json!({ "error": msg })),
            )
                .into_response(),
        };
    }

    let UserAuthCreds::OAuthBearer(authorization) = creds else {
        unreachable!();
    };

    match fetch_youtube_pages(
        state.innertube.http(),
        "videos",
        &[
            ("part", "snippet,contentDetails,topicDetails"),
            ("myRating", "like"),
        ],
        &authorization,
    )
    .await
    {
        Ok(items) => {
            let tracks: Vec<Track> = items
                .into_iter()
                .filter(is_music_item)
                .map(|item| item_to_track(&item, Some(true)))
                .collect();
            Json(json!({ "tracks": tracks })).into_response()
        }
        Err((status, msg)) => (
            StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(json!({ "error": msg })),
        )
            .into_response(),
    }
}

/// GET /api/user/playlists
pub async fn get_user_playlists(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    let creds = match check_user_auth(&headers) {
        Ok(c) => c,
        Err(res) => return res,
    };

    if let UserAuthCreds::SessionCookies(cookies) = creds {
        return match state.innertube.fetch_authenticated_playlists(&cookies).await {
            Ok(raw_playlists) => {
                let mut playlists = Vec::new();
                for mut pl in raw_playlists {
                    if is_non_music_keyword(&pl.title) {
                        continue;
                    }
                    pl.tracks.retain(is_music_track);
                    if pl.tracks.is_empty() {
                        continue;
                    }
                    playlists.push(pl);
                }
                Json(json!({ "playlists": playlists })).into_response()
            }
            Err((status, msg)) => (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(json!({ "error": msg })),
            )
                .into_response(),
        };
    }

    let UserAuthCreds::OAuthBearer(authorization) = creds else {
        unreachable!();
    };

    let items = match fetch_youtube_pages(
        state.innertube.http(),
        "playlists",
        &[("part", "snippet,contentDetails"), ("mine", "true")],
        &authorization,
    )
    .await
    {
        Ok(items) => items,
        Err((status, msg)) => {
            return (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(json!({ "error": msg })),
            )
                .into_response()
        }
    };

    let mut playlists = Vec::new();
    for item in items {
        let Some(pl_id) = item.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let pl_title = item
            .pointer("/snippet/title")
            .and_then(|v| v.as_str())
            .unwrap_or("My Playlist");

        let entries = match fetch_youtube_pages(
            state.innertube.http(),
            "playlistItems",
            &[
                ("part", "snippet,contentDetails"),
                ("playlistId", pl_id),
            ],
            &authorization,
        )
        .await
        {
            Ok(e) => e,
            Err((status, msg)) => {
                return (
                    StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                    Json(json!({ "error": msg })),
                )
                    .into_response()
            }
        };

        let tracks: Vec<Track> = entries
            .into_iter()
            .filter(|entry| {
                let has_vid = entry
                    .pointer("/snippet/resourceId/videoId")
                    .and_then(|v| v.as_str())
                    .is_some();
                let title = entry
                    .pointer("/snippet/title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                has_vid && title != "Private video" && title != "Deleted video"
            })
            .map(|entry| item_to_track(&entry, None))
            .filter(is_music_track)
            .collect();

        if !is_music_playlist(&item, &tracks) {
            continue;
        }

        let thumb = item
            .pointer("/snippet/thumbnails/high/url")
            .or_else(|| item.pointer("/snippet/thumbnails/medium/url"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| tracks.first().map(|t| t.thumbnail_url.clone()));

        playlists.push(Playlist {
            id: pl_id.to_string(),
            title: pl_title.to_string(),
            description: item
                .pointer("/snippet/description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            author: item
                .pointer("/snippet/channelTitle")
                .and_then(|v| v.as_str())
                .unwrap_or("You")
                .to_string(),
            thumbnail_url: thumb,
            tracks,
            is_custom: true,
        });
    }

    Json(json!({ "playlists": playlists })).into_response()
}

/// GET /api/playlist/fetch
pub async fn fetch_playlist(
    Query(query): Query<PlaylistFetchQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    let mut playlist_id = query.id.unwrap_or_default();
    if let Some(ref pl_url) = query.url {
        if let Ok(parsed) = Url::parse(pl_url) {
            if let Some((_, list_val)) = parsed.query_pairs().find(|(k, _)| k == "list") {
                playlist_id = list_val.into_owned();
            }
        } else if let Ok(re) = regex::Regex::new(r"list=([a-zA-Z0-9_-]+)") {
            if let Some(caps) = re.captures(pl_url) {
                if let Some(m) = caps.get(1) {
                    playlist_id = m.as_str().to_string();
                }
            }
        }
    }

    if playlist_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing playlist id or url parameter" })),
        )
            .into_response();
    }

    let api_key = query
        .key
        .or_else(|| std::env::var("YOUTUBE_API_KEY").ok())
        .unwrap_or_default();
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let is_oauth_bearer =
        auth_header.starts_with("Bearer ") && !auth_header.contains("ytm_session:");

    // 1. Try YouTube Data API v3 if API key or OAuth Bearer token exists
    if !api_key.is_empty() || is_oauth_bearer {
        let mut req_headers = HeaderMap::new();
        let mut key_param = format!("&key={}", api_key);
        if is_oauth_bearer {
            if let Ok(hv) = auth_header.parse() {
                req_headers.insert(header::AUTHORIZATION, hv);
                key_param.clear();
            }
        }

        let pl_url = format!(
            "https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&id={}{}",
            playlist_id, key_param
        );
        let items_url = format!(
            "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId={}&maxResults=50{}",
            playlist_id, key_param
        );

        if let (Ok(pl_resp), Ok(items_resp)) = tokio::join!(
            state
                .innertube
                .http()
                .get(&pl_url)
                .headers(req_headers.clone())
                .send(),
            state
                .innertube
                .http()
                .get(&items_url)
                .headers(req_headers.clone())
                .send()
        ) {
            if let (Ok(pl_data), Ok(items_data)) =
                tokio::join!(pl_resp.json::<Value>(), items_resp.json::<Value>())
            {
                if let Some(items_arr) = items_data.get("items").and_then(|v| v.as_array()) {
                    if !items_arr.is_empty() {
                        let pl_snippet = pl_data
                            .pointer("/items/0/snippet")
                            .unwrap_or(&Value::Null);
                        let pl_title = pl_snippet
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Imported YouTube Playlist");

                        let mut tracks = Vec::new();
                        for item in items_arr {
                            let Some(vid) = item
                                .pointer("/snippet/resourceId/videoId")
                                .and_then(|v| v.as_str())
                            else {
                                continue;
                            };
                            let raw_title = item
                                .pointer("/snippet/title")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Unknown");
                            let raw_artist = item
                                .pointer("/snippet/videoOwnerChannelTitle")
                                .or_else(|| item.pointer("/snippet/channelTitle"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("YouTube Music");
                            let thumb = item
                                .pointer("/snippet/thumbnails/high/url")
                                .or_else(|| item.pointer("/snippet/thumbnails/medium/url"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| {
                                    format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", vid)
                                });

                            tracks.push(Track {
                                id: vid.to_string(),
                                title: clean_track_title(raw_title),
                                artist: clean_artist_name(raw_artist),
                                album: String::new(),
                                album_id: None,
                                thumbnail_url: thumb,
                                youtube_id: vid.to_string(),
                                duration: 210,
                                duration_formatted: "3:30".to_string(),
                                source_type: None,
                                priority_score: None,
                                is_liked: None,
                            });
                        }

                        if !tracks.is_empty() {
                            let thumb = pl_snippet
                                .pointer("/thumbnails/high/url")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .or_else(|| tracks.first().map(|t| t.thumbnail_url.clone()));

                            return Json(json!({
                                "playlist": Playlist {
                                    id: playlist_id,
                                    title: pl_title.to_string(),
                                    description: pl_snippet
                                        .get("description")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Imported from YouTube Music")
                                        .to_string(),
                                    author: pl_snippet
                                        .get("channelTitle")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("YouTube Curator")
                                        .to_string(),
                                    thumbnail_url: thumb,
                                    tracks,
                                    is_custom: true,
                                }
                            }))
                            .into_response();
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback: Scrape YouTube Web Playlist
    let web_url = format!("https://www.youtube.com/playlist?list={}", playlist_id);
    let Ok(resp) = state
        .innertube
        .http()
        .get(&web_url)
        .header(
            header::USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
        )
        .send()
        .await
    else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to fetch playlist page" })),
        )
            .into_response();
    };

    let Ok(html) = resp.text().await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to read playlist page" })),
        )
            .into_response();
    };

    if let Some(json_str) = extract_yt_initial_data(&html) {
        if let Ok(json) = serde_json::from_str::<Value>(json_str) {
            let header = json
                .pointer("/header/playlistHeaderRenderer")
                .or_else(|| {
                    json.pointer(
                        "/sidebar/playlistSidebarRenderer/items/0/playlistSidebarPrimaryInfoRenderer",
                    )
                })
                .unwrap_or(&Value::Null);

            let title = header
                .pointer("/title/simpleText")
                .or_else(|| header.pointer("/title/runs/0/text"))
                .or_else(|| json.pointer("/metadata/playlistMetadataRenderer/title"))
                .and_then(|v| v.as_str())
                .unwrap_or("Imported YouTube Playlist")
                .to_string();

            let author = header
                .pointer("/ownerText/runs/0/text")
                .or_else(|| header.pointer("/ownerText/simpleText"))
                .and_then(|v| v.as_str())
                .unwrap_or("YouTube Music")
                .to_string();

            let description = header
                .pointer("/descriptionText/simpleText")
                .or_else(|| header.pointer("/descriptionText/runs/0/text"))
                .and_then(|v| v.as_str())
                .unwrap_or("Imported Playlist from YouTube")
                .to_string();

            let mut tracks = Vec::new();
            if let Some(contents) = json
                .pointer("/contents/twoColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0/itemSectionRenderer/contents/0/playlistVideoListRenderer/contents")
                .and_then(|v| v.as_array())
            {
                for item in contents {
                    let Some(video) = item.get("playlistVideoRenderer") else {
                        continue;
                    };
                    let Some(vid) = video.get("videoId").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let v_title = video
                        .pointer("/title/runs/0/text")
                        .or_else(|| video.pointer("/title/simpleText"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown");
                    let v_artist = video
                        .pointer("/shortBylineText/runs/0/text")
                        .or_else(|| video.pointer("/shortBylineText/simpleText"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(&author);
                    let length_secs = video
                        .get("lengthSeconds")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<u32>().ok())
                        .unwrap_or(210);
                    let duration_text = video
                        .pointer("/lengthText/simpleText")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format_duration_sec(length_secs));
                    let thumb = video
                        .pointer("/thumbnail/thumbnails")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.last())
                        .and_then(|t| t.get("url"))
                        .and_then(|u| u.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", vid));

                    tracks.push(Track {
                        id: vid.to_string(),
                        title: clean_track_title(v_title),
                        artist: clean_artist_name(v_artist),
                        album: String::new(),
                        album_id: None,
                        thumbnail_url: thumb,
                        youtube_id: vid.to_string(),
                        duration: length_secs,
                        duration_formatted: duration_text,
                        source_type: None,
                        priority_score: None,
                        is_liked: None,
                    });
                }
            }

            if !tracks.is_empty() {
                let thumb = tracks.first().map(|t| t.thumbnail_url.clone());
                return Json(json!({
                    "playlist": Playlist {
                        id: playlist_id,
                        title,
                        description,
                        author,
                        thumbnail_url: thumb,
                        tracks,
                        is_custom: true,
                    }
                }))
                .into_response();
            }
        }
    }

    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "Could not find tracks in playlist" })),
    )
        .into_response()
}

/// POST /api/tracks/durations
pub async fn get_tracks_durations(
    Query(query): Query<ApiKeyQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Json(body): Json<DurationsBody>,
) -> Response {
    let ids = body.ids.unwrap_or_default();
    let unique_ids: Vec<String> = ids
        .into_iter()
        .filter(|id| id.len() == 11)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    if unique_ids.is_empty() {
        return Json(json!({ "durations": {} })).into_response();
    }

    let api_key = query
        .key
        .or_else(|| std::env::var("YOUTUBE_API_KEY").ok())
        .unwrap_or_default();
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let mut durations: HashMap<String, u32> = HashMap::new();
    let is_oauth_bearer =
        auth_header.starts_with("Bearer ") && !auth_header.contains("ytm_session:");

    if !api_key.is_empty() || is_oauth_bearer {
        let mut req_headers = HeaderMap::new();
        let mut key_param = format!("&key={}", api_key);
        if is_oauth_bearer {
            if let Ok(hv) = auth_header.parse() {
                req_headers.insert(header::AUTHORIZATION, hv);
                key_param.clear();
            }
        }

        for chunk in unique_ids.chunks(50) {
            let url = format!(
                "https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id={}{}",
                chunk.join(","),
                key_param
            );
            if let Ok(resp) = state
                .innertube
                .http()
                .get(&url)
                .headers(req_headers.clone())
                .send()
                .await
            {
                if let Ok(data) = resp.json::<Value>().await {
                    if let Some(items) = data.get("items").and_then(|v| v.as_array()) {
                        for item in items {
                            let Some(vid) = item.get("id").and_then(|v| v.as_str()) else {
                                continue;
                            };
                            let dur_str = item
                                .pointer("/contentDetails/duration")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let sec = parse_iso8601_duration(dur_str);
                            if sec > 0 && sec != 210 {
                                durations.insert(vid.to_string(), sec);
                            }
                        }
                    }
                }
            }
        }
    }

    Json(json!({ "durations": durations })).into_response()
}
