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
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Process-wide enable flag. Always starts disabled; the Settings toggle
/// (persisted by the frontend) re-enables it on each launch via the
/// `set_web_research_enabled` command.
static WEB_RESEARCH_ENABLED: AtomicBool = AtomicBool::new(false);

const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
/// Redirects are followed manually so every hop is re-validated.
const MAX_REDIRECTS: usize = 5;
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

/// True for localhost-style names and non-public IP literals. Prefix checks
/// apply only to PARSED IP addresses — a domain like fcc.gov or fda.gov must
/// never be mistaken for an fc00::/7 literal.
fn is_private_host(host: &str) -> bool {
    if host == "localhost" || host.ends_with(".local") || host.ends_with(".localhost") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(ip) => is_private_ip(&ip),
        Err(_) => false, // a real hostname — its resolved IPs are checked separately
    }
}

/// True for any IP that must never be fetched: loopback, unspecified,
/// RFC-1918, link-local, CGNAT, multicast/broadcast, IPv6 ULA, and
/// IPv4-mapped forms of any of those.
fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_unspecified()
                || v4.is_private()          // 10/8, 172.16/12, 192.168/16
                || v4.is_link_local()       // 169.254/16
                || v4.is_broadcast()
                || v4.is_multicast()
                || o[0] == 0                // 0.0.0.0/8
                || (o[0] == 100 && (64..=127).contains(&o[1])) // 100.64/10 CGNAT
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_private_ip(&IpAddr::V4(mapped));
            }
            let s = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (s[0] & 0xfe00) == 0xfc00 // unique-local fc00::/7
        }
    }
}

/// Resolve a host and return socket addrs, refusing if ANY resolved address
/// is non-public (a public hostname must not be usable to reach the LAN via
/// DNS tricks). IP literals skip DNS entirely.
async fn resolve_public(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        // Already vetted by validate_url, but keep the invariant local.
        if is_private_ip(&ip) {
            return Err(format!("\"{host}\" is a local/private address."));
        }
        return Ok(vec![SocketAddr::new(ip, port)]);
    }
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("Could not resolve \"{host}\": {e}"))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("\"{host}\" did not resolve to any address."));
    }
    if let Some(bad) = addrs.iter().find(|a| is_private_ip(&a.ip())) {
        return Err(format!(
            "\"{host}\" resolves to a local/private address ({}) — refusing to fetch.",
            bad.ip()
        ));
    }
    Ok(addrs)
}

/// Port from an https URL's authority (default 443).
fn url_port(url: &str) -> u16 {
    let rest = url.trim().strip_prefix("https://").unwrap_or("");
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.starts_with('[') {
        // [v6]:port
        authority
            .rsplit_once("]:")
            .and_then(|(_, p)| p.parse().ok())
            .unwrap_or(443)
    } else {
        authority
            .rsplit_once(':')
            .and_then(|(_, p)| p.parse().ok())
            .unwrap_or(443)
    }
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
    // Redirects are followed MANUALLY so that every hop — not just the final
    // landing URL — is validated at the name level AND at the resolved-IP
    // level (DNS pinned via resolve_to_addrs, closing the rebinding window
    // between the check and the connect).
    let mut current = url.trim().to_string();
    let mut resp = None;
    for _hop in 0..=MAX_REDIRECTS {
        let host = validate_url(&current)?;
        let port = url_port(&current);
        let addrs = resolve_public(&host, port).await?;

        let client = reqwest::Client::builder()
            .timeout(FETCH_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(&host, &addrs)
            .user_agent("PrismOS-AI/0.6 (local research; user-directed)")
            .build()
            .map_err(|e| e.to_string())?;

        let r = client
            .get(&current)
            .send()
            .await
            .map_err(|e| format!("Fetch failed: {e}"))?;

        if r.status().is_redirection() {
            let loc = r
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "Redirect without a Location header.".to_string())?;
            let next = r
                .url()
                .join(loc)
                .map_err(|e| format!("Bad redirect target: {e}"))?;
            current = next.to_string();
            continue;
        }
        resp = Some(r);
        break;
    }
    let mut resp = resp.ok_or_else(|| "Too many redirects.".to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Fetch failed: HTTP {}", resp.status()));
    }
    let final_url = resp.url().to_string();

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
    fn domains_starting_with_fc_fd_are_not_ipv6_literals() {
        // Regression: a string-prefix check once misclassified these as
        // fc00::/7 unique-local addresses.
        assert_eq!(validate_url("https://fcc.gov/").unwrap(), "fcc.gov");
        assert_eq!(validate_url("https://fda.gov/about").unwrap(), "fda.gov");
        assert_eq!(validate_url("https://fe80cars.example.com/").unwrap(), "fe80cars.example.com");
    }

    #[test]
    fn is_private_ip_classifies_correctly() {
        let private = [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.9.9",
            "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fc00::1", "fd12::1",
            "::ffff:192.168.0.1", // IPv4-mapped private
        ];
        for p in private {
            let ip: IpAddr = p.parse().unwrap();
            assert!(is_private_ip(&ip), "should be private: {p}");
        }
        let public = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111"];
        for p in public {
            let ip: IpAddr = p.parse().unwrap();
            assert!(!is_private_ip(&ip), "should be public: {p}");
        }
    }

    #[test]
    fn url_port_parses_defaults_and_explicit() {
        assert_eq!(url_port("https://example.com/x"), 443);
        assert_eq!(url_port("https://example.com:8443/x"), 8443);
        assert_eq!(url_port("https://[2606:4700::1111]/x"), 443);
        assert_eq!(url_port("https://[2606:4700::1111]:9443/x"), 9443);
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
