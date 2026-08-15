// Web Research — opt-in, user-directed HTTPS page fetching.
//
// PrismOS is offline-first: this module is the ONLY code path (besides the
// optional Email Keeper) that can talk to anything beyond localhost, and it
// is tripled-gated:
//
//   1. OFF by default — a process-wide AtomicBool that starts `false` on every
//      launch. The frontend Settings toggle must explicitly enable it.
//   2. User-directed only — it fetches exactly the URLs the user typed. There
//      is no search engine, no crawling, no telemetry, no background use.
//   3. HTTPS-only, public hosts only — plain http, localhost, and private/
//      link-local LAN addresses are refused, so a chat message can never be
//      used to probe the user's own machine or network.
//
// Fetched HTML is reduced to plain text locally (script/style stripped) and
// size-capped before it is handed to the local model for synthesis.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Process-wide enable flag. Always starts disabled; the Settings toggle
/// (persisted by the frontend) re-enables it on each launch via the
/// `set_web_research_enabled` command.
static WEB_RESEARCH_ENABLED: AtomicBool = AtomicBool::new(false);

const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
/// Hard cap on downloaded bytes per page (streamed, so an endless response
/// can't balloon memory).
const MAX_FETCH_BYTES: usize = 2 * 1024 * 1024;
/// Cap on the extracted plain text handed back over IPC.
const MAX_TEXT_CHARS: usize = 40_000;

pub fn set_enabled(enabled: bool) {
    WEB_RESEARCH_ENABLED.store(enabled, Ordering::SeqCst);
}

pub fn is_enabled() -> bool {
    WEB_RESEARCH_ENABLED.load(Ordering::SeqCst)
}

#[derive(Serialize)]
pub struct FetchedPage {
    pub url: String,
    pub title: String,
    pub text: String,
    pub truncated: bool,
}

/// Validate that a URL is https and points at a public host.
/// Returns the host on success (used for logging), or a user-facing error.
pub fn validate_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    let rest = trimmed
        .strip_prefix("https://")
        .ok_or_else(|| "Only https:// URLs can be fetched.".to_string())?;
    // host = up to the first '/', '?' or '#'; then strip :port and userinfo.
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .trim();
    if authority.is_empty() {
        return Err("URL has no host.".to_string());
    }
    if authority.contains('@') {
        return Err("URLs with embedded credentials are not allowed.".to_string());
    }
    // IPv6 literal like [::1]:443 — keep the bracketed part as the host.
    let host = if let Some(stripped) = authority.strip_prefix('[') {
        stripped.split(']').next().unwrap_or("").to_string()
    } else {
        authority.split(':').next().unwrap_or("").to_string()
    };
    let host_lc = host.to_lowercase();
    if host_lc.is_empty() {
        return Err("URL has no host.".to_string());
    }
    if is_private_host(&host_lc) {
        return Err(format!(
            "\"{host_lc}\" is a local/private address — Web Research only fetches public sites."
        ));
    }
    Ok(host_lc)
}

/// True for localhost, .local, and RFC-1918 / link-local / loopback addresses.
fn is_private_host(host: &str) -> bool {
    if host == "localhost" || host == "0.0.0.0" || host.ends_with(".local") || host.ends_with(".localhost") {
        return true;
    }
    if host == "::1" || host.starts_with("fe80:") || host.starts_with("fc") || host.starts_with("fd") {
        return true; // IPv6 loopback / link-local / unique-local
    }
    let octets: Vec<u8> = host
        .split('.')
        .filter_map(|p| p.parse::<u8>().ok())
        .collect();
    if octets.len() == 4 && host.split('.').count() == 4 {
        return match (octets[0], octets[1]) {
            (127, _) => true,           // loopback
            (10, _) => true,            // RFC-1918
            (192, 168) => true,         // RFC-1918
            (172, b) if (16..=31).contains(&b) => true, // RFC-1918
            (169, 254) => true,         // link-local
            _ => false,
        };
    }
    false
}

