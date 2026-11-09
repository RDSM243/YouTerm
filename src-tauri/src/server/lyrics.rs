use axum::{
    extract::{Query, State},
    http::{header::RETRY_AFTER, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

use crate::state::AppState;
use crate::youtube::models::{clean_artist_name, clean_track_title};

const CLIENT_ID: &str = concat!(
    "YouTerm v",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/RDSM243/YouTerm)"
);

#[derive(Debug, Deserialize, Serialize)]
pub struct LyricsQuery {
    title: String,
    artist: String,
    #[serde(default)]
    album: String,
    duration: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
    instrumental: bool,
    sync_available: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LyricsRecord {
    track_name: String,
    artist_name: String,
    #[serde(default)]
    album_name: String,
    duration: f64,
    instrumental: bool,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

#[derive(Default)]
struct LyricsCache {
    entries: HashMap<String, (Option<Lyrics>, Instant)>,
    retry_at: Option<Instant>,
}

#[derive(Default)]
pub struct LyricsService {
    // Serializes provider requests, including lookups for the same song.
    cache: Mutex<LyricsCache>,
}

enum LyricsError {
    Unavailable,
    RetryAfter(u64),
}

fn normalized(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn matching_record(record: &LyricsRecord, query: &LyricsQuery) -> bool {
    if normalized(&record.track_name) != normalized(&query.title)
        || normalized(&record.artist_name) != normalized(&query.artist)
        || !record.duration.is_finite()
    {
        return false;
    }
    // A music video can include an intro/outro. Allow its plain lyrics while
    // keeping live performances, remixes and substantially different lengths out.
    query
        .duration
        .is_none_or(|duration| (record.duration - duration).abs() <= (duration * 0.1).max(15.0))
}

fn record_lyrics(record: LyricsRecord, query: &LyricsQuery) -> Option<Lyrics> {
    if !matching_record(&record, query) {
        return None;
    }
    let plain = record.plain_lyrics.filter(|text| !text.trim().is_empty());
    let synced = record.synced_lyrics.filter(|text| !text.trim().is_empty());
    if !record.instrumental && plain.is_none() && synced.is_none() {
        return None;
    }
    Some(Lyrics {
        sync_available: synced.is_some()
            && query
                .duration
                .is_some_and(|duration| (record.duration - duration).abs() <= 2.0),
        instrumental: record.instrumental,
        plain_lyrics: plain,
        synced_lyrics: synced,
    })
}

impl LyricsService {
    async fn request<T: serde::de::DeserializeOwned>(
        &self,
        http: &reqwest::Client,
        endpoint: &str,
        params: &[(String, String)],
        cache: &mut LyricsCache,
    ) -> Result<Option<T>, LyricsError> {
        let response = http
            .get(format!("https://lrclib.net/api/{endpoint}"))
            .header("User-Agent", CLIENT_ID)
            .query(params)
            .send()
            .await
            .map_err(|_| LyricsError::Unavailable)?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE {
            let seconds = response
                .headers()
                .get(RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(60)
                .max(1);
            let delay = Duration::from_secs(seconds).saturating_add(Duration::from_millis(
                u64::from(rand::random::<u16>()) % 1000,
            ));
            cache.retry_at = Instant::now().checked_add(delay);
            return Err(LyricsError::RetryAfter(seconds.saturating_add(1)));
        }
        if !status.is_success() {
            return Err(LyricsError::Unavailable);
        }
        response
            .json()
            .await
            .map(Some)
            .map_err(|_| LyricsError::Unavailable)
    }

    async fn lookup(
        &self,
        http: &reqwest::Client,
        query: &LyricsQuery,
    ) -> Result<Option<Lyrics>, LyricsError> {
        let key = serde_json::to_string(query).map_err(|_| LyricsError::Unavailable)?;
        let mut cache = self.cache.lock().await;
        let now = Instant::now();
        cache.entries.retain(|_, (_, expires)| *expires > now);
        if let Some((lyrics, _)) = cache.entries.get(&key) {
            return Ok(lyrics.clone());
        }
        if let Some(retry_at) = cache.retry_at.filter(|retry_at| *retry_at > now) {
            return Err(LyricsError::RetryAfter((retry_at - now).as_secs() + 1));
        }

        let mut params = vec![
            ("track_name".into(), query.title.clone()),
            ("artist_name".into(), query.artist.clone()),
        ];
        if !query.album.is_empty() {
            params.push(("album_name".into(), query.album.clone()));
        }
        if let Some(duration) = query.duration {
            params.push(("duration".into(), duration.to_string()));
        }
        let mut lyrics = self
            .request::<LyricsRecord>(http, "get", &params, &mut cache)
            .await?
            .and_then(|record| record_lyrics(record, query));
        if lyrics.is_none() {
            // YouTube often labels the album with a playlist/video title. Search
            // without that field, then require the same song and artist locally.
            tokio::time::sleep(Duration::from_millis(250)).await;
            params.retain(|(key, _)| key == "track_name" || key == "artist_name");
            let mut records = self
                .request::<Vec<LyricsRecord>>(http, "search", &params, &mut cache)
                .await?
                .unwrap_or_default();
            records.retain(|record| matching_record(record, query));
            records.sort_by(|a, b| {
                let difference = |record: &LyricsRecord| {
                    query
                        .duration
                        .map_or(0.0, |duration| (record.duration - duration).abs())
                };
                difference(a)
                    .total_cmp(&difference(b))
                    .then_with(|| {
                        (normalized(&b.album_name) == normalized(&query.album))
                            .cmp(&(normalized(&a.album_name) == normalized(&query.album)))
                    })
                    .then_with(|| b.synced_lyrics.is_some().cmp(&a.synced_lyrics.is_some()))
            });
            lyrics = records
                .into_iter()
                .find_map(|record| record_lyrics(record, query));
        }

        if cache.entries.len() >= 128 {
            if let Some(oldest) = cache
                .entries
                .iter()
                .min_by_key(|(_, (_, expires))| *expires)
                .map(|(key, _)| key.clone())
            {
                cache.entries.remove(&oldest);
            }
        }
        let ttl = if lyrics.is_some() {
            6 * 60 * 60
        } else {
            5 * 60
        };
        cache.entries.insert(
            key,
            (lyrics.clone(), Instant::now() + Duration::from_secs(ttl)),
        );
        Ok(lyrics)
    }
}

/// GET /api/lyrics?title=...&artist=...&album=...&duration=...
pub async fn get_lyrics(
    Query(mut query): Query<LyricsQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if [&query.title, &query.artist, &query.album]
        .iter()
        .any(|value| value.len() > 512 || value.chars().any(char::is_control))
        || query.title.trim().is_empty()
        || query.artist.trim().is_empty()
        || query
            .duration
            .is_some_and(|duration| !duration.is_finite() || duration < 1.0)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid song metadata" })),
        )
            .into_response();
    }
    // Long mixes and full albums do not have a single matching song lyric.
    if query.duration.is_some_and(|duration| duration > 3600.0) {
        return Json(json!({ "lyrics": null })).into_response();
    }
    query.title = clean_track_title(&query.title);
    query.artist = clean_artist_name(&query.artist);
    query.album = query.album.trim().to_string();
    query.duration = query.duration.map(f64::round);
    match state.lyrics.lookup(state.innertube.http(), &query).await {
        Ok(lyrics) => Json(json!({ "lyrics": lyrics })).into_response(),
        Err(LyricsError::Unavailable) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "Lyrics service unavailable" })),
        )
            .into_response(),
        Err(LyricsError::RetryAfter(seconds)) => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(RETRY_AFTER, seconds.to_string())],
            Json(json!({ "error": "Lyrics service is busy. Please try again later." })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query() -> LyricsQuery {
        LyricsQuery {
            title: "Test Song".into(),
            artist: "Test Artist".into(),
            album: "Test Album".into(),
            duration: Some(180.0),
        }
    }
    fn record() -> LyricsRecord {
        LyricsRecord {
            track_name: "Test Song".into(),
            artist_name: "Test Artist".into(),
            album_name: "Test Album".into(),
            duration: 180.0,
            instrumental: false,
            plain_lyrics: Some("Example line".into()),
            synced_lyrics: Some("[00:01.00]Example line".into()),
        }
    }

    #[test]
    fn matches_names_without_losing_version_or_artist() {
        let mut song = record();
        song.track_name = "TEST: Song!".into();
        assert!(matching_record(&song, &query()));
        song.track_name = "Test Song (Live)".into();
        assert!(!matching_record(&song, &query()));
        song = record();
        song.artist_name = "Another Artist".into();
        assert!(!matching_record(&song, &query()));
        song = record();
        song.duration = 240.0;
        assert!(!matching_record(&song, &query()));
    }

    #[test]
    fn sync_requires_matching_duration() {
        assert!(record_lyrics(record(), &query()).unwrap().sync_available);
        let mut song = record();
        song.duration = 182.0;
        assert!(record_lyrics(song, &query()).unwrap().sync_available);
        let mut song = record();
        song.duration = 188.0;
        let lyrics = record_lyrics(song, &query()).unwrap();
        assert!(!lyrics.sync_available);
        assert!(lyrics.plain_lyrics.is_some());
        let mut unknown_duration = query();
        unknown_duration.duration = None;
        assert!(
            !record_lyrics(record(), &unknown_duration)
                .unwrap()
                .sync_available
        );
    }

    #[test]
    fn distinguishes_instrumental_from_missing_text() {
        let mut song = record();
        song.plain_lyrics = None;
        song.synced_lyrics = Some("  ".into());
        assert!(record_lyrics(song, &query()).is_none());
        let mut song = record();
        song.instrumental = true;
        song.plain_lyrics = None;
        song.synced_lyrics = None;
        assert!(record_lyrics(song, &query()).unwrap().instrumental);
    }
}
