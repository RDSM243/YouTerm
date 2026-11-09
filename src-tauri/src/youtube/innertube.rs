use bytes::Bytes;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, RwLock};
use url::Url;

use crate::youtube::albums::album_from_runs;
use crate::youtube::cipher::{
    build_sapisidhash_header, is_media_url, is_valid_video_id, parse_signature_cipher, urlencode,
};
use crate::youtube::models::{
    clean_artist_name, clean_track_title, format_duration_sec, parse_duration_str, AudioFormat,
    AudioSource, Playlist, ResolvedAudio, Track,
};

const USER_AGENT_WEB: &str =
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0";
const USER_AGENT_YTM: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const USER_AGENT_VISIONOS: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

const PREFETCH_BYTES: usize = 512 * 1024; // 512 KB initial buffer for 0ms playback start

#[derive(Debug, Clone)]
pub struct AudioStreamError {
    pub status: u16,
    pub message: String,
}

impl AudioStreamError {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for AudioStreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AudioStreamError {}

#[derive(Debug, Clone)]
pub struct PrefetchedChunk {
    pub data: Bytes,
    pub total_length: Option<u64>,
    pub content_type: String,
    pub expires_at: Instant,
}

#[derive(Clone)]
pub struct InnerTubeClient {
    http: reqwest::Client,
    visitor_data: Arc<RwLock<Option<String>>>,
    audio_cache: Arc<RwLock<HashMap<String, Result<ResolvedAudio, (AudioStreamError, Instant)>>>>,
    inflight: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    prefetch_cache: Arc<RwLock<HashMap<(String, AudioFormat), PrefetchedChunk>>>,
}

impl Default for InnerTubeClient {
    fn default() -> Self {
        Self::new()
    }
}

impl InnerTubeClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .pool_max_idle_per_host(24)
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_nodelay(true)
            .timeout(Duration::from_secs(12))
            .build()
            .unwrap_or_default();

        Self {
            http,
            visitor_data: Arc::new(RwLock::new(None)),
            audio_cache: Arc::new(RwLock::new(HashMap::new())),
            inflight: Arc::new(Mutex::new(HashMap::new())),
            prefetch_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// Ensure we have a valid YouTube InnerTube `visitorData` token in memory
    pub(super) async fn ensure_visitor_data(&self) -> Option<String> {
        {
            let guard = self.visitor_data.read().await;
            if let Some(ref vd) = *guard {
                if !vd.is_empty() {
                    return Some(vd.clone());
                }
            }
        }

        let payload = serde_json::json!({
            "context": {
                "client": {
                    "clientName": "WEB_REMIX",
                    "clientVersion": "1.20240318.01.00",
                    "hl": "pt",
                    "gl": "BR"
                }
            }
        });

        if let Ok(resp) = self
            .http
            .post("https://music.youtube.com/youtubei/v1/guide?prettyPrint=false")
            .header("Content-Type", "application/json")
            .header("User-Agent", USER_AGENT_YTM)
            .header("Origin", "https://music.youtube.com")
            .json(&payload)
            .send()
            .await
        {
            if let Ok(body) = resp.json::<Value>().await {
                if let Some(vd) = body
                    .pointer("/responseContext/visitorData")
                    .and_then(|v| v.as_str())
                {
                    if !vd.is_empty() {
                        let mut guard = self.visitor_data.write().await;
                        *guard = Some(vd.to_string());
                        return Some(vd.to_string());
                    }
                }
            }
        }

        None
    }

    async fn update_visitor_data_from_response(&self, body: &Value) {
        if let Some(vd) = body
            .pointer("/responseContext/visitorData")
            .and_then(|v| v.as_str())
        {
            if !vd.is_empty() {
                let mut guard = self.visitor_data.write().await;
                if guard.is_none() {
                    *guard = Some(vd.to_string());
                }
            }
        }
    }

    /// Direct YouTube Music InnerTube Search (WEB_REMIX)
    pub async fn search_innertube(&self, query: &str) -> Vec<Track> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let payload = serde_json::json!({
            "context": {
                "client": {
                    "clientName": "WEB_REMIX",
                    "clientVersion": "1.20240318.01.00",
                    "hl": "pt",
                    "gl": "BR"
                }
            },
            "query": trimmed,
            "params": "Eg-KAQwIARAAGAAgACgAMABqChAEEAMQCRAFEAo%3D"
        });

        let Ok(resp) = self
            .http
            .post("https://music.youtube.com/youtubei/v1/search?prettyPrint=false")
            .header("Content-Type", "application/json")
            .header("User-Agent", USER_AGENT_YTM)
            .header("Origin", "https://music.youtube.com")
            .header("Referer", "https://music.youtube.com/")
            .timeout(Duration::from_secs(6))
            .json(&payload)
            .send()
            .await
        else {
            return Vec::new();
        };

        let Ok(body) = resp.json::<Value>().await else {
            return Vec::new();
        };

        self.update_visitor_data_from_response(&body).await;

        let mut tracks = Vec::new();
        let Some(sections) = body
            .pointer("/contents/tabbedSearchResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents")
            .and_then(|v| v.as_array())
        else {
            return tracks;
        };

        for section in sections {
            let items = section
                .pointer("/musicShelfRenderer/contents")
                .or_else(|| section.pointer("/musicCardShelfRenderer/contents"))
                .or_else(|| section.pointer("/itemSectionRenderer/contents"))
                .and_then(|v| v.as_array());

            let Some(items) = items else { continue };
            for item in items {
                if let Some(track) = Self::parse_innertube_search_item(item) {
                    tracks.push(track);
                }
            }
        }

        tracks
    }

