// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Finance Keeper — Local portfolio tracking with optional market data (Patent Pending)
//
// This module provides:
// - Local ticker watchlist management (stored in localStorage, passed via IPC)
// - Market data fetching via public REST APIs (no API key required)
// - Portfolio summary with price changes and AI-generated analysis
// - One-click "Tell me more" deep-dive per ticker
//
// All data is fetched read-only. No trades are ever executed.
// No credentials or financial accounts are accessed.
// The user must explicitly enable this feature in Settings.

use chrono::Local;
use serde::{Deserialize, Serialize};

// ────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────

/// User-supplied list of ticker symbols to track.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinanceConfig {
    pub tickers: Vec<String>,
}

impl FinanceConfig {
    pub fn is_valid(&self) -> bool {
        !self.tickers.is_empty() && self.tickers.iter().all(|t| !t.trim().is_empty())
    }

    /// Normalize tickers to uppercase, deduplicate, limit to 20.
    pub fn normalized(&self) -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        self.tickers
            .iter()
            .map(|t| t.trim().to_uppercase())
            .filter(|t| !t.is_empty() && seen.insert(t.clone()))
            .take(20)
            .collect()
    }
}

// ────────────────────────────────────────────────────────────────
// Data models
// ────────────────────────────────────────────────────────────────

/// Summary data for a single ticker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickerQuote {
    pub symbol: String,
    pub name: String,
    pub price: f64,
    pub change: f64,
    pub change_percent: f64,
    pub high: f64,
    pub low: f64,
    pub volume: String,
    pub market_cap: String,
    pub fetch_error: Option<String>,
}

impl TickerQuote {
    /// Create a placeholder when fetching fails.
    pub fn error(symbol: &str, msg: &str) -> Self {
        Self {
            symbol: symbol.to_uppercase(),
            name: symbol.to_uppercase(),
            price: 0.0,
            change: 0.0,
            change_percent: 0.0,
            high: 0.0,
            low: 0.0,
            volume: "—".into(),
            market_cap: "—".into(),
            fetch_error: Some(msg.into()),
        }
    }

    /// Is this ticker up today?
    pub fn is_up(&self) -> bool {
        self.change >= 0.0
    }
}

/// Overall portfolio / watchlist summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinanceSummary {
    pub ticker_count: usize,
    pub quotes: Vec<TickerQuote>,
    pub gainers: Vec<String>,
    pub losers: Vec<String>,
    pub ai_summary: Option<String>,
    pub success: bool,
    pub error: Option<String>,
    pub fetched_at: String,
}

impl FinanceSummary {
    pub fn error(msg: &str) -> Self {
        Self {
            ticker_count: 0,
            quotes: vec![],
            gainers: vec![],
            losers: vec![],
            ai_summary: None,
            success: false,
            error: Some(msg.into()),
            fetched_at: Local::now().format("%Y-%m-%d %H:%M").to_string(),
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Market data fetching (public API — no key required)
// ────────────────────────────────────────────────────────────────

/// Fetch a quote for a single ticker from the Yahoo Finance v8 public endpoint.
/// This is a read-only GET request — no authentication, no API key.
pub async fn fetch_quote(symbol: &str) -> TickerQuote {
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=1d&interval=1d",
        symbol.to_uppercase()
    );

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("PrismOS-AI/0.5")
        .build()
    {
        Ok(c) => c,
        Err(e) => return TickerQuote::error(symbol, &format!("HTTP client error: {}", e)),
    };

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => return TickerQuote::error(symbol, &format!("Network error: {}", e)),
    };

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return TickerQuote::error(symbol, &format!("Parse error: {}", e)),
    };

    // Navigate the Yahoo Finance JSON structure
    let result = &body["chart"]["result"];
    if result.is_null() || !result.is_array() || result.as_array().map_or(true, |a| a.is_empty()) {
        return TickerQuote::error(symbol, "Ticker not found or market data unavailable");
    }

    let item = &result[0];
    let meta = &item["meta"];

    let price = meta["regularMarketPrice"].as_f64().unwrap_or(0.0);
    let prev_close = meta["chartPreviousClose"].as_f64().unwrap_or(price);
    let change = price - prev_close;
    let change_pct = if prev_close > 0.0 {
        (change / prev_close) * 100.0
    } else {
        0.0
    };

    let high = meta["regularMarketDayHigh"]
        .as_f64()
        .or_else(|| meta["dayHigh"].as_f64())
        .unwrap_or(price);
    let low = meta["regularMarketDayLow"]
        .as_f64()
        .or_else(|| meta["dayLow"].as_f64())
        .unwrap_or(price);
    let volume_raw = meta["regularMarketVolume"].as_u64().unwrap_or(0);
    let volume = format_large_number(volume_raw as f64);

    let short_name = meta["shortName"]
        .as_str()
        .or_else(|| meta["longName"].as_str())
        .unwrap_or(symbol);

