use bytes::Bytes;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::server::background::BackgroundStore;
use crate::server::lyrics::LyricsService;
use crate::youtube::albums::TrackAlbum;
use crate::youtube::innertube::InnerTubeClient;
use crate::youtube::models::ExploreCategory;

#[derive(Debug, Clone)]
pub struct PendingAuth {
    pub redirect_uri: String,
    pub expires_at: Instant,
    pub auth_url: Option<String>,
    pub desktop: bool,
    pub result: Option<AuthCallbackResult>,
}

#[derive(Debug, Clone)]
pub struct AuthCallbackResult {
    pub code: Option<String>,
    pub error: Option<String>,
}

pub struct AppState {
    pub innertube: InnerTubeClient,
    pub explore_cache: RwLock<Option<(Vec<ExploreCategory>, Instant)>>,
    pub fonts_cache: RwLock<Option<Vec<String>>>,
    pub image_cache: RwLock<HashMap<String, (Bytes, String, Instant)>>,
    pub lyrics: LyricsService,
    pub background: BackgroundStore,
    pub album_cache: RwLock<HashMap<String, (Option<TrackAlbum>, Instant)>>,
    pub oauth_pending: RwLock<HashMap<String, PendingAuth>>,
    pub port: u16,
    pub static_dir: PathBuf,
    pub smoke_test: bool,
    pub app_handle: RwLock<Option<tauri::AppHandle>>,
}

impl AppState {
    pub fn new(port: u16, static_dir: PathBuf, config_dir: PathBuf, smoke_test: bool) -> Arc<Self> {
        Arc::new(Self {
            innertube: InnerTubeClient::new(),
            explore_cache: RwLock::new(None),
            fonts_cache: RwLock::new(None),
            image_cache: RwLock::new(HashMap::new()),
            lyrics: LyricsService::default(),
            background: BackgroundStore::new(config_dir.join("background")),
            album_cache: RwLock::new(HashMap::new()),
            oauth_pending: RwLock::new(HashMap::new()),
            port,
            static_dir,
            smoke_test,
            app_handle: RwLock::new(None),
        })
    }
}
