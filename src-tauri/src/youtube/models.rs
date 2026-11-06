use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    M4a,
    Webm,
}

impl AudioFormat {
    pub fn from_query(s: Option<&str>) -> Result<Self, &'static str> {
        match s.unwrap_or("m4a") {
            "m4a" => Ok(AudioFormat::M4a),
            "webm" => Ok(AudioFormat::Webm),
            _ => Err("Unsupported audio format."),
        }
    }

    pub fn content_type(&self) -> &'static str {
        match self {
            AudioFormat::M4a => "audio/mp4",
            AudioFormat::Webm => "audio/webm",
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            AudioFormat::M4a => "m4a",
            AudioFormat::Webm => "webm",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AudioSource {
    pub url: String,
    pub content_type: String,
    pub duration: u64,
    pub content_length: Option<u64>,
    pub headers: HashMap<String, String>,
    pub expires_at: Instant,
    pub ready_at: Option<Instant>,
}

#[derive(Debug, Clone)]
pub struct ResolvedAudio {
    pub m4a: Option<AudioSource>,
    pub webm: Option<AudioSource>,
    pub expires_at: Instant,
}

impl ResolvedAudio {
    pub fn select(&self, format: AudioFormat) -> Option<&AudioSource> {
        match format {
            AudioFormat::M4a => self.m4a.as_ref().or(self.webm.as_ref()),
            AudioFormat::Webm => self.webm.as_ref().or(self.m4a.as_ref()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub thumbnail_url: String,
    pub youtube_id: String,
    pub duration: u32,
    pub duration_formatted: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority_score: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_liked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub description: String,
    pub author: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    pub tracks: Vec<Track>,
    pub is_custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreCategory {
    pub id: String,
    pub name: String,
    pub query: String,
    pub tracks: Vec<Track>,
}

/// Clean up YouTube titles by removing tags like [Official Music Video], (Official Audio), etc.
pub fn clean_track_title(raw: &str) -> String {
    if raw.trim().is_empty() {
        return "Unknown Title".to_string();
    }
    let mut title = raw.to_string();
    let patterns = [
        r"(?i)\[official\s*(music\s*)?video\]",
        r"(?i)\(official\s*(music\s*)?video\)",
        r"(?i)\[official\s*audio\]",
        r"(?i)\(official\s*audio\)",
        r"(?i)\[audio\]",
        r"(?i)\(audio\)",
        r"(?i)\[visualizer\]",
        r"(?i)\(visualizer\)",
        r"(?i)\[lyric\s*video\]",
        r"(?i)\(lyric\s*video\)",
        r"(?i)\[full\s*album\]",
        r"(?i)\[hd\]",
        r"(?i)\[4k\]",
        r"(?i)\|\s*youtube\s*music",
        r"(?i)\|\s*official\s*video",
    ];

    for p in patterns {
        if let Ok(re) = regex::Regex::new(p) {
            title = re.replace_all(&title, "").to_string();
        }
    }
    let trimmed = title.trim();
    if trimmed.is_empty() {
        raw.trim().to_string()
    } else {
        trimmed.to_string()
    }
}

/// Clean artist names by removing YouTube topic and VEVO suffixes
pub fn clean_artist_name(raw: &str) -> String {
    let mut artist = raw.trim().to_string();
    if let Ok(re) = regex::Regex::new(r"(?i)\s*-\s*topic$") {
        artist = re.replace_all(&artist, "").to_string();
    }
    if let Ok(re) = regex::Regex::new(r"(?i)vevo$") {
        artist = re.replace_all(&artist, "").to_string();
    }
    let trimmed = artist.trim();
    if trimmed.is_empty() {
        "YouTube Music".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Parse colon-separated duration string (e.g. "3:45" or "1:02:15") into total seconds
pub fn parse_duration_str(duration_str: &str) -> u32 {
    let parts: Vec<&str> = duration_str.trim().split(':').collect();
    match parts.len() {
        1 => parts[0].parse::<u32>().unwrap_or(0),
        2 => {
            let mins = parts[0].parse::<u32>().unwrap_or(0);
            let secs = parts[1].parse::<u32>().unwrap_or(0);
            mins * 60 + secs
        }
        3 => {
            let hours = parts[0].parse::<u32>().unwrap_or(0);
            let mins = parts[1].parse::<u32>().unwrap_or(0);
            let secs = parts[2].parse::<u32>().unwrap_or(0);
            hours * 3600 + mins * 60 + secs
        }
        _ => 0,
    }
}

/// Parse ISO 8601 duration (e.g. PT3M45S) from YouTube Data API v3
pub fn parse_iso8601_duration(duration_str: &str) -> u32 {
    if duration_str.is_empty() {
        return 210;
    }
    let Ok(re) = regex::Regex::new(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?") else {
        return 210;
    };
    let Some(caps) = re.captures(duration_str) else {
        return 210;
    };
    let hours = caps
        .get(1)
        .and_then(|m| m.as_str().parse::<u32>().ok())
        .unwrap_or(0);
    let minutes = caps
        .get(2)
        .and_then(|m| m.as_str().parse::<u32>().ok())
        .unwrap_or(0);
    let seconds = caps
        .get(3)
        .and_then(|m| m.as_str().parse::<u32>().ok())
        .unwrap_or(0);
    let total = hours * 3600 + minutes * 60 + seconds;
    if total == 0 {
        210
    } else {
        total
    }
}

/// Format total seconds as M:SS or H:MM:SS
pub fn format_duration_sec(total_seconds: u32) -> String {
    if total_seconds == 0 {
        return "0:00".to_string();
    }
    let h = total_seconds / 3600;
    let m = (total_seconds % 3600) / 60;
    let s = total_seconds % 60;
    if h > 0 {
        format!("{}:{:02}:{:02}", h, m, s)
    } else {
        format!("{}:{:02}", m, s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_track_title() {
        assert_eq!(
            clean_track_title("Daft Punk - Get Lucky (Official Music Video) [HD]"),
            "Daft Punk - Get Lucky"
        );
        assert_eq!(
            clean_track_title("Radiohead - Creep [Official Audio]"),
            "Radiohead - Creep"
        );
        assert_eq!(
            clean_track_title("Song Name | Official Video"),
            "Song Name"
        );
    }

    #[test]
    fn test_clean_artist_name() {
        assert_eq!(clean_artist_name("Coldplay - Topic"), "Coldplay");
        assert_eq!(clean_artist_name("AdeleVEVO"), "Adele");
        assert_eq!(clean_artist_name(""), "YouTube Music");
    }

    #[test]
    fn test_parse_durations() {
        assert_eq!(parse_duration_str("3:45"), 225);
        assert_eq!(parse_duration_str("1:02:10"), 3730);
        assert_eq!(parse_iso8601_duration("PT3M45S"), 225);
        assert_eq!(parse_iso8601_duration("PT1H2M10S"), 3730);
        assert_eq!(format_duration_sec(225), "3:45");
        assert_eq!(format_duration_sec(3730), "1:02:10");
    }
}