    TickerQuote {
        symbol: symbol.to_uppercase(),
        name: short_name.to_string(),
        price: round2(price),
        change: round2(change),
        change_percent: round2(change_pct),
        high: round2(high),
        low: round2(low),
        volume,
        market_cap: "—".into(), // not in chart endpoint
        fetch_error: None,
    }
}

/// Fetch quotes for all tickers in the config. Returns a full FinanceSummary.
pub async fn fetch_portfolio_summary(config: &FinanceConfig) -> FinanceSummary {
    if !config.is_valid() {
        return FinanceSummary::error("No ticker symbols configured.");
    }

    let tickers = config.normalized();
    let mut quotes: Vec<TickerQuote> = Vec::with_capacity(tickers.len());

    // Fetch sequentially to be polite to the API
    for symbol in &tickers {
        let quote = fetch_quote(symbol).await;
        quotes.push(quote);
    }

    let successful: Vec<&TickerQuote> = quotes.iter().filter(|q| q.fetch_error.is_none()).collect();

    let gainers: Vec<String> = successful
        .iter()
        .filter(|q| q.change > 0.0)
        .map(|q| format!("{} (+{:.1}%)", q.symbol, q.change_percent))
        .collect();

    let losers: Vec<String> = successful
        .iter()
        .filter(|q| q.change < 0.0)
        .map(|q| format!("{} ({:.1}%)", q.symbol, q.change_percent))
        .collect();

    FinanceSummary {
        ticker_count: tickers.len(),
        quotes,
        gainers,
        losers,
        ai_summary: None,
        success: true,
        error: None,
        fetched_at: Local::now().format("%Y-%m-%d %H:%M").to_string(),
    }
}

// ────────────────────────────────────────────────────────────────
// LLM prompt + fallback summary
// ────────────────────────────────────────────────────────────────

/// Build a prompt for Ollama to summarize the portfolio.
pub fn build_summary_prompt(summary: &FinanceSummary) -> String {
    let mut lines = Vec::new();
    lines.push("You are a concise financial assistant. Summarize this portfolio watchlist in 2-3 sentences.".to_string());
    lines.push(format!("Date: {}", summary.fetched_at));
    lines.push(format!("Tracking {} ticker(s).", summary.ticker_count));

    for q in &summary.quotes {
        if q.fetch_error.is_some() {
            continue;
        }
        let arrow = if q.is_up() { "▲" } else { "▼" };
        lines.push(format!(
            "  {} ({}) — ${:.2} {} {:.2} ({:+.1}%) | Day range ${:.2}–${:.2} | Vol {}",
            q.symbol, q.name, q.price, arrow, q.change.abs(), q.change_percent,
            q.low, q.high, q.volume
        ));
    }

    if !summary.gainers.is_empty() {
        lines.push(format!("Gainers: {}", summary.gainers.join(", ")));
    }
    if !summary.losers.is_empty() {
        lines.push(format!("Losers: {}", summary.losers.join(", ")));
    }

    lines.push("Respond with a brief, professional market summary. No disclaimers.".to_string());
    lines.join("\n")
}

