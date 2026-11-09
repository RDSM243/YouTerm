use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

use super::innertube::InnerTubeClient;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TrackAlbum {
    pub name: String,
    pub id: String,
}

/// Album labels must link to an album, rather than another artist, playlist,
/// year or view count in a song's byline.
pub fn album_from_runs(value: &Value) -> Option<TrackAlbum> {
    match value {
        Value::Object(map) => {
            if let Some(endpoint) = value.pointer("/navigationEndpoint/browseEndpoint") {
                let id = endpoint
                    .get("browseId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let page_type = endpoint
                    .pointer("/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType")
                    .and_then(Value::as_str).unwrap_or("");
                let name = value
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                if !id.is_empty()
                    && !name.is_empty()
                    && (page_type == "MUSIC_PAGE_TYPE_ALBUM"
                        || id.starts_with("MPRE")
                        || id.contains("release_detail"))
                {
                    return Some(TrackAlbum {
                        name: name.to_string(),
                        id: id.to_string(),
                    });
                }
            }
            map.values().find_map(album_from_runs)
        }
        Value::Array(items) => items.iter().find_map(album_from_runs),
        _ => None,
    }
}

fn album_for_video(value: &Value, video_id: &str) -> Option<TrackAlbum> {
    match value {
        Value::Object(map) => {
            if let Some(video) = map.get("playlistPanelVideoRenderer") {
                // The watch queue contains related songs too. Only use the exact
                // requested video, including when wrapped in a counterpart.
                if video.get("videoId").and_then(Value::as_str) == Some(video_id) {
                    return album_from_runs(video.get("longBylineText")?);
                }
                return None;
            }
            map.values()
                .find_map(|child| album_for_video(child, video_id))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|child| album_for_video(child, video_id)),
        _ => None,
    }
}

impl InnerTubeClient {
    pub async fn fetch_track_album(&self, video_id: &str) -> Result<Option<TrackAlbum>, ()> {
        let mut payload = json!({
            "context": { "client": {
                "clientName": "WEB_REMIX", "clientVersion": "1.20240318.01.00",
                "hl": "pt", "gl": "BR"
            } },
            "videoId": video_id,
            "playlistId": format!("RDAMVM{video_id}"),
            "enablePersistentPlaylistPanel": true,
            "isAudioOnly": true,
            "watchEndpointMusicSupportedConfigs": { "watchEndpointMusicConfig": {
                "hasPersistentPlaylistPanel": true, "musicVideoType": "MUSIC_VIDEO_TYPE_ATV"
            } }
        });
        if let Some(visitor_data) = self.ensure_visitor_data().await {
            payload["context"]["client"]["visitorData"] = json!(visitor_data);
        }
        let body: Value = self
            .http()
            .post("https://music.youtube.com/youtubei/v1/next?prettyPrint=false")
            .header(
                "User-Agent",
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
            )
            .header("Origin", "https://music.youtube.com")
            .header("Referer", "https://music.youtube.com/")
            .json(&payload)
            .timeout(Duration::from_secs(12))
            .send()
            .await
            .map_err(|_| ())?
            .error_for_status()
            .map_err(|_| ())?
            .json()
            .await
            .map_err(|_| ())?;
        if body.get("error").is_some() || body.get("contents").is_none() {
            return Err(());
        }
        Ok(album_for_video(&body, video_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn album(name: &str) -> Value {
        json!({"text": name, "navigationEndpoint": {"browseEndpoint": {"browseId": "MPREb_test_album"}}})
    }

    #[test]
    fn extracts_album_link_and_ignores_playlist_or_year() {
        let runs = json!({"runs": [
            {"text": "Example Artist", "navigationEndpoint": {"browseEndpoint": {"browseId": "UCartist"}}},
            {"text": "My playlist", "navigationEndpoint": {"browseEndpoint": {"browseId": "VLplaylist"}}},
            {"text": "2020"}, album("Actual Album")
        ]});
        assert_eq!(album_from_runs(&runs).unwrap().name, "Actual Album");
        assert!(album_from_runs(&json!({"text": "My playlist"})).is_none());
    }

    #[test]
    fn album_belongs_to_exact_video_in_queue() {
        let queue = json!({"contents": [
            {"playlistPanelVideoRenderer": {"videoId": "other", "longBylineText": {"runs": [album("Wrong Album")]}}},
            {"playlistPanelVideoWrapperRenderer": {"primaryRenderer": {
                "playlistPanelVideoRenderer": {"videoId": "requested", "longBylineText": {"runs": [album("Actual Album")]}}
            }}}
        ]});
        assert_eq!(
            album_for_video(&queue, "requested").unwrap().name,
            "Actual Album"
        );
        assert!(album_for_video(&queue, "missing").is_none());
    }
}
