#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod server;
pub mod state;
pub mod youtube;

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use tauri::WindowEvent;

use crate::state::AppState;

#[cfg(target_os = "linux")]
extern "C" {
    fn webkit_web_context_get_default() -> *mut std::ffi::c_void;
    fn webkit_web_context_set_cache_model(
        context: *mut std::ffi::c_void,
        cache_model: std::ffi::c_int,
    );
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowGeometry {
    width: f64,
    height: f64,
    maximized: bool,
}

impl Default for WindowGeometry {
    fn default() -> Self {
        Self {
            width: 1180.0,
            height: 800.0,
            maximized: false,
        }
    }
}

struct CliOptions {
    port: u16,
    data_dir: Option<PathBuf>,
    check: bool,
    smoke_test: bool,
    server_only: bool,
}

fn parse_cli() -> CliOptions {
    let mut opts = CliOptions {
        port: env::var("PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(3000),
        data_dir: None,
        check: false,
        smoke_test: false,
        server_only: false,
    };

    let args: Vec<String> = env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--check" => opts.check = true,
            "--smoke-test" => opts.smoke_test = true,
            "--server-only" | "--headless" => opts.server_only = true,
            "--port" => {
                if let Some(next) = args.get(i + 1) {
                    if let Ok(p) = next.parse::<u16>() {
                        if p >= 1024 {
                            opts.port = p;
                        }
                    }
                    i += 1;
                }
            }
            "--data-dir" => {
                if let Some(next) = args.get(i + 1) {
                    opts.data_dir = Some(PathBuf::from(next));
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }

    opts
}

fn resolve_config_dir(custom_data_dir: Option<&Path>) -> PathBuf {
    if let Some(base) = custom_data_dir {
        let dir = base.join("config");
        let _ = fs::create_dir_all(&dir);
        return dir;
    }
    let home = env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    let xdg_config = env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join(".config"));
    let dir = xdg_config.join("youterm");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn load_env_files(config_dir: &Path) {
    let mut candidates = Vec::new();
    if let Ok(custom) = env::var("YOUTERM_CONFIG_FILE") {
        candidates.push(PathBuf::from(custom));
    }
    candidates.push(config_dir.join(".env"));
    candidates.push(PathBuf::from(".env.local"));
    candidates.push(PathBuf::from(".env"));
    candidates.push(PathBuf::from("../.env"));

    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join(".env"));
            if let Some(grand) = parent.parent() {
                candidates.push(grand.join(".env"));
                if let Some(root) = grand.parent() {
                    candidates.push(root.join(".env"));
                }
            }
        }
    }

    for path in candidates {
        if path.is_file() {
            let _ = dotenvy::from_path(&path);
        }
    }
}

fn locate_static_dir() -> PathBuf {
    if let Ok(custom) = env::var("YOUTERM_STATIC_DIR") {
        let p = PathBuf::from(custom);
        if p.join("index.html").is_file() {
            return p;
        }
    }

    let mut candidates = vec![
        PathBuf::from("dist"),
        PathBuf::from("../dist"),
        PathBuf::from("/usr/lib/youterm/dist"),
        PathBuf::from("/usr/share/youterm/dist"),
    ];

    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("dist"));
            candidates.push(parent.join("../dist"));
            candidates.push(parent.join("../../dist"));
            candidates.push(parent.join("../../../dist"));
            candidates.push(parent.join("../lib/youterm/dist"));
        }
    }

    for candidate in candidates {
        if candidate.join("index.html").is_file() {
            if let Ok(canon) = candidate.canonicalize() {
                return canon;
            }
            return candidate;
        }
    }

    PathBuf::from("dist")
}

fn load_window_geometry(config_dir: &Path) -> WindowGeometry {
    let path = config_dir.join("window.json");
    let Ok(raw) = fs::read_to_string(path) else {
        return WindowGeometry::default();
    };
    let Ok(parsed) = serde_json::from_str::<WindowGeometry>(&raw) else {
        return WindowGeometry::default();
    };
    WindowGeometry {
        width: parsed.width.clamp(760.0, 3840.0),
        height: parsed.height.clamp(520.0, 2160.0),
        maximized: parsed.maximized,
    }
}

fn save_window_geometry(config_dir: &Path, geom: &WindowGeometry) {
    let path = config_dir.join("window.json");
    if let Ok(serialized) = serde_json::to_string(geom) {
        let _ = fs::write(path, serialized);
    }
}

fn bind_local_listener(preferred_port: u16) -> (TcpListener, u16) {
    if let Ok(listener) = TcpListener::bind(("127.0.0.1", preferred_port)) {
        let _ = listener.set_nonblocking(true);
        return (listener, preferred_port);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("Failed to bind local server port");
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(preferred_port);
    let _ = listener.set_nonblocking(true);
    (listener, port)
}

fn get_username() -> String {
    env::var("USER")
        .or_else(|_| env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string())
}

fn get_hostname() -> String {
    fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "linux".to_string())
}

