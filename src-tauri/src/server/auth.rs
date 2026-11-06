use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    Json,
};
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::Manager;
use url::Url;

use crate::state::{AppState, AuthCallbackResult, PendingAuth};
use crate::youtube::cipher::{encode_hex, has_sapisid_cookie};

const COOKIE_NAME: &str = "youterm_oauth_state";
const AUTH_TTL_SECS: u64 = 600; // 10 minutes

#[derive(Debug, Deserialize)]
pub struct AuthUrlQuery {
    pub desktop: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StateQuery {
    pub state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenBody {
    pub code: Option<String>,
    pub state: Option<String>,
    pub redirect_uri: Option<String>,
}

fn random_hex(bytes_len: usize) -> String {
    let mut buf = vec![0u8; bytes_len];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

fn extract_cookie_state(headers: &HeaderMap) -> Option<String> {
    let cookie_hdr = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookie_hdr.split(';') {
        let trimmed = part.trim();
        if let Some(val) = trimmed.strip_prefix(&format!("{}=", COOKIE_NAME)) {
            return Some(val.to_string());
        }
    }
    None
}

fn build_state_cookie(state: &str, secure: bool) -> String {
    let sec_flag = if secure { "; Secure" } else { "" };
    format!(
        "{}={}; Path=/; Max-Age={}; HttpOnly; SameSite=Lax{}",
        COOKIE_NAME, state, AUTH_TTL_SECS, sec_flag
    )
}

fn clear_state_cookie() -> String {
    format!("{}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax", COOKIE_NAME)
}

/// GET /api/auth/setup
pub async fn auth_setup() -> Response {
    let client_id = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
    let project = regex::Regex::new(r"^(\d+)-[^/]+\.apps\.googleusercontent\.com$")
        .ok()
        .and_then(|re| re.captures(&client_id))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    let mut url = Url::parse("https://console.cloud.google.com/auth/audience").unwrap();
    if let Some(proj) = project {
        url.query_pairs_mut().append_pair("project", &proj);
    }

    let mut res = Redirect::to(url.as_str()).into_response();
    *res.status_mut() = StatusCode::SEE_OTHER;
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    res
}

const LOGIN_WINDOW_LABEL: &str = "youterm_google_login";
const GOOGLE_LOGIN_URL: &str = "https://accounts.google.com/AccountChooser?ltmpl=music&service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";
const LOGIN_USER_AGENT: &str =
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

fn collect_window_cookies(win: &tauri::WebviewWindow) -> Option<String> {
    let mut map: HashMap<String, String> = HashMap::new();
    for target in ["https://music.youtube.com/", "https://www.youtube.com/"] {
        if let Ok(url) = target.parse::<Url>() {
            if let Ok(cookies) = win.cookies_for_url(url) {
                for c in cookies {
                    let name = c.name().trim().to_string();
                    let val = c.value().trim().to_string();
                    if !name.is_empty() && !val.is_empty() {
                        map.insert(name, val);
                    }
                }
            }
        }
    }
    if map.is_empty() {
        return None;
    }
    let joined: Vec<String> = map.into_iter().map(|(k, v)| format!("{}={}", k, v)).collect();
    let header = joined.join("; ");
    if has_sapisid_cookie(&header) {
        Some(header)
    } else {
        None
    }
}

fn spawn_native_login_window(
    app_handle: tauri::AppHandle,
    state: Arc<AppState>,
    state_token: String,
) {
    tokio::spawn(async move {
        let app_for_build = app_handle.clone();
        let closed_flag = Arc::new(AtomicBool::new(false));
        let closed_for_event = closed_flag.clone();

        let win_res = tokio::task::spawn_blocking(move || {
            if let Some(existing) = app_for_build.get_webview_window(LOGIN_WINDOW_LABEL) {
                let _ = existing.close();
                std::thread::sleep(Duration::from_millis(150));
            }

            let target_url: tauri::Url = GOOGLE_LOGIN_URL.parse().expect("Valid Google login URL");
            let win = tauri::WebviewWindowBuilder::new(
                &app_for_build,
                LOGIN_WINDOW_LABEL,
                tauri::WebviewUrl::External(target_url),
            )
            .title("YouTerm — Sign in to Google / YouTube Music")
            .inner_size(520.0, 680.0)
            .min_inner_size(400.0, 500.0)
            .center()
            .user_agent(LOGIN_USER_AGENT)
            .build()?;

            win.on_window_event(move |event| {
                if matches!(
                    event,
                    tauri::WindowEvent::Destroyed | tauri::WindowEvent::CloseRequested { .. }
                ) {
                    closed_for_event.store(true, Ordering::SeqCst);
                }
            });

            Ok::<tauri::WebviewWindow, tauri::Error>(win)
        })
        .await;

        let win = match win_res {
            Ok(Ok(w)) => w,
            _ => {
                let mut pending = state.oauth_pending.write().await;
                if let Some(auth) = pending.get_mut(&state_token) {
                    auth.result = Some(AuthCallbackResult {
                        code: None,
                        error: Some(
                            "Could not open the Google sign-in window. Please try again."
                                .to_string(),
                        ),
                    });
                }
                return;
            }
        };

        let deadline = Instant::now() + Duration::from_secs(AUTH_TTL_SECS);
        while Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(450)).await;

            {
                let pending = state.oauth_pending.read().await;
                let Some(auth) = pending.get(&state_token) else {
                    let win_close = win.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        let _ = win_close.close();
                    })
                    .await;
                    return;
                };
                if auth.result.is_some() {
                    return;
                }
            }

            if closed_flag.load(Ordering::SeqCst) {
                let mut pending = state.oauth_pending.write().await;
                if let Some(auth) = pending.get_mut(&state_token) {
                    if auth.result.is_none() {
                        auth.result = Some(AuthCallbackResult {
                            code: None,
                            error: Some(
                                "Google sign-in was closed before it completed. Please connect again."
                                    .to_string(),
                            ),
                        });
                    }
                }
                return;
            }

            let win_check = win.clone();
            let check_res = tokio::task::spawn_blocking(move || {
                let url = win_check.url().ok()?;
                let host = url.host_str().unwrap_or("");
                if host == "music.youtube.com" || host == "www.youtube.com" {
                    if collect_window_cookies(&win_check).is_some() {
                        std::thread::sleep(Duration::from_millis(350));
                        return collect_window_cookies(&win_check);
                    }
                }
                None
            })
            .await;

            if let Ok(Some(cookie_header)) = check_res {
                let session_token = format!("ytm_session:{}", encode_hex(cookie_header.as_bytes()));
                {
                    let mut pending = state.oauth_pending.write().await;
                    if let Some(auth) = pending.get_mut(&state_token) {
                        auth.result = Some(AuthCallbackResult {
                            code: Some(session_token),
                            error: None,
                        });
                    }
                }
                closed_flag.store(true, Ordering::SeqCst);
                let win_close = win.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    let _ = win_close.close();
                })
                .await;
                return;
            }
        }
    });
}

