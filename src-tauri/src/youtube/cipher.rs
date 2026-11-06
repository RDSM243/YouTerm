use url::Url;

/// Validate that a resolved media stream URL points to an authentic Google Video host over HTTPS
pub fn is_media_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url
            .host_str()
            .map(|h| h.ends_with(".googlevideo.com"))
            .unwrap_or(false)
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.port(), None | Some(443))
}

/// Validate a 11-character YouTube video ID
pub fn is_valid_video_id(video_id: &str) -> bool {
    video_id.len() == 11
        && video_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Parse a `signatureCipher` or `cipher` query string if present in an InnerTube adaptiveFormat
pub fn parse_signature_cipher(cipher_str: &str) -> Option<String> {
    let mut base_url: Option<String> = None;
    let mut sig: Option<String> = None;
    let mut sp: String = "sig".to_string();

    for pair in url::form_urlencoded::parse(cipher_str.as_bytes()) {
        match pair.0.as_ref() {
            "url" => base_url = Some(pair.1.into_owned()),
            "s" => sig = Some(pair.1.into_owned()),
            "sp" => sp = pair.1.into_owned(),
            _ => {}
        }
    }

    let url_str = base_url?;
    if sig.is_some() {
        // Ciphered signatures require a JS player runtime; return None so the caller falls back cleanly
        return None;
    }
    let _ = sp;
    Some(url_str)
}

/// URL-encode query string component
pub fn urlencode(data: &str) -> String {
    url::form_urlencoded::byte_serialize(data.as_bytes()).collect()
}

/// Pure Rust RFC 3174 SHA-1 implementation for InnerTube SAPISIDHASH authentication
pub fn sha1_hex(data: &[u8]) -> String {
    let mut h0: u32 = 0x67452301;
    let mut h1: u32 = 0xEFCDAB89;
    let mut h2: u32 = 0x98BADCFE;
    let mut h3: u32 = 0x10325476;
    let mut h4: u32 = 0xC3D2E1F0;

    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let mut a = h0;
        let mut b = h1;
        let mut c = h2;
        let mut d = h3;
        let mut e = h4;

        for i in 0..80 {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(w[i]);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    format!("{:08x}{:08x}{:08x}{:08x}{:08x}", h0, h1, h2, h3, h4)
}

pub fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn decode_hex(hex: &str) -> Option<String> {
    let trimmed = hex.trim();
    if trimmed.is_empty() || trimmed.len() % 2 != 0 {
        return None;
    }
    let mut bytes = Vec::with_capacity(trimmed.len() / 2);
    let raw = trimmed.as_bytes();
    let mut i = 0;
    while i < raw.len() {
        let pair = std::str::from_utf8(&raw[i..i + 2]).ok()?;
        let val = u8::from_str_radix(pair, 16).ok()?;
        bytes.push(val);
        i += 2;
    }
    String::from_utf8(bytes).ok()
}

/// Extract cookie header from either a `ytm_session:<hex>` token or raw cookie string
pub fn extract_session_cookies(token_or_cookie: &str) -> Option<String> {
    let trimmed = token_or_cookie
        .trim()
        .strip_prefix("Bearer ")
        .unwrap_or(token_or_cookie.trim())
        .trim();
    if let Some(hex_part) = trimmed.strip_prefix("ytm_session:") {
        let decoded = decode_hex(hex_part)?;
        if has_sapisid_cookie(&decoded) {
            return Some(decoded);
        }
        return None;
    }
    if has_sapisid_cookie(trimmed) {
        return Some(trimmed.to_string());
    }
    None
}

pub fn has_sapisid_cookie(cookie_header: &str) -> bool {
    let mut has_sapi = false;
    let mut has_sid = false;
    for part in cookie_header.split(';') {
        if let Some((k, v)) = part.trim().split_once('=') {
            let key = k.trim();
            let val = v.trim();
            if val.is_empty() {
                continue;
            }
            if matches!(key, "SAPISID" | "__Secure-3PAPISID" | "__Secure-1PAPISID") {
                has_sapi = true;
            }
            if matches!(
                key,
                "SID" | "__Secure-3PSID" | "__Secure-1PSID" | "LOGIN_INFO" | "HSID"
            ) {
                has_sid = true;
            }
        }
    }
    has_sapi && has_sid
}

/// Build the YouTube InnerTube `SAPISIDHASH` Authorization header from a cookie string
pub fn build_sapisidhash_header(cookie_header: &str, origin: &str) -> Option<String> {
    let mut sapisid = None;
    let mut papisid_1p = None;
    let mut papisid_3p = None;

    for part in cookie_header.split(';') {
        if let Some((k, v)) = part.trim().split_once('=') {
            let key = k.trim();
            let val = v.trim();
            if val.is_empty() {
                continue;
            }
            match key {
                "SAPISID" => sapisid = Some(val.to_string()),
                "__Secure-1PAPISID" => papisid_1p = Some(val.to_string()),
                "__Secure-3PAPISID" => papisid_3p = Some(val.to_string()),
                _ => {}
            }
        }
    }

    let primary = sapisid
        .or_else(|| papisid_3p.clone())
        .or_else(|| papisid_1p.clone())?;
    let p1 = papisid_1p.unwrap_or_else(|| primary.clone());
    let p3 = papisid_3p.unwrap_or_else(|| primary.clone());

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let h0 = sha1_hex(format!("{} {} {}", ts, primary, origin).as_bytes());
    let h1 = sha1_hex(format!("{} {} {}", ts, p1, origin).as_bytes());
    let h3 = sha1_hex(format!("{} {} {}", ts, p3, origin).as_bytes());

    Some(format!(
        "SAPISIDHASH {}_{} SAPISID1PHASH {}_{} SAPISID3PHASH {}_{}",
        ts, h0, ts, h1, ts, h3
    ))
}