fn build_initialization_script(smoke_test: bool) -> String {
    let username_json = serde_json::to_string(&get_username()).unwrap_or_else(|_| "\"user\"".to_string());
    let hostname_json = serde_json::to_string(&get_hostname()).unwrap_or_else(|_| "\"linux\"".to_string());

    let mut script = format!(
        r#"
(function() {{
  const openExt = (url) => {{
    fetch('/api/desktop/open-external', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ url: String(url) }})
    }}).catch(() => {{}});
  }};
  Object.defineProperty(window, '__YOUTERM_DESKTOP__', {{
    value: Object.freeze({{
      platform: 'linux',
      username: {username},
      hostname: {hostname},
      openExternal: openExt
    }}),
    configurable: false,
    writable: false
  }});
  document.addEventListener('click', (e) => {{
    const anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (anchor.target === '_blank' && (href.startsWith('https://') || href.startsWith('/api/auth/'))) {{
      e.preventDefault();
      const resolved = new URL(href, window.location.origin).toString();
      openExt(resolved);
    }}
  }}, true);
}})();
"#,
        username = username_json,
        hostname = hostname_json
    );

    if smoke_test {
        script.push_str(
            r#"
(function() {
  const checkUi = () => {
    const button = document.querySelector('button[aria-label="Open settings"]');
    const ready = !!button;
    if (!ready) {
      setTimeout(checkUi, 250);
      return;
    }
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="settings-title"]');
    if (!dialog) {
      button.click();
      setTimeout(checkUi, 150);
      return;
    }
    const payload = {
      ready: true,
      bridge: window.__YOUTERM_DESKTOP__?.platform === 'linux',
      settings: dialog.querySelectorAll('[role="tab"]').length === 6,
      themes: !!dialog.querySelector('#settings-tab-themes'),
      audio: !!(new Audio().canPlayType('audio/mp4; codecs="mp4a.40.2"') || new Audio().canPlayType('audio/webm; codecs="opus"')),
      font: getComputedStyle(document.body).fontFamily,
      width: window.innerWidth,
      height: window.innerHeight
    };
    fetch('/api/desktop/smoke-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  };
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => setTimeout(checkUi, 300));
  } else {
    setTimeout(checkUi, 300);
  }
})();
"#,
        );
    }

    script
}

fn configure_low_memory_environment() {
    let defaults = [
        ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
        ("JavaScriptCoreUseJIT", "0"),
        ("JSC_useJIT", "false"),
        ("Malloc", "1"),
        ("MALLOC_TRIM_THRESHOLD_", "65536"),
        ("MALLOC_ARENA_MAX", "2"),
    ];
    for (k, v) in defaults {
        if env::var_os(k).is_none() {
            env::set_var(k, v);
        }
    }
}

fn main() {
    configure_low_memory_environment();
    let opts = parse_cli();
    let config_dir = resolve_config_dir(opts.data_dir.as_deref());
    load_env_files(&config_dir);
    let static_dir = locate_static_dir();

    if opts.check {
        let report = json!({
            "engine": "rust-tauri-v2",
            "webkit": "2.52.6",
            "built": static_dir.join("index.html").is_file(),
            "gemini": false,
        });
        println!("{}", serde_json::to_string(&report).unwrap_or_default());
        return;
    }

    let (std_listener, bound_port) = bind_local_listener(opts.port);
    let app_state = AppState::new(bound_port, static_dir, opts.smoke_test);

    if opts.server_only {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
        rt.block_on(async move {
            let listener = tokio::net::TcpListener::from_std(std_listener)
                .expect("Failed to convert TcpListener");
            let router = server::build_router(app_state);
            println!("[YouTerm] Native Rust server listening on http://127.0.0.1:{}", bound_port);
            axum::serve(listener, router).await.expect("Axum server error");
        });
        return;
    }

    // Spawn background Axum HTTP server on a dedicated multi-threaded Tokio runtime
    let state_for_server = app_state.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
            .expect("Failed to create background Tokio runtime");

        rt.block_on(async move {
            let innertube_warm = state_for_server.innertube.clone();
            tokio::spawn(async move {
                innertube_warm.warm_connections().await;
            });
            let listener = tokio::net::TcpListener::from_std(std_listener)
                .expect("Failed to convert TcpListener");
            let router = server::build_router(state_for_server);
            axum::serve(listener, router).await.expect("Axum server error");
        });
    });

    let state_for_setup = app_state.clone();
    let config_for_setup = config_dir.clone();
    let smoke_test = opts.smoke_test;

    tauri::Builder::default()
        .setup(move |app| {
            // Apply WebKitGTK DOCUMENT_VIEWER cache model to minimize WebKitWebProcess RAM (~120 MB)
            #[cfg(target_os = "linux")]
            unsafe {
                let ctx = webkit_web_context_get_default();
                if !ctx.is_null() {
                    webkit_web_context_set_cache_model(ctx, 0);
                }
            }

            {
                let handle = app.handle().clone();
                let st = state_for_setup.clone();
                tauri::async_runtime::spawn(async move {
                    let mut guard = st.app_handle.write().await;
                    *guard = Some(handle);
                });
            }

            let geom = load_window_geometry(&config_for_setup);
            let target_url: tauri::Url = format!("http://localhost:{}", bound_port)
                .parse()
                .expect("Valid local URL");
            let init_script = build_initialization_script(smoke_test);

            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(target_url),
            )
            .title("YouTerm")
            .inner_size(geom.width, geom.height)
            .min_inner_size(760.0, 520.0)
            .maximized(geom.maximized)
            .background_color(tauri::window::Color(12, 12, 12, 255))
            .initialization_script(&init_script)
            .build()?;

            let win_clone = window.clone();
            let cfg_clone = config_for_setup.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { .. } = event {
                    if let Ok(size) = win_clone.inner_size() {
                        let scale = win_clone.scale_factor().unwrap_or(1.0);
                        let logical = size.to_logical::<f64>(scale);
                        let maximized = win_clone.is_maximized().unwrap_or(false);
                        save_window_geometry(
                            &cfg_clone,
                            &WindowGeometry {
                                width: logical.width,
                                height: logical.height,
                                maximized,
                            },
                        );
                    }
                }
            });

            if smoke_test {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(25));
                    eprintln!("Native smoke test timed out.");
                    handle.exit(1);
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error while running YouTerm Tauri application");
}