    fn parse_innertube_search_item(item: &Value) -> Option<Track> {
        let flex = item.get("musicResponsiveListItemRenderer")?;

        let title_runs = flex
            .pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs")
            .and_then(|v| v.as_array())?;
        let raw_title = title_runs
            .iter()
            .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("");

        let sub_runs = flex
            .pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/text/runs")
            .and_then(|v| v.as_array());

        let mut artist = "YouTube Music".to_string();
        let album = album_from_runs(flex.get("flexColumns").unwrap_or(&Value::Null));
        let mut duration_formatted = String::new();
        let mut sec: u32 = 0;

        if let Some(runs) = sub_runs {
            if let Some(first) = runs
                .first()
                .and_then(|r| r.get("text"))
                .and_then(|t| t.as_str())
            {
                artist = first.to_string();
            }
        }

        // Check all flexColumns and fixedColumns for a duration matching M:SS or H:MM:SS
        let dur_re = regex::Regex::new(r"^\d+:\d+(?::\d+)?$").ok()?;
        let empty = Vec::new();
        let flex_cols = flex
            .get("flexColumns")
            .and_then(|v| v.as_array())
            .unwrap_or(&empty);
        let fixed_cols = flex
            .get("fixedColumns")
            .and_then(|v| v.as_array())
            .unwrap_or(&empty);

        for col in flex_cols.iter().chain(fixed_cols.iter()) {
            let runs = col
                .pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs")
                .or_else(|| col.pointer("/musicResponsiveListItemFixedColumnRenderer/text/runs"))
                .and_then(|v| v.as_array());
            if let Some(runs) = runs {
                for r in runs {
                    let txt = r.get("text").and_then(|t| t.as_str()).unwrap_or("").trim();
                    if dur_re.is_match(txt) {
                        let parsed = parse_duration_str(txt);
                        if parsed > 0 {
                            sec = parsed;
                            duration_formatted = txt.to_string();
                            break;
                        }
                    }
                }
            }
            if sec == 0 {
                if let Some(simple) = col
                    .pointer("/musicResponsiveListItemFixedColumnRenderer/text/simpleText")
                    .or_else(|| col.pointer("/musicResponsiveListItemFlexColumnRenderer/text/simpleText"))
                    .and_then(|v| v.as_str())
                {
                    let txt = simple.trim();
                    if dur_re.is_match(txt) {
                        let parsed = parse_duration_str(txt);
                        if parsed > 0 {
                            sec = parsed;
                            duration_formatted = txt.to_string();
                        }
                    }
                }
            }
            if sec > 0 {
                break;
            }
        }

        let video_id = flex
            .pointer("/playlistItemData/videoId")
            .or_else(|| flex.pointer("/doubleTapCommand/watchEndpoint/videoId"))
            .or_else(|| {
                flex.pointer(
                    "/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId",
                )
            })
            .or_else(|| flex.pointer("/navigationEndpoint/watchEndpoint/videoId"))
            .and_then(|v| v.as_str())?;

        if !is_valid_video_id(video_id) {
            return None;
        }

        let thumb = flex
            .pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|u| u.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id));

        let final_sec = if sec > 0 { sec } else { 210 };
        let final_fmt = if !duration_formatted.is_empty() {
            duration_formatted
        } else {
            format_duration_sec(final_sec)
        };

        Some(Track {
            id: video_id.to_string(),
            title: clean_track_title(&raw_title),
            artist: clean_artist_name(&artist),
            album: album.as_ref()
                .map(|album| album.name.clone())
                .unwrap_or_default(),
            album_id: album.map(|album| album.id),
            thumbnail_url: thumb,
            youtube_id: video_id.to_string(),
            duration: final_sec,
            duration_formatted: final_fmt,
            source_type: Some("yt_music".to_string()),
            priority_score: Some(2000),
            is_liked: None,
        })
    }

    /// Scrape YouTube search HTML for topic/official audio tracks
    pub async fn search_scraping(&self, query: &str) -> Vec<Track> {
        let url = format!(
            "https://www.youtube.com/results?search_query={}",
            urlencode(query)
        );
        let Ok(resp) = self
            .http
            .get(&url)
            .header("User-Agent", USER_AGENT_WEB)
            .header("Accept-Language", "en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7")
            .timeout(Duration::from_secs(6))
            .send()
            .await
        else {
            return Vec::new();
        };

        let Ok(html) = resp.text().await else {
            return Vec::new();
        };

        Self::parse_youtube_search_html(&html)
    }

    pub fn parse_youtube_search_html(html: &str) -> Vec<Track> {
        let mut items = Vec::new();
        let Some(json_str) = extract_yt_initial_data(html) else {
            return items;
        };
        let Ok(json) = serde_json::from_str::<Value>(json_str) else {
            return items;
        };

        let Some(section_contents) = json
            .pointer("/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents")
            .and_then(|v| v.as_array())
        else {
            return items;
        };

        for section in section_contents {
            let Some(contents) = section
                .pointer("/itemSectionRenderer/contents")
                .and_then(|v| v.as_array())
            else {
                continue;
            };

            for c in contents {
                let Some(video) = c.get("videoRenderer") else {
                    continue;
                };
                let Some(video_id) = video.get("videoId").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !is_valid_video_id(video_id) {
                    continue;
                }

                let raw_title = video
                    .pointer("/title/runs/0/text")
                    .or_else(|| video.pointer("/title/simpleText"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown Title");

                let raw_artist = video
                    .pointer("/ownerText/runs/0/text")
                    .or_else(|| video.pointer("/longBylineText/runs/0/text"))
                    .or_else(|| video.pointer("/shortBylineText/runs/0/text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Artist");

                let mut duration_text = video
                    .pointer("/lengthText/simpleText")
                    .or_else(|| video.pointer("/lengthText/runs/0/text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                if duration_text.is_empty() {
                    if let Some(overlays) =
                        video.get("thumbnailOverlays").and_then(|v| v.as_array())
                    {
                        for o in overlays {
                            if let Some(t) = o
                                .pointer("/thumbnailOverlayTimeStatusRenderer/text/simpleText")
                                .or_else(|| {
                                    o.pointer(
                                        "/thumbnailOverlayTimeStatusRenderer/text/runs/0/text",
                                    )
                                })
                                .and_then(|v| v.as_str())
                            {
                                duration_text = t.to_string();
                                break;
                            }
                        }
                    }
                }

                let mut sec = parse_duration_str(&duration_text);
                if duration_text.is_empty() || sec == 0 {
                    duration_text = "3:30".to_string();
                    sec = 210;
                }

                let thumb = video
                    .pointer("/thumbnail/thumbnails")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|t| t.get("url"))
                    .and_then(|u| u.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| {
                        format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id)
                    });

                let lower_artist = raw_artist.to_lowercase();
                let lower_title = raw_title.to_lowercase();

                let (source_type, priority_score) =
                    if lower_artist.contains("- topic") || lower_artist.contains("topic") {
                        ("yt_music", 1000)
                    } else if lower_title.contains("official audio")
                        || lower_title.contains("audio official")
                        || lower_title.contains("[audio]")
                        || lower_title.contains("(audio)")
                    {
                        ("official_audio", 500)
                    } else if lower_title.contains("lyric")
                        || lower_title.contains("letra")
                        || lower_title.contains("visualizer")
                    {
                        ("lyric_video", 300)
                    } else if lower_title.contains("official music video")
                        || lower_title.contains("official video")
                    {
                        ("video", 80)
                    } else {
                        ("video", 100)
                    };

                items.push(Track {
                    id: video_id.to_string(),
                    title: clean_track_title(raw_title),
                    artist: clean_artist_name(raw_artist),
                    album: String::new(),
                    album_id: None,
                    thumbnail_url: thumb,
                    youtube_id: video_id.to_string(),
                    duration: sec,
                    duration_formatted: duration_text,
                    source_type: Some(source_type.to_string()),
                    priority_score: Some(priority_score),
                    is_liked: None,
                });
            }
        }

        items
    }

    /// Warm the InnerTube visitorData token and TLS connection pools in background at startup
    pub async fn warm_connections(&self) {
        let _ = self.ensure_visitor_data().await;
        // Also pre-establish TLS/HTTP2 session to www.youtube.com
        let _ = self
            .http
            .head("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
            .header("User-Agent", USER_AGENT_VISIONOS)
            .send()
            .await;
    }

    /// Combined search: fast InnerTube WEB_REMIX search (~220ms) + background prefetch of top tracks
    pub async fn search_combined(&self, query: &str) -> (Vec<Track>, &'static str) {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return (Vec::new(), "youtube_music_direct");
        }

        // 1. Fast path: Direct YouTube Music InnerTube database (~200-280ms)
        let yt_music = self.search_innertube(trimmed).await;
        if !yt_music.is_empty() {
            for track in yt_music.iter().take(2) {
                let client = self.clone();
                let vid = track.youtube_id.clone();
                tokio::spawn(async move {
                    let _ = client.resolve_audio(&vid, false, AudioFormat::M4a).await;
                });
            }
            return (yt_music, "youtube_music_direct");
        }

        // 2. Fallback: scrape Topic and Official Audio search results
        let topic_query = format!("{} - Topic", trimmed);
        let audio_query = format!("{} official audio", trimmed);

        let (topic_items, audio_items) = tokio::join!(
            self.search_scraping(&topic_query),
            self.search_scraping(&audio_query),
        );

        let mut track_map: HashMap<String, Track> = HashMap::new();
        let mut order: Vec<String> = Vec::new();

        for track in topic_items.into_iter().chain(audio_items.into_iter()) {
            if !is_valid_video_id(&track.youtube_id) {
                continue;
            }
            let new_score = track.priority_score.unwrap_or(0);
            if let Some(existing) = track_map.get_mut(&track.youtube_id) {
                if new_score > existing.priority_score.unwrap_or(0) {
                    *existing = track;
                }
            } else {
                order.push(track.youtube_id.clone());
                track_map.insert(track.youtube_id.clone(), track);
            }
        }

        let mut sorted: Vec<Track> = order
            .into_iter()
            .filter_map(|id| track_map.remove(&id))
            .collect();
        sorted.sort_by(|a, b| {
            b.priority_score
                .unwrap_or(0)
                .cmp(&a.priority_score.unwrap_or(0))
        });

        if !sorted.is_empty() {
            if let Some(first) = sorted.first() {
                let client = self.clone();
                let vid = first.youtube_id.clone();
                tokio::spawn(async move {
                    let _ = client.resolve_audio(&vid, false, AudioFormat::M4a).await;
                });
            }
            return (sorted, "youtube_music_direct");
        }

        let broad = self.search_scraping(trimmed).await;
        (broad, "youtube_broad_fallback")
    }

    /// Google Suggest autocomplete for search bar
    pub async fn search_suggestions(&self, query: &str) -> Vec<String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }
        let url = format!(
            "https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q={}",
            urlencode(trimmed)
        );
        let Ok(resp) = self
            .http
            .get(&url)
            .header("User-Agent", USER_AGENT_WEB)
            .timeout(Duration::from_secs(3))
            .send()
            .await
        else {
            return Vec::new();
        };
        let Ok(json) = resp.json::<Value>().await else {
            return Vec::new();
        };
        json.get(1)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Resolve audio stream (< 350ms via direct InnerTube VISIONOS player API, with yt-dlp fallback)
    pub async fn resolve_audio(
        &self,
        video_id: &str,
        refresh: bool,
        format: AudioFormat,
    ) -> Result<AudioSource, AudioStreamError> {
        let vid = video_id.trim();
        if !is_valid_video_id(vid) {
            return Err(AudioStreamError::new(400, "Invalid YouTube video ID."));
        }

        if refresh {
            let mut cache = self.audio_cache.write().await;
            cache.remove(vid);
            let mut pcache = self.prefetch_cache.write().await;
            pcache.remove(&(vid.to_string(), AudioFormat::M4a));
            pcache.remove(&(vid.to_string(), AudioFormat::Webm));
        } else {
            let cache = self.audio_cache.read().await;
            if let Some(entry) = cache.get(vid) {
                match entry {
                    Ok(resolved) if resolved.expires_at > Instant::now() => {
                        if let Some(src) = resolved.select(format) {
                            return Ok(src.clone());
                        }
                    }
                    Err((err, expires_at)) if *expires_at > Instant::now() && err.status != 429 => {
                        return Err(err.clone());
                    }
                    _ => {}
                }
            }
        }

        // Coalesce concurrent requests for the same video_id
        let lock = {
            let mut inflight = self.inflight.lock().await;
            inflight
                .entry(vid.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = lock.lock().await;

        // Re-check cache after acquiring per-video lock
        if !refresh {
            let cache = self.audio_cache.read().await;
            if let Some(Ok(resolved)) = cache.get(vid) {
                if resolved.expires_at > Instant::now() {
                    if let Some(src) = resolved.select(format) {
                        return Ok(src.clone());
                    }
                }
            }
        }

        // 1. Primary path: Direct InnerTube VISIONOS player API (~250-320ms)
        let resolved_res = match self.extract_innertube_player(vid).await {
            Ok(resolved) => Ok(resolved),
            Err(_innertube_err) => {
                // 2. Resilient fallback: yt-dlp subprocess if InnerTube refused or lacked direct URLs
                self.extract_ytdlp_fallback(vid).await
            }
        };

        {
            let mut inflight = self.inflight.lock().await;
            inflight.remove(vid);
        }

        match resolved_res {
            Ok(resolved) => {
                let selected = resolved.select(format).cloned().ok_or_else(|| {
                    AudioStreamError::new(
                        422,
                        "No compatible audio-only stream is available in this format.",
                    )
                })?;

                {
                    let mut cache = self.audio_cache.write().await;
                    if cache.len() >= 120 {
                        if let Some(first_key) = cache.keys().next().cloned() {
                            cache.remove(&first_key);
                        }
                    }
                    cache.insert(vid.to_string(), Ok(resolved));
                }

                // Trigger non-blocking prefetch of the first 512 KB into memory
                let client = self.clone();
                let vid_owned = vid.to_string();
                let src_clone = selected.clone();
                tokio::spawn(async move {
                    client.prefetch_initial_chunk(&vid_owned, format, &src_clone).await;
                });

                Ok(selected)
            }
            Err(err) => {
                let mut cache = self.audio_cache.write().await;
                cache.insert(
                    vid.to_string(),
                    Err((err.clone(), Instant::now() + Duration::from_secs(10))),
                );
                Err(err)
            }
        }
    }

    /// Direct InnerTube `/youtubei/v1/player` extraction using Apple VisionOS client (JS-less, <350ms)
    async fn extract_innertube_player(&self, video_id: &str) -> Result<ResolvedAudio, AudioStreamError> {
        let visitor_data = self.ensure_visitor_data().await.unwrap_or_default();

        let mut client_obj = serde_json::json!({
            "clientName": "VISIONOS",
            "clientVersion": "1.02",
            "deviceMake": "Apple",
            "deviceModel": "RealityDevice17,1",
            "userAgent": USER_AGENT_VISIONOS,
            "osName": "visionOS",
            "osVersion": "26.5.23O471",
            "hl": "en",
            "gl": "US"
        });

        if !visitor_data.is_empty() {
            client_obj["visitorData"] = Value::String(visitor_data.clone());
        }

        let payload = serde_json::json!({
            "context": {
                "client": client_obj
            },
            "videoId": video_id,
            "contentCheckOk": true,
            "racyCheckOk": true
        });

        let mut req = self
            .http
            .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
            .header("Content-Type", "application/json")
            .header("User-Agent", USER_AGENT_VISIONOS)
            .header("X-Goog-Api-Format-Version", "2")
            .header("X-YouTube-Client-Name", "101")
            .header("X-YouTube-Client-Version", "1.02")
            .header("Origin", "https://www.youtube.com")
            .timeout(Duration::from_secs(6));

        if !visitor_data.is_empty() {
            req = req.header("X-Goog-Visitor-Id", &visitor_data);
        }

        let resp = req
            .json(&payload)
            .send()
            .await
            .map_err(|_| AudioStreamError::new(502, "Could not connect to YouTube player API."))?;

        let body: Value = resp
            .json()
            .await
            .map_err(|_| AudioStreamError::new(502, "Invalid response from YouTube player API."))?;

        self.update_visitor_data_from_response(&body).await;

        let status = body
            .pointer("/playabilityStatus/status")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if status != "OK" {
            let reason = body
                .pointer("/playabilityStatus/reason")
                .and_then(|v| v.as_str())
                .unwrap_or("Stream unavailable via InnerTube");
            return Err(AudioStreamError::new(422, reason));
        }

        let duration_secs = body
            .pointer("/videoDetails/lengthSeconds")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        let formats = body
            .pointer("/streamingData/adaptiveFormats")
            .and_then(|v| v.as_array())
            .ok_or_else(|| AudioStreamError::new(422, "No adaptive audio formats returned."))?;

        let mut best_m4a: Option<(u64, AudioSource)> = None;
        let mut best_webm: Option<(u64, AudioSource)> = None;

        for fmt in formats {
            let mime = fmt.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
            if !mime.starts_with("audio/") {
                continue;
            }

            let raw_url = fmt
                .get("url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    fmt.get("signatureCipher")
                        .or_else(|| fmt.get("cipher"))
                        .and_then(|v| v.as_str())
                        .and_then(parse_signature_cipher)
                });

            let Some(url_str) = raw_url else { continue };
            let Ok(parsed_url) = Url::parse(&url_str) else {
                continue;
            };
            if !is_media_url(&parsed_url) {
                continue;
            }

            let bitrate = fmt.get("bitrate").and_then(|v| v.as_u64()).unwrap_or(0);
            let content_length = fmt
                .get("contentLength")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok());

            let fmt_duration = fmt
                .get("approxDurationMs")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok())
                .map(|ms| ms / 1000)
                .unwrap_or(duration_secs);

            let expires_at = extract_expiry(&parsed_url);
            let mut headers = HashMap::new();
            headers.insert("User-Agent".to_string(), USER_AGENT_VISIONOS.to_string());

            if mime.starts_with("audio/mp4") {
                let source = AudioSource {
                    url: parsed_url.to_string(),
                    content_type: "audio/mp4".to_string(),
                    duration: if duration_secs > 0 {
                        duration_secs
                    } else {
                        fmt_duration
                    },
                    content_length,
                    headers,
                    expires_at,
                    ready_at: None,
                };
                if best_m4a.as_ref().map(|(b, _)| bitrate > *b).unwrap_or(true) {
                    best_m4a = Some((bitrate, source));
                }
            } else if mime.starts_with("audio/webm") {
                let source = AudioSource {
                    url: parsed_url.to_string(),
                    content_type: "audio/webm".to_string(),
                    duration: if duration_secs > 0 {
                        duration_secs
                    } else {
                        fmt_duration
                    },
                    content_length,
                    headers,
                    expires_at,
                    ready_at: None,
                };
                if best_webm.as_ref().map(|(b, _)| bitrate > *b).unwrap_or(true) {
                    best_webm = Some((bitrate, source));
                }
            }
        }

        if best_m4a.is_none() && best_webm.is_none() {
            return Err(AudioStreamError::new(
                422,
                "No direct audio-only stream available from InnerTube.",
            ));
        }

        let expires_at = [
            best_m4a.as_ref().map(|(_, s)| s.expires_at),
            best_webm.as_ref().map(|(_, s)| s.expires_at),
        ]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or_else(|| Instant::now() + Duration::from_secs(300));

        Ok(ResolvedAudio {
            m4a: best_m4a.map(|(_, s)| s),
            webm: best_webm.map(|(_, s)| s),
            expires_at,
        })
    }

    /// Fallback extractor using yt-dlp subprocess
    async fn extract_ytdlp_fallback(&self, video_id: &str) -> Result<ResolvedAudio, AudioStreamError> {
        let binary = Self::find_ytdlp_binary();
        let target_url = format!("https://www.youtube.com/watch?v={}", video_id);

        let mut cmd = tokio::process::Command::new(&binary);
        cmd.args([
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-playlist",
            "--skip-download",
            "--no-warnings",
            "--dump-single-json",
            "--socket-timeout",
            "10",
            "--retries",
            "1",
            "--extractor-retries",
            "1",
            "--extractor-args",
            "youtube:skip=hls,dash,translated_subs",
            "--format",
            "bestaudio[ext=m4a][protocol=https]/bestaudio[ext=webm][protocol=https]",
            "--",
            &target_url,
        ]);

        let output = tokio::time::timeout(Duration::from_secs(25), cmd.output())
            .await
            .map_err(|_| {
                AudioStreamError::new(504, "Audio extraction timed out. Please try again.")
            })?
            .map_err(|_| {
                AudioStreamError::new(
                    503,
                    "Audio extractor unavailable. Install yt-dlp or set YTDLP_BINARY on the server.",
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let unavailable = regex::Regex::new(
                r"(?i)video (?:is )?unavailable|private video|removed|not available in your country|age.?restrict|requested format is not available",
            )
            .map(|re| re.is_match(&stderr))
            .unwrap_or(false);
            return Err(AudioStreamError::new(
                if unavailable { 422 } else { 502 },
                if unavailable {
                    "This track has no accessible audio stream. It may be private, restricted, or unavailable."
                } else {
                    "YouTube did not provide an audio stream. Try again."
                },
            ));
        }

        let info: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
            AudioStreamError::new(502, "The audio extractor returned invalid metadata.")
        })?;

        let duration = info
            .get("duration")
            .and_then(|v| v.as_f64())
            .map(|d| d as u64)
            .unwrap_or(0);

        let mut m4a: Option<AudioSource> = None;
        let mut webm: Option<AudioSource> = None;

        let empty = Vec::new();
        let formats = info
            .get("formats")
            .and_then(|v| v.as_array())
            .unwrap_or(&empty);

        for candidate in formats.iter().chain(std::iter::once(&info)) {
            let ext = candidate.get("ext").and_then(|v| v.as_str()).unwrap_or("");
            if ext != "m4a" && ext != "webm" {
                continue;
            }
            let vcodec = candidate
                .get("vcodec")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let acodec = candidate
                .get("acodec")
                .and_then(|v| v.as_str())
                .unwrap_or("none");
            let protocol = candidate
                .get("protocol")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if vcodec != "none" || acodec == "none" || protocol != "https" {
                continue;
            }
            let Some(url_str) = candidate.get("url").and_then(|v| v.as_str()) else {
                continue;
            };
            let Ok(parsed_url) = Url::parse(url_str) else {
                continue;
            };
            if !is_media_url(&parsed_url) {
                continue;
            }

            let mut headers = HashMap::new();
            if let Some(hdrs) = candidate
                .get("http_headers")
                .or_else(|| info.get("http_headers"))
                .and_then(|v| v.as_object())
            {
                for (k, v) in hdrs {
                    if matches!(
                        k.to_ascii_lowercase().as_str(),
                        "user-agent" | "referer" | "origin" | "accept-language"
                    ) {
                        if let Some(val) = v.as_str() {
                            headers.insert(k.clone(), val.to_string());
                        }
                    }
                }
            }

            let content_length = candidate
                .get("filesize")
                .or_else(|| candidate.get("filesize_approx"))
                .and_then(|v| v.as_u64());

            let expires_at = extract_expiry(&parsed_url);
            let source = AudioSource {
                url: parsed_url.to_string(),
                content_type: if ext == "m4a" {
                    "audio/mp4".to_string()
                } else {
                    "audio/webm".to_string()
                },
                duration,
                content_length,
                headers,
                expires_at,
                ready_at: None,
            };

            if ext == "m4a" {
                m4a = Some(source);
            } else {
                webm = Some(source);
            }
        }

        if m4a.is_none() && webm.is_none() {
            return Err(AudioStreamError::new(
                422,
                "No compatible audio-only stream is available for this track.",
            ));
        }

        let expires_at = [
            m4a.as_ref().map(|s| s.expires_at),
            webm.as_ref().map(|s| s.expires_at),
        ]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or_else(|| Instant::now() + Duration::from_secs(300));

        Ok(ResolvedAudio {
            m4a,
            webm,
            expires_at,
        })
    }

    fn find_ytdlp_binary() -> PathBuf {
        for var in ["YTDLP_BINARY", "YOUTERM_BUNDLED_EXTRACTOR"] {
            if let Ok(val) = std::env::var(var) {
                let p = PathBuf::from(val);
                if p.is_file() {
                    return p;
                }
            }
        }
        let candidates = [
            ".venv/bin/yt-dlp",
            "../YouTerm/.venv/bin/yt-dlp",
            "/usr/bin/yt-dlp",
            "/usr/local/bin/yt-dlp",
        ];
        for c in candidates {
            let p = PathBuf::from(c);
            if p.is_file() {
                return p;
            }
        }
        PathBuf::from("yt-dlp")
    }

    /// Prefetch the first 512 KB of an audio track into memory for instant 0ms playback start
    pub async fn prefetch_initial_chunk(
        &self,
        video_id: &str,
        format: AudioFormat,
        source: &AudioSource,
    ) {
        let key = (video_id.to_string(), format);
        {
            let cache = self.prefetch_cache.read().await;
            if let Some(existing) = cache.get(&key) {
                if existing.expires_at > Instant::now() {
                    return;
                }
            }
        }

        let range_header = format!("bytes=0-{}", PREFETCH_BYTES - 1);
        let mut req = self
            .http
            .get(&source.url)
            .header("Accept-Encoding", "identity")
            .header("Range", range_header);

        for (k, v) in &source.headers {
            req = req.header(k, v);
        }

        let Ok(resp) = req.send().await else { return };
        if !matches!(resp.status().as_u16(), 200 | 206) {
            return;
        }

        let total_length = resp
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split('/').nth(1))
            .and_then(|s| s.parse::<u64>().ok())
            .or(source.content_length);

        let Ok(bytes) = resp.bytes().await else {
            return;
        };
        if bytes.is_empty() {
            return;
        }

        let mut cache = self.prefetch_cache.write().await;
        if cache.len() >= 16 {
            if let Some(first_key) = cache.keys().next().cloned() {
                cache.remove(&first_key);
            }
        }
        cache.insert(
            key,
            PrefetchedChunk {
                data: bytes,
                total_length,
                content_type: source.content_type.clone(),
                expires_at: source.expires_at,
            },
        );
    }

    pub async fn get_prefetched_chunk(
        &self,
        video_id: &str,
        format: AudioFormat,
    ) -> Option<PrefetchedChunk> {
        let cache = self.prefetch_cache.read().await;
        cache
            .get(&(video_id.to_string(), format))
            .filter(|c| c.expires_at > Instant::now())
            .cloned()
    }

    /// Perform an authenticated InnerTube `browse` request against YouTube Music (`WEB_REMIX`) or YouTube (`WEB`)
    pub async fn browse_authenticated(
        &self,
        browse_id: &str,
        cookie_header: &str,
        use_ytm: bool,
    ) -> Result<Value, (u16, String)> {
        let origin = if use_ytm {
            "https://music.youtube.com"
        } else {
            "https://www.youtube.com"
        };
        let auth_header = build_sapisidhash_header(cookie_header, origin).ok_or_else(|| {
            (
                401,
                "Invalid or incomplete Google session cookies. Please connect your Google account again.".to_string(),
            )
        })?;

        let (client_name, client_version, client_id_hdr) = if use_ytm {
            ("WEB_REMIX", "1.20240318.01.00", "67")
        } else {
            ("WEB", "2.20240318.01.00", "1")
        };

        let payload = serde_json::json!({
            "context": {
                "client": {
                    "clientName": client_name,
                    "clientVersion": client_version,
                    "hl": "pt",
                    "gl": "BR"
                }
            },
            "browseId": browse_id
        });

        let endpoint = format!("{}/youtubei/v1/browse?prettyPrint=false", origin);
        let resp = self
            .http
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .header("User-Agent", USER_AGENT_YTM)
            .header("Cookie", cookie_header)
            .header("Authorization", auth_header)
            .header("Origin", origin)
            .header("Referer", format!("{}/", origin))
            .header("X-Origin", origin)
            .header("X-Goog-AuthUser", "0")
            .header("X-YouTube-Client-Name", client_id_hdr)
            .header("X-YouTube-Client-Version", client_version)
            .timeout(Duration::from_secs(12))
            .json(&payload)
            .send()
            .await
            .map_err(|_| {
                (
                    502,
                    "Could not reach YouTube Music to sync your library. Check your internet connection.".to_string(),
                )
            })?;

        let status = resp.status().as_u16();
        let body: Value = resp.json().await.map_err(|_| {
            (
                502,
                "YouTube Music returned an invalid library response.".to_string(),
            )
        })?;

        if status == 401 || status == 403 {
            return Err((
                401,
                "Your Google session has expired or was denied. Connect with Google again."
                    .to_string(),
            ));
        }

        Ok(body)
    }

    fn is_response_logged_out(body: &Value) -> bool {
        if let Some(params) = body
            .pointer("/responseContext/serviceTrackingParams")
            .and_then(|v| v.as_array())
        {
            for st in params {
                if let Some(kv_arr) = st.get("params").and_then(|v| v.as_array()) {
                    for kv in kv_arr {
                        let k = kv.get("key").and_then(|v| v.as_str()).unwrap_or("");
                        let val = kv.get("value").and_then(|v| v.as_str()).unwrap_or("");
                        if k == "logged_in" && val == "0" {
                            return true;
                        }
                    }
                }
            }
        }
        body.pointer("/responseContext/mainAppWebResponseContext/loggedOut")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    }

    fn collect_tracks_from_value(
        val: &Value,
        is_liked: Option<bool>,
        seen: &mut std::collections::HashSet<String>,
        out: &mut Vec<Track>,
    ) {
        match val {
            Value::Object(map) => {
                if map.contains_key("musicResponsiveListItemRenderer") {
                    if let Some(mut track) = Self::parse_innertube_search_item(val) {
                        if is_liked.is_some() {
                            track.is_liked = is_liked;
                        }
                        if seen.insert(track.youtube_id.clone()) {
                            out.push(track);
                        }
                    }
                    return;
                }
                if let Some(video) = map.get("playlistVideoRenderer") {
                    if let Some(mut track) = Self::parse_playlist_video_renderer(video)
                    {
                        if is_liked.is_some() {
                            track.is_liked = is_liked;
                        }
                        if seen.insert(track.youtube_id.clone()) {
                            out.push(track);
                        }
                    }
                    return;
                }
                for child in map.values() {
                    Self::collect_tracks_from_value(child, is_liked, seen, out);
                }
            }
            Value::Array(arr) => {
                for item in arr {
                    Self::collect_tracks_from_value(item, is_liked, seen, out);
                }
            }
            _ => {}
        }
    }

    fn parse_playlist_video_renderer(video: &Value) -> Option<Track> {
        let vid = video.get("videoId").and_then(|v| v.as_str())?;
        if !is_valid_video_id(vid) {
            return None;
        }
        let v_title = video
            .pointer("/title/runs/0/text")
            .or_else(|| video.pointer("/title/simpleText"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown");
        if v_title == "Private video" || v_title == "Deleted video" {
            return None;
        }
        let v_artist = video
            .pointer("/shortBylineText/runs/0/text")
            .or_else(|| video.pointer("/shortBylineText/simpleText"))
            .or_else(|| video.pointer("/longBylineText/runs/0/text"))
            .and_then(|v| v.as_str())
            .unwrap_or("YouTube Music");
        let length_secs = video
            .get("lengthSeconds")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u32>().ok())
            .or_else(|| {
                video
                    .pointer("/lengthText/simpleText")
                    .or_else(|| video.pointer("/lengthText/runs/0/text"))
                    .and_then(|v| v.as_str())
                    .map(parse_duration_str)
                    .filter(|&d| d > 0)
            })
            .unwrap_or(210);
        let duration_text = video
            .pointer("/lengthText/simpleText")
            .or_else(|| video.pointer("/lengthText/runs/0/text"))
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

        Some(Track {
            id: vid.to_string(),
            title: clean_track_title(v_title),
            artist: clean_artist_name(v_artist),
            album: String::new(),
            album_id: None,
            thumbnail_url: thumb,
            youtube_id: vid.to_string(),
            duration: length_secs,
            duration_formatted: duration_text,
            source_type: Some("yt_music".to_string()),
            priority_score: Some(1500),
            is_liked: None,
        })
    }

    /// Fetch user's Liked Songs directly via authenticated InnerTube (`VLLM` + `VLLL`)
    pub async fn fetch_authenticated_liked_tracks(
        &self,
        cookie_header: &str,
    ) -> Result<Vec<Track>, (u16, String)> {
        let (ytm_res, yt_res) = tokio::join!(
            self.browse_authenticated("VLLM", cookie_header, true),
            self.browse_authenticated("VLLL", cookie_header, false),
        );

        let mut logged_in_any = false;
        let mut seen = std::collections::HashSet::new();
        let mut tracks = Vec::new();

        if let Ok(ref body) = ytm_res {
            if !Self::is_response_logged_out(body) {
                logged_in_any = true;
                Self::collect_tracks_from_value(
                    body,
                    Some(true),
                    &mut seen,
                    &mut tracks,
                );
            }
        }

        if let Ok(ref body) = yt_res {
            if !Self::is_response_logged_out(body) {
                logged_in_any = true;
                Self::collect_tracks_from_value(
                    body,
                    Some(true),
                    &mut seen,
                    &mut tracks,
                );
            }
        }

        if !logged_in_any {
            if let Err(err) = ytm_res {
                return Err(err);
            }
            return Err((
                401,
                "Your Google session has expired or is not signed in. Please connect with Google again."
                    .to_string(),
            ));
        }

        Ok(tracks)
    }

    fn collect_playlists_from_value(
        val: &Value,
        seen: &mut std::collections::HashSet<String>,
        out: &mut Vec<(String, String, String, Option<String>)>,
    ) {
        match val {
            Value::Object(map) => {
                if let Some(two_row) = map.get("musicTwoRowItemRenderer") {
                    let browse_id = two_row
                        .pointer("/navigationEndpoint/browseEndpoint/browseId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if let Some(pl_id) = Self::normalize_user_playlist_id(browse_id) {
                        if seen.insert(pl_id.clone()) {
                            let title = two_row
                                .pointer("/title/runs/0/text")
                                .or_else(|| two_row.pointer("/title/simpleText"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("My Playlist")
                                .to_string();
                            let author = two_row
                                .pointer("/subtitle/runs")
                                .and_then(|v| v.as_array())
                                .and_then(|runs| {
                                    runs.iter()
                                        .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                                        .find(|t| {
                                            *t != "Playlist"
                                                && *t != " • "
                                                && !t.contains("música")
                                                && !t.contains("song")
                                                && !t.contains("track")
                                                && !t.contains("faixa")
                                        })
                                })
                                .unwrap_or("You")
                                .to_string();
                            let thumb = two_row
                                .pointer(
                                    "/thumbnailRenderer/musicThumbnailRenderer/thumbnail/thumbnails",
                                )
                                .and_then(|v| v.as_array())
                                .and_then(|arr| arr.last())
                                .and_then(|t| t.get("url"))
                                .and_then(|u| u.as_str())
                                .map(|s| s.to_string());
                            out.push((pl_id, title, author, thumb));
                        }
                    }
                    return;
                }

                if let Some(grid_pl) = map
                    .get("gridPlaylistRenderer")
                    .or_else(|| map.get("playlistRenderer"))
                {
                    let raw_id = grid_pl
                        .get("playlistId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if let Some(pl_id) = Self::normalize_user_playlist_id(raw_id) {
                        if seen.insert(pl_id.clone()) {
                            let title = grid_pl
                                .pointer("/title/runs/0/text")
                                .or_else(|| grid_pl.pointer("/title/simpleText"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("My Playlist")
                                .to_string();
                            let author = grid_pl
                                .pointer("/shortBylineText/runs/0/text")
                                .or_else(|| grid_pl.pointer("/longBylineText/runs/0/text"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("You")
                                .to_string();
                            let thumb = grid_pl
                                .pointer("/thumbnail/thumbnails")
                                .or_else(|| grid_pl.pointer("/thumbnails/0/thumbnails"))
                                .and_then(|v| v.as_array())
                                .and_then(|arr| arr.last())
                                .and_then(|t| t.get("url"))
                                .and_then(|u| u.as_str())
                                .map(|s| s.to_string());
                            out.push((pl_id, title, author, thumb));
                        }
                    }
                    return;
                }

                if let Some(lockup) = map.get("lockupViewModel") {
                    let content_id = lockup
                        .get("contentId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if let Some(pl_id) = Self::normalize_user_playlist_id(content_id) {
                        if seen.insert(pl_id.clone()) {
                            let title = lockup
                                .pointer("/metadata/lockupMetadataViewModel/title/content")
                                .and_then(|v| v.as_str())
                                .unwrap_or("My Playlist")
                                .to_string();
                            let thumb = lockup
                                .pointer("/contentImage/collectionThumbnailViewModel/primaryThumbnail/thumbnailViewModel/image/sources")
                                .and_then(|v| v.as_array())
                                .and_then(|arr| arr.last())
                                .and_then(|t| t.get("url"))
                                .and_then(|u| u.as_str())
                                .map(|s| s.to_string());
                            out.push((pl_id, title, "You".to_string(), thumb));
                        }
                    }
                    return;
                }

                for child in map.values() {
                    Self::collect_playlists_from_value(child, seen, out);
                }
            }
            Value::Array(arr) => {
                for item in arr {
                    Self::collect_playlists_from_value(item, seen, out);
                }
            }
            _ => {}
        }
    }

    fn normalize_user_playlist_id(raw_id: &str) -> Option<String> {
        let trimmed = raw_id.trim();
        if trimmed.is_empty() {
            return None;
        }
        let id = trimmed.strip_prefix("VL").unwrap_or(trimmed);
        if id.is_empty()
            || matches!(
                id,
                "LM" | "LL" | "SE" | "WL" | "RDPN" | "FEmusic_liked_videos" | "FEmusic_liked_playlists"
            )
            || id.starts_with("FE")
            || id.starts_with("RD")
        {
            return None;
        }
        if id.starts_with("PL") || id.starts_with("OL") || id.len() >= 10 {
            return Some(id.to_string());
        }
        None
    }

    /// Fetch user's Playlists and their tracks directly via authenticated InnerTube
    pub async fn fetch_authenticated_playlists(
        &self,
        cookie_header: &str,
    ) -> Result<Vec<Playlist>, (u16, String)> {
        let (ytm_lib, yt_lib) = tokio::join!(
            self.browse_authenticated("FEmusic_liked_playlists", cookie_header, true),
            self.browse_authenticated("FEplaylist_aggregation", cookie_header, false),
        );

        let mut logged_in_any = false;
        let mut seen_pl = std::collections::HashSet::new();
        let mut discovered = Vec::new();

        if let Ok(ref body) = ytm_lib {
            if !Self::is_response_logged_out(body) {
                logged_in_any = true;
                Self::collect_playlists_from_value(body, &mut seen_pl, &mut discovered);
            }
        }

        if let Ok(ref body) = yt_lib {
            if !Self::is_response_logged_out(body) {
                logged_in_any = true;
                Self::collect_playlists_from_value(body, &mut seen_pl, &mut discovered);
            }
        }

        if !logged_in_any {
            if let Err(err) = ytm_lib {
                return Err(err);
            }
            return Err((
                401,
                "Your Google session has expired or is not signed in. Please connect with Google again."
                    .to_string(),
            ));
        }

        discovered.truncate(25);
        let mut handles = Vec::with_capacity(discovered.len());

        for (pl_id, pl_title, pl_author, pl_thumb) in discovered {
            let client = self.clone();
            let cookies = cookie_header.to_string();
            handles.push(tokio::spawn(async move {
                let browse_id = format!("VL{}", pl_id);
                let mut tracks = Vec::new();
                let mut seen_tracks = std::collections::HashSet::new();

                if let Ok(body) = client
                    .browse_authenticated(&browse_id, &cookies, true)
                    .await
                {
                    Self::collect_tracks_from_value(
                        &body,
                        None,
                        &mut seen_tracks,
                        &mut tracks,
                    );
                }

                if tracks.is_empty() {
                    if let Ok(body) = client
                        .browse_authenticated(&browse_id, &cookies, false)
                        .await
                    {
                        Self::collect_tracks_from_value(
                            &body,
                            None,
                            &mut seen_tracks,
                            &mut tracks,
                        );
                    }
                }

                let thumb = pl_thumb.or_else(|| tracks.first().map(|t| t.thumbnail_url.clone()));
                Playlist {
                    id: pl_id,
                    title: pl_title,
                    description: "Synced from your YouTube Music library".to_string(),
                    author: pl_author,
                    thumbnail_url: thumb,
                    tracks,
                    is_custom: true,
                }
            }));
        }

        let mut playlists = Vec::new();
        for h in handles {
            if let Ok(pl) = h.await {
                if !pl.tracks.is_empty() {
                    playlists.push(pl);
                }
            }
        }

        Ok(playlists)
    }
}

fn extract_expiry(url: &Url) -> Instant {
    let default_ttl = Instant::now() + Duration::from_secs(300);
    let Some((_, exp_str)) = url.query_pairs().find(|(k, _)| k == "expire") else {
        return default_ttl;
    };
    let Ok(exp_secs) = exp_str.parse::<u64>() else {
        return default_ttl;
    };
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if exp_secs > now_secs + 60 {
        let remaining = (exp_secs - now_secs - 60).min(300);
        Instant::now() + Duration::from_secs(remaining)
    } else {
        default_ttl
    }
}

pub fn extract_yt_initial_data(html: &str) -> Option<&str> {
    for marker in ["var ytInitialData = ", "window[\"ytInitialData\"] = "] {
        if let Some(start_idx) = html.find(marker) {
            let rest = &html[start_idx + marker.len()..];
            if let Some(end_idx) = rest.find(";</script>") {
                return Some(rest[..end_idx].trim());
            }
        }
    }
    None
}