/// GET /api/auth/url
pub async fn get_auth_url(
    Query(query): Query<AuthUrlQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    let raw_origin = headers
        .get("X-YouTerm-Origin")
        .or_else(|| headers.get(header::ORIGIN))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .or_else(|| {
            headers
                .get(header::HOST)
                .and_then(|h| h.to_str().ok())
                .map(|h| format!("http://{}", h))
        })
        .unwrap_or_else(|| format!("http://localhost:{}", state.port));

    let Ok(origin) = Url::parse(&raw_origin) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cannot determine the sign-in callback URL. Open YouTerm using localhost or its public URL." })),
        )
            .into_response();
    };

    if !matches!(origin.scheme(), "http" | "https")
        || !origin.username().is_empty()
        || origin.password().is_some()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cannot determine the sign-in callback URL. Open YouTerm using localhost or its public URL." })),
        )
            .into_response();
    }

    let host_str = origin.host_str().unwrap_or("");
    if host_str == "0.0.0.0" || host_str == "[::]" {
        let port_suffix = origin.port().map(|p| format!(":{}", p)).unwrap_or_default();
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Open http://localhost{} to connect with Google. The server bind address cannot be used for sign-in.", port_suffix)
            })),
        )
            .into_response();
    }

    let origin_base = origin.origin().ascii_serialization();
    let redirect_uri = format!("{}/auth/callback", origin_base);
    let is_desktop = query.desktop.as_deref() == Some("1");
    let app_handle_opt = state.app_handle.read().await.clone();

    // Native Tauri desktop login flow (no GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET or Test Users required)
    if let Some(app_handle) = app_handle_opt {
        let mut pending = state.oauth_pending.write().await;
        pending.retain(|_, auth| auth.expires_at > Instant::now());
        if pending.len() >= 1000 {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({ "error": "Too many sign-in attempts. Please try again shortly." })),
            )
                .into_response();
        }

        let state_token = random_hex(32);
        pending.insert(
            state_token.clone(),
            PendingAuth {
                redirect_uri: redirect_uri.clone(),
                expires_at: Instant::now() + Duration::from_secs(AUTH_TTL_SECS),
                auth_url: Some(GOOGLE_LOGIN_URL.to_string()),
                desktop: true,
                result: None,
            },
        );
        drop(pending);

        spawn_native_login_window(app_handle, state.clone(), state_token.clone());

        let body_obj = json!({
            "configured": true,
            "nativeWindow": true,
            "url": GOOGLE_LOGIN_URL,
            "redirectUri": redirect_uri,
            "state": state_token,
            "startUrl": format!("{}/api/auth/desktop/start?state={}", origin_base, state_token),
        });

        let mut res = Json(body_obj).into_response();
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        );
        if let Ok(cookie_val) = HeaderValue::from_str(&build_state_cookie(
            &state_token,
            origin.scheme() == "https",
        )) {
            res.headers_mut().insert(header::SET_COOKIE, cookie_val);
        }
        return res;
    }

    let client_id = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
    let client_secret = std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default();

    if client_id.is_empty() || client_secret.is_empty() {
        let mut res = (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "configured": false,
                "url": null,
                "error": "Google sign-in is unavailable in headless mode without GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or paste a Google session/OAuth token to sync."
            })),
        )
            .into_response();
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        );
        return res;
    }

    let mut pending = state.oauth_pending.write().await;
    pending.retain(|_, auth| auth.expires_at > Instant::now());
    if pending.len() >= 1000 {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Too many sign-in attempts. Please try again shortly." })),
        )
            .into_response();
    }

    let state_token = random_hex(32);
    let mut google_url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    google_url
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "https://www.googleapis.com/auth/youtube.readonly")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &state_token);

    let auth_url_str = google_url.to_string();
    pending.insert(
        state_token.clone(),
        PendingAuth {
            redirect_uri: redirect_uri.clone(),
            expires_at: Instant::now() + Duration::from_secs(AUTH_TTL_SECS),
            auth_url: Some(auth_url_str.clone()),
            desktop: is_desktop,
            result: None,
        },
    );
    drop(pending);

    let mut body_obj = json!({
        "configured": true,
        "url": auth_url_str,
        "redirectUri": redirect_uri,
        "state": state_token,
    });
    if is_desktop {
        body_obj["startUrl"] = Value::String(format!(
            "{}/api/auth/desktop/start?state={}",
            origin_base, state_token
        ));
    }

    let mut res = Json(body_obj).into_response();
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    if let Ok(cookie_val) = HeaderValue::from_str(&build_state_cookie(
        &state_token,
        origin.scheme() == "https",
    )) {
        res.headers_mut().insert(header::SET_COOKIE, cookie_val);
    }
    res
}