/// Fetch a single user-named URL and return its readable text.
/// Refuses immediately when the feature is disabled.
pub async fn fetch_url_as_text(url: &str) -> Result<FetchedPage, String> {
    if !is_enabled() {
        return Err(
            "Web Research is disabled (PrismOS is offline by default). \
             Enable it in Settings → 🌐 Web Research first."
                .to_string(),
        );
    }
    validate_url(url)?;

    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("PrismOS-AI/0.6 (local research; user-directed)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client
        .get(url.trim())
        .send()
        .await
        .map_err(|e| format!("Fetch failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Fetch failed: HTTP {}", resp.status()));
    }
    // Re-validate where redirects actually landed — a public URL must not be
    // able to bounce us onto localhost or the LAN.
    let final_url = resp.url().to_string();
    validate_url(&final_url)
        .map_err(|e| format!("Redirected to a non-fetchable address: {e}"))?;

    let mut bytes: Vec<u8> = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX_FETCH_BYTES {
            bytes.extend_from_slice(&chunk[..MAX_FETCH_BYTES - bytes.len()]);
            truncated = true;
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&bytes);

    let title = extract_title(&body).unwrap_or_else(|| url.trim().to_string());
    let mut text = html_to_text(&body);
    if text.chars().count() > MAX_TEXT_CHARS {
        text = text.chars().take(MAX_TEXT_CHARS).collect();
        truncated = true;
    }
    if text.trim().is_empty() {
        return Err("The page had no readable text (it may be script-rendered or non-HTML).".to_string());
    }

    Ok(FetchedPage {
        url: final_url,
        title,
        text,
        truncated,
    })
}

/// ASCII-only lowercase that preserves byte offsets exactly (Unicode
/// `to_lowercase()` can change byte lengths — e.g. 'İ' — which would
/// misalign indices found in the lowered copy against the original).
fn ascii_lower(s: &str) -> String {
    s.chars().map(|c| c.to_ascii_lowercase()).collect()
}

fn extract_title(html: &str) -> Option<String> {
    let lower = ascii_lower(html);
    let start = lower.find("<title")?;
    let open_end = html[start..].find('>')? + start + 1;
    let close = lower[open_end..].find("</title")? + open_end;
    let raw = decode_entities(html[open_end..close].trim());
    if raw.is_empty() { None } else { Some(raw) }
}

/// Reduce HTML to readable plain text: drop script/style/noscript bodies,
/// strip tags (block-level tags become newlines), decode common entities,
/// collapse whitespace. Deliberately dependency-free.
pub fn html_to_text(html: &str) -> String {
    let cleaned = strip_element(html, "script");
    let cleaned = strip_element(&cleaned, "style");
    let cleaned = strip_element(&cleaned, "noscript");

    let mut out = String::with_capacity(cleaned.len() / 2);
    let mut chars = cleaned.char_indices().peekable();
    while let Some((i, ch)) = chars.next() {
        if ch == '<' {
            // Peek the tag name to decide whether it breaks a line.
            let rest = &cleaned[i + 1..];
            let tag: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '/')
                .collect::<String>()
                .to_lowercase();
            let name = tag.trim_start_matches('/');
            if matches!(
                name,
                "p" | "br" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
                    | "section" | "article" | "table" | "ul" | "ol" | "blockquote"
            ) {
                out.push('\n');
            }
            // Skip to the closing '>'.
            for (_, c) in chars.by_ref() {
                if c == '>' {
                    break;
                }
            }
            continue;
        }
        out.push(ch);
    }

    collapse_whitespace(&decode_entities(&out))
}

/// Remove `<name …>…</name>` blocks case-insensitively (script/style/noscript).
fn strip_element(html: &str, name: &str) -> String {
    let lower = ascii_lower(html);
    let open_pat = format!("<{name}");
    let close_pat = format!("</{name}");
    let mut out = String::with_capacity(html.len());
    let mut pos = 0;
    while let Some(rel) = lower[pos..].find(&open_pat) {
        let start = pos + rel;
        out.push_str(&html[pos..start]);
        match lower[start..].find(&close_pat) {
            Some(close_rel) => {
                let close_start = start + close_rel;
                // Skip past the closing tag's '>'.
                match lower[close_start..].find('>') {
                    Some(gt) => pos = close_start + gt + 1,
                    None => return out, // unterminated — drop the rest
                }
            }
            None => return out, // unterminated block — drop the rest
        }
    }
    out.push_str(&html[pos..]);
    out
}