/// Fallback summary when Ollama is unavailable.
pub fn fallback_summary(summary: &FinanceSummary) -> String {
    if summary.ticker_count == 0 {
        return "No tickers in your watchlist yet. Add some in Settings → Finance.".into();
    }

    let successful: Vec<&TickerQuote> = summary.quotes.iter().filter(|q| q.fetch_error.is_none()).collect();

    if successful.is_empty() {
        return format!(
            "Could not fetch data for {} ticker(s). Markets may be closed or tickers may be invalid.",
            summary.ticker_count
        );
    }

    let mut parts = Vec::new();
    parts.push(format!("Tracking {} ticker(s) as of {}.", successful.len(), summary.fetched_at));

    // Top movers
    let mut sorted = successful.clone();
    sorted.sort_by(|a, b| b.change_percent.abs().partial_cmp(&a.change_percent.abs()).unwrap_or(std::cmp::Ordering::Equal));

    for q in sorted.iter().take(5) {
        let arrow = if q.is_up() { "📈" } else { "📉" };
        parts.push(format!(
            "{} {} ${:.2} ({:+.1}%)",
            arrow, q.symbol, q.price, q.change_percent
        ));
    }

    if !summary.gainers.is_empty() {
        parts.push(format!("Gainers: {}", summary.gainers.join(", ")));
    }
    if !summary.losers.is_empty() {
        parts.push(format!("Losers: {}", summary.losers.join(", ")));
    }

    parts.join(" • ")
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn format_large_number(n: f64) -> String {
    if n >= 1_000_000_000.0 {
        format!("{:.1}B", n / 1_000_000_000.0)
    } else if n >= 1_000_000.0 {
        format!("{:.1}M", n / 1_000_000.0)
    } else if n >= 1_000.0 {
        format!("{:.0}K", n / 1_000.0)
    } else {
        format!("{:.0}", n)
    }
}

// ────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_valid() {
        let config = FinanceConfig { tickers: vec!["AAPL".into(), "GOOG".into()] };
        assert!(config.is_valid());
    }

    #[test]
    fn test_config_empty_invalid() {
        let config = FinanceConfig { tickers: vec![] };
        assert!(!config.is_valid());
    }

    #[test]
    fn test_config_blank_ticker_invalid() {
        let config = FinanceConfig { tickers: vec!["".into()] };
        assert!(!config.is_valid());
    }

    #[test]
    fn test_normalized_deduplicates_and_uppercases() {
        let config = FinanceConfig {
            tickers: vec!["aapl".into(), "AAPL".into(), "goog".into(), " msft ".into()],
        };
        let norm = config.normalized();
        assert_eq!(norm, vec!["AAPL", "GOOG", "MSFT"]);
    }

    #[test]
    fn test_normalized_limits_to_20() {
        let tickers: Vec<String> = (0..30).map(|i| format!("T{}", i)).collect();
        let config = FinanceConfig { tickers };
        assert_eq!(config.normalized().len(), 20);
    }

    #[test]
    fn test_ticker_quote_error() {
        let q = TickerQuote::error("AAPL", "network fail");
        assert_eq!(q.symbol, "AAPL");
        assert_eq!(q.price, 0.0);
        assert!(q.fetch_error.is_some());
        assert_eq!(q.fetch_error.unwrap(), "network fail");
    }

    #[test]
    fn test_ticker_is_up() {
        let mut q = TickerQuote::error("X", "");
        q.change = 1.5;
        assert!(q.is_up());
        q.change = -0.5;
        assert!(!q.is_up());
        q.change = 0.0;
        assert!(q.is_up()); // flat counts as not-down
    }

    #[test]
    fn test_finance_summary_error() {
        let s = FinanceSummary::error("bad config");
        assert!(!s.success);
        assert_eq!(s.error.unwrap(), "bad config");
        assert_eq!(s.ticker_count, 0);
    }

    #[test]
    fn test_fallback_summary_no_tickers() {
        let s = FinanceSummary {
            ticker_count: 0,
            quotes: vec![],
            gainers: vec![],
            losers: vec![],
            ai_summary: None,
            success: true,
            error: None,
            fetched_at: "2026-03-04 09:00".into(),
        };
        let text = fallback_summary(&s);
        assert!(text.contains("No tickers"));
    }

    #[test]
    fn test_fallback_summary_with_quotes() {
        let q1 = TickerQuote {
            symbol: "AAPL".into(),
            name: "Apple Inc.".into(),
            price: 185.50,
            change: 2.30,
            change_percent: 1.25,
            high: 186.00,
            low: 183.00,
            volume: "45.2M".into(),
            market_cap: "—".into(),
            fetch_error: None,
        };
        let q2 = TickerQuote {
            symbol: "TSLA".into(),
            name: "Tesla Inc.".into(),
            price: 210.00,
            change: -5.00,
            change_percent: -2.33,
            high: 215.00,
            low: 208.00,
            volume: "80.1M".into(),
            market_cap: "—".into(),
            fetch_error: None,
        };
        let s = FinanceSummary {
            ticker_count: 2,
            quotes: vec![q1, q2],
            gainers: vec!["AAPL (+1.3%)".into()],
            losers: vec!["TSLA (-2.3%)".into()],
            ai_summary: None,
            success: true,
            error: None,
            fetched_at: "2026-03-04 09:30".into(),
        };
        let text = fallback_summary(&s);
        assert!(text.contains("Tracking 2"));
        assert!(text.contains("AAPL"));
        assert!(text.contains("TSLA"));
    }

    #[test]
    fn test_build_summary_prompt() {
        let q = TickerQuote {
            symbol: "GOOG".into(),
            name: "Alphabet".into(),
            price: 175.00,
            change: 3.50,
            change_percent: 2.04,
            high: 176.00,
            low: 172.00,
            volume: "12.5M".into(),
            market_cap: "—".into(),
            fetch_error: None,
        };
        let s = FinanceSummary {
            ticker_count: 1,
            quotes: vec![q],
            gainers: vec!["GOOG (+2.0%)".into()],
            losers: vec![],
            ai_summary: None,
            success: true,
            error: None,
            fetched_at: "2026-03-04 10:00".into(),
        };
        let prompt = build_summary_prompt(&s);
        assert!(prompt.contains("financial assistant"));
        assert!(prompt.contains("GOOG"));
        assert!(prompt.contains("Alphabet"));
        assert!(prompt.contains("175.00"));
    }

    #[test]
    fn test_round2() {
        assert_eq!(round2(1.2345), 1.23);
        assert_eq!(round2(1.235), 1.24);
        assert_eq!(round2(0.0), 0.0);
    }

    #[test]
    fn test_format_large_number() {
        assert_eq!(format_large_number(500.0), "500");
        assert_eq!(format_large_number(1_500.0), "2K");
        assert_eq!(format_large_number(2_500_000.0), "2.5M");
        assert_eq!(format_large_number(3_200_000_000.0), "3.2B");
    }
}