/// GET /api/auth/desktop/start
pub async fn desktop_auth_start(
    Query(query): Query<StateQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let state_token = query.state.unwrap_or_default();
    let pending = state.oauth_pending.read().await;
    let Some(auth) = pending.get(&state_token) else {
        return (
            StatusCode::BAD_REQUEST,
            "Sign-in expired. Return to YouTerm and connect again.",
        )
            .into_response();
    };

    if !auth.desktop || auth.expires_at <= Instant::now() || auth.auth_url.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            "Sign-in expired. Return to YouTerm and connect again.",
        )
            .into_response();
    }

    let auth_url = auth.auth_url.clone().unwrap();
    let is_https = auth.redirect_uri.starts_with("https://");
    drop(pending);

    let mut res = Redirect::to(&auth_url).into_response();
    *res.status_mut() = StatusCode::SEE_OTHER;
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    res.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    if let Ok(cookie_val) = HeaderValue::from_str(&build_state_cookie(&state_token, is_https)) {
        res.headers_mut().insert(header::SET_COOKIE, cookie_val);
    }
    res
}

/// GET /api/auth/desktop/result
pub async fn desktop_auth_result(
    Query(query): Query<StateQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    let state_token = query.state.unwrap_or_default();
    let cookie_state = extract_cookie_state(&headers).unwrap_or_default();
    if state_token.is_empty() || state_token != cookie_state {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Sign-in expired. Please connect with Google again." })),
        )
            .into_response();
    }

    let mut pending = state.oauth_pending.write().await;
    let Some(auth) = pending.get(&state_token).cloned() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Sign-in expired. Please connect with Google again." })),
        )
            .into_response();
    };

    if !auth.desktop || auth.expires_at <= Instant::now() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Sign-in expired. Please connect with Google again." })),
        )
            .into_response();
    }

    let Some(result) = auth.result else {
        return Json(json!({ "pending": true })).into_response();
    };

    if result.error.is_some() {
        pending.remove(&state_token);
    }

    let mut resp_json = json!({ "pending": false });
    if let Some(code) = result.code {
        resp_json["code"] = Value::String(code);
    }
    if let Some(err) = result.error {
        resp_json["error"] = Value::String(err);
    }
    Json(resp_json).into_response()
}