fn decode_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&hellip;", "…")
}

/// Collapse runs of spaces/tabs and limit blank lines to one in a row.
fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank_lines = 0;
    for line in text.lines() {
        let squeezed: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if squeezed.is_empty() {
            blank_lines += 1;
            if blank_lines <= 1 && !out.is_empty() {
                out.push('\n');
            }
        } else {
            blank_lines = 0;
            out.push_str(&squeezed);
            out.push('\n');
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gate_defaults_off_and_toggles() {
        // Fresh process state: disabled until explicitly enabled.
        assert!(!is_enabled());
        set_enabled(true);
        assert!(is_enabled());
        set_enabled(false);
        assert!(!is_enabled());
    }

    #[test]
    fn validate_url_requires_https() {
        assert!(validate_url("http://example.com").is_err());
        assert!(validate_url("ftp://example.com").is_err());
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("example.com").is_err());
        assert_eq!(validate_url("https://example.com/a?b=c").unwrap(), "example.com");
        assert_eq!(validate_url("https://Example.COM:8443/x").unwrap(), "example.com");
    }

    #[test]
    fn validate_url_blocks_private_hosts() {
        for bad in [
            "https://localhost/admin",
            "https://localhost:11434/api/tags",
            "https://127.0.0.1/",
            "https://10.0.0.5/router",
            "https://192.168.1.1/",
            "https://172.16.0.1/",
            "https://172.31.255.255/",
            "https://169.254.1.1/",
            "https://printer.local/",
            "https://[::1]/",
            "https://user:pass@example.com/",
        ] {
            assert!(validate_url(bad).is_err(), "should reject {bad}");
        }
        // 172.32.x is public; 172.15.x is public.
        assert!(validate_url("https://172.32.0.1/").is_ok());
        assert!(validate_url("https://172.15.0.1/").is_ok());
    }

    #[test]
    fn html_to_text_strips_scripts_styles_and_tags() {
        let html = r#"<html><head><title>T &amp; U</title>
            <style>body { color: red; }</style>
            <SCRIPT>var secret = "nope";</SCRIPT></head>
            <body><h1>Header</h1><p>First &quot;para&quot;.</p>
            <div>Second<br>line</div></body></html>"#;
        let text = html_to_text(html);
        assert!(!text.contains("color: red"));
        assert!(!text.contains("secret"));
        assert!(text.contains("Header"));
        assert!(text.contains("First \"para\"."));
        assert!(text.contains("Second\nline"));
    }

    #[test]
    fn html_to_text_survives_unterminated_script() {
        let html = "<p>visible</p><script>var x = 1;"; // no closing tag
        let text = html_to_text(html);
        assert!(text.contains("visible"));
        assert!(!text.contains("var x"));
    }

    #[test]
    fn html_to_text_keeps_byte_offsets_aligned_on_unicode() {
        // 'İ' lowercases to two chars under full Unicode rules — the ASCII-only
        // lowering must keep strip_element's indices aligned with the original.
        let html = "<p>İstanbul — café</p><script>var hidden = 1;</script><p>done</p>";
        let text = html_to_text(html);
        assert!(text.contains("İstanbul — café"));
        assert!(text.contains("done"));
        assert!(!text.contains("hidden"));
    }

    #[test]
    fn extract_title_handles_attributes_and_entities() {
        assert_eq!(
            extract_title(r#"<title lang="en">Qwen 3.8 &mdash; notes</title>"#).unwrap(),
            "Qwen 3.8 — notes"
        );
        assert!(extract_title("<body>no title</body>").is_none());
    }

    #[test]
    fn collapse_whitespace_limits_blank_runs() {
        let messy = "a   b\n\n\n\n c\t\td\n";
        assert_eq!(collapse_whitespace(messy), "a b\n\nc d");
    }
}
