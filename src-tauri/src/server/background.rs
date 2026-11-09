use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::{io, path::PathBuf, sync::Arc};
use tokio::{fs, sync::Mutex};
use url::Url;

use crate::state::AppState;

pub const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;

pub struct BackgroundStore {
    directory: PathBuf,
    write_lock: Mutex<()>,
}

impl BackgroundStore {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            write_lock: Mutex::new(()),
        }
    }

    async fn save(&self, bytes: &[u8]) -> io::Result<()> {
        let _guard = self.write_lock.lock().await;
        fs::create_dir_all(&self.directory).await?;
        let temporary = self.directory.join("image.tmp");
        fs::write(&temporary, bytes).await?;
        fs::rename(temporary, self.directory.join("image")).await
    }

    async fn load(&self) -> io::Result<Vec<u8>> {
        fs::read(self.directory.join("image")).await
    }

    async fn remove(&self) -> io::Result<()> {
        let _guard = self.write_lock.lock().await;
        match fs::remove_file(self.directory.join("image")).await {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }
}

fn image_content_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

// The app also has a Vite development origin. Only loopback pages may write
// local backgrounds, even though the existing public API has permissive CORS.
fn is_local_request(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    origin
        .to_str()
        .ok()
        .and_then(|origin| Url::parse(origin).ok())
        .is_some_and(|origin| {
            origin.scheme() == "http"
                && matches!(origin.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        })
}

pub async fn get_image(State(state): State<Arc<AppState>>) -> Response {
    match state.background.load().await {
        Ok(bytes) => match image_content_type(&bytes) {
            Some(content_type) => (
                [
                    (header::CONTENT_TYPE, content_type),
                    (header::CACHE_CONTROL, "no-store"),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                ],
                bytes,
            )
                .into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            StatusCode::NOT_FOUND.into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub async fn put_image(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    if !is_local_request(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    if image_content_type(&bytes).is_none() {
        return (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Json(json!({ "error": "Choose a PNG, JPEG or WebP image" })),
        )
            .into_response();
    }
    match state.background.save(&bytes).await {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Could not save background image" })),
        )
            .into_response(),
    }
}

pub async fn delete_image(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !is_local_request(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match state.background.remove().await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_supported_images_by_content() {
        assert_eq!(
            image_content_type(b"\x89PNG\r\n\x1a\nexample"),
            Some("image/png")
        );
        assert_eq!(
            image_content_type(b"\xff\xd8\xffexample"),
            Some("image/jpeg")
        );
        assert_eq!(
            image_content_type(b"RIFFxxxxWEBPexample"),
            Some("image/webp")
        );
        for bytes in [b"<svg></svg>".as_slice(), b"RIFF", b"WEBP", b""] {
            assert!(image_content_type(bytes).is_none());
        }
    }

    #[tokio::test]
    async fn background_survives_reopening_and_can_be_replaced_and_removed() {
        let directory = std::env::temp_dir().join(format!(
            "youterm-background-{:032x}",
            rand::random::<u128>()
        ));
        let store = BackgroundStore::new(directory.clone());
        assert_eq!(
            store.load().await.unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
        store.save(b"first image").await.unwrap();
        let reopened = BackgroundStore::new(directory.clone());
        assert_eq!(reopened.load().await.unwrap(), b"first image");
        reopened.save(b"replacement").await.unwrap();
        assert_eq!(store.load().await.unwrap(), b"replacement");
        store.remove().await.unwrap();
        store.remove().await.unwrap();
        assert_eq!(
            reopened.load().await.unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
        fs::remove_dir_all(directory).await.unwrap();
    }

    #[test]
    fn only_local_pages_can_modify_backgrounds() {
        let mut headers = HeaderMap::new();
        assert!(is_local_request(&headers));
        for origin in [
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "http://[::1]:3000",
        ] {
            headers.insert(header::ORIGIN, origin.parse().unwrap());
            assert!(is_local_request(&headers));
        }
        for origin in [
            "https://example.com",
            "http://localhost.example.com",
            "null",
            "invalid",
        ] {
            headers.insert(header::ORIGIN, origin.parse().unwrap());
            assert!(!is_local_request(&headers));
        }
    }
}