/// GET /auth/callback
pub async fn auth_callback(
    Query(query): Query<CallbackQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    let state_token = query.state.unwrap_or_default();
    let cookie_state = extract_cookie_state(&headers).unwrap_or_default();

    let mut pending = state.oauth_pending.write().await;
    let valid_auth = if !state_token.is_empty() && state_token == cookie_state {
        pending
            .get_mut(&state_token)
            .filter(|a| a.expires_at > Instant::now())
    } else {
        None
    };

    let Some(auth) = valid_auth else {
        return (
            StatusCode::BAD_REQUEST,
            "Sign-in expired or could not be verified. Close this window and connect again from YouTerm.",
        )
            .into_response();
    };

    let code_val = query.code.unwrap_or_default();
    let failed = query.error.is_some() || code_val.is_empty();
    let error_msg = if query.error.as_deref() == Some("access_denied") {
        "Google denied access (access_denied). If the app is in Testing, add the Google account used to sign in under Google Cloud > Google Auth platform > Audience > Test users, save, and connect again. If you declined the permissions, connect again and approve access."
    } else {
        "Google sign-in failed. Please connect again."
    };

    if auth.desktop {
        auth.result = Some(if failed {
            AuthCallbackResult {
                code: None,
                error: Some(error_msg.to_string()),
            }
        } else {
            AuthCallbackResult {
                code: Some(code_val),
                error: None,
            }
        });

        let heading = if failed {
            "Google sign-in did not complete"
        } else {
            "Google sign-in received"
        };
        let html = format!(
            "<!doctype html><html><head><title>YouTerm — Google sign-in</title>\
            <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
            <style>body{{background:#0c0c0c;color:#22c55e;font:16px monospace;padding:40px;text-align:center}}</style></head>\
            <body><h2>{}</h2><p>Return to the YouTerm app. You can close this browser tab.</p></body></html>",
            heading
        );
        return Html(html).into_response();
    }

    let redirect_uri = auth.redirect_uri.clone();
    if failed {
        pending.remove(&state_token);
    }
    drop(pending);

    let mut message = json!({
        "type": "YOUTERM_OAUTH_CALLBACK",
        "state": state_token,
        "redirectUri": redirect_uri,
    });
    if failed {
        message["error"] = Value::String(error_msg.to_string());
    } else {
        message["code"] = Value::String(code_val);
    }

    let serialized_msg = serde_json::to_string(&message)
        .unwrap_or_default()
        .replace('<', "\\u003c");
    let target_origin = Url::parse(&redirect_uri)
        .map(|u| u.origin().ascii_serialization())
        .unwrap_or_default();
    let serialized_origin = serde_json::to_string(&target_origin)
        .unwrap_or_default()
        .replace('<', "\\u003c");
    let nonce = random_hex(16);
    let heading = if failed {
        "Google sign-in did not complete"
    } else {
        "Completing Google sign-in…"
    };

    let html = format!(
        "<!doctype html><html><head><title>YouTerm — Google sign-in</title>\
        <style>body{{background:#0c0c0c;color:#22c55e;font-family:monospace;padding:40px;text-align:center}}</style></head>\
        <body><h2>{}</h2>\
        <p id=\"status\">Returning to YouTerm…</p><script nonce=\"{}\">\
        const message = {};\
        let delivered = false;\
        if (typeof BroadcastChannel !== 'undefined') {{\
          const channel = new BroadcastChannel('youterm_oauth_' + message.state);\
          channel.postMessage(message);\
          channel.close();\
          delivered = true;\
        }}\
        if (window.opener && !window.opener.closed) {{\
          window.opener.postMessage(message, {});\
          delivered = true;\
        }}\
        if (delivered) {{\
          setTimeout(() => window.close(), 600);\
        }} else {{\
          document.getElementById('status').textContent = 'Close this window and connect again from YouTerm. Allow popups for this site.';\
        }}\
        </script></body></html>",
        heading, nonce, serialized_msg, serialized_origin
    );

    let mut res = Html(html).into_response();
    if let Ok(csp) = HeaderValue::from_str(&format!(
        "default-src 'none'; script-src 'nonce-{}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        nonce
    )) {
        res.headers_mut().insert(header::CONTENT_SECURITY_POLICY, csp);
    }
    res
}

/// POST /api/auth/token
pub async fn exchange_auth_token(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Json(body): Json<TokenBody>,
) -> Response {
    let code = body.code.unwrap_or_default();
    let state_token = body.state.unwrap_or_default();
    let redirect_uri = body.redirect_uri.unwrap_or_default();
    let cookie_state = extract_cookie_state(&headers).unwrap_or_default();

    let mut pending = state.oauth_pending.write().await;
    let valid = if !state_token.is_empty() && state_token == cookie_state && !code.is_empty() {
        pending
            .get(&state_token)
            .filter(|a| a.expires_at > Instant::now() && a.redirect_uri == redirect_uri)
            .cloned()
    } else {
        None
    };

    let Some(auth) = valid else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Sign-in expired or could not be verified. Please connect with Google again." })),
        )
            .into_response();
    };

    if code.starts_with("ytm_session:") {
        pending.remove(&state_token);
        drop(pending);

        let mut res = Json(json!({
            "access_token": code,
            "refresh_token": null,
            "expires_in": 31536000,
        }))
        .into_response();
        if let Ok(cookie_val) = HeaderValue::from_str(&clear_state_cookie()) {
            res.headers_mut().insert(header::SET_COOKIE, cookie_val);
        }
        return res;
    }

    let client_id = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
    let client_secret = std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default();
    if client_id.is_empty() || client_secret.is_empty() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "Google sign-in credentials are missing on the server." })),
        )
            .into_response();
    }

    pending.remove(&state_token);
    drop(pending);

    let params = [
        ("code", code.as_str()),
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("redirect_uri", auth.redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];

    let Ok(resp) = state
        .innertube
        .http()
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .timeout(Duration::from_secs(15))
        .send()
        .await
    else {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "The server could not reach Google to complete sign-in. Check its internet connection and try again." })),
        )
            .into_response();
    };

    let status_ok = resp.status().is_success();
    let Ok(data) = resp.json::<Value>().await else {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "Google returned an invalid token response." })),
        )
            .into_response();
    };

    let access_token = data.get("access_token").and_then(|v| v.as_str());
    if !status_ok || access_token.is_none() {
        let err_code = data.get("error").and_then(|v| v.as_str()).unwrap_or("");
        let msg = if err_code == "invalid_grant" {
            "Google sign-in expired. Please connect again and check that the callback URL is authorized in Google Cloud."
        } else {
            data.get("error_description")
                .and_then(|v| v.as_str())
                .unwrap_or("Google could not complete sign-in. Check the OAuth client configuration.")
        };
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))).into_response();
    }

    let mut res = Json(json!({
        "access_token": data.get("access_token"),
        "refresh_token": data.get("refresh_token"),
        "expires_in": data.get("expires_in"),
    }))
    .into_response();
    if let Ok(cookie_val) = HeaderValue::from_str(&clear_state_cookie()) {
        res.headers_mut().insert(header::SET_COOKIE, cookie_val);
    }
    res
}
