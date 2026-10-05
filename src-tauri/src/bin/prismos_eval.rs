//! prismos-eval: does an imported knowledge pack change the local model's answers?
//!
//! Asks every question in a JSONL file through the local Ollama daemon, once on
//! its own ("before") and once with passages retrieved from a local PrismOS app
//! directory ("after"), and scores both answers by the keywords each question
//! expects. Nothing leaves the machine: inference is fixed to 127.0.0.1:11434
//! with proxies and redirects disabled, and retrieval reads a local SQLite graph.
//! The model's weights never change; only the context it is given does.
//!
//!   prismos-eval --questions resources/eval/sap-and-security.jsonl \
//!     --app-dir /tmp/prismos-eval-app --model qwen3.8:27b --out results.json

use prismos_lib::knowledge_import::{chat_context_labels, retrieve_passages};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Duration, Instant};

const OLLAMA: &str = "http://127.0.0.1:11434";
const DEFAULT_MODEL: &str = "qwen3.8:27b";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
const GENERATE_TIMEOUT: Duration = Duration::from_secs(900);

const USAGE: &str = "Usage: prismos-eval --questions FILE.jsonl [--app-dir DIR] [--mode before|after|both|retrieval]\n\
                     [--model NAME] [--k 8] [--chars 2000] [--max-tokens 400] [--limit N] [--out FILE.json]\n\
Each JSONL line: {\"id\": \"...\", \"question\": \"...\", \"expect\": [\"term\", \"spelling a|spelling b\"], \"source\": \"optional.md\"}.\n\
\"before\" asks the question alone; \"after\" adds passages retrieved from --app-dir (an app directory with an imported pack);\n\
\"retrieval\" only checks what --app-dir retrieves (no model needed).\n\
Inference goes only to the local Ollama daemon at 127.0.0.1:11434.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Before,
    After,
    Both,
    /// Only check what retrieval finds; no model is called.
    Retrieval,
}

#[derive(Debug)]
struct Args {
    questions: PathBuf,
    app_dir: Option<PathBuf>,
    mode: Mode,
    model: String,
    k: usize,
    chars: usize,
    max_tokens: u32,
    limit: Option<usize>,
    out: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Question {
    id: String,
    question: String,
    /// Every entry must appear in the answer; "a|b" accepts either spelling.
    expect: Vec<String>,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Debug, Serialize)]
struct Answer {
    text: String,
    matched: Vec<String>,
    missing: Vec<String>,
    score: f64,
    seconds: f64,
    truncated: bool,
}

#[derive(Debug, Serialize)]
struct Row {
    id: String,
    question: String,
    source: Option<String>,
    passages: Vec<String>,
    /// Share of the expected terms present in the retrieved passages themselves.
    context_recall: Option<f64>,
    /// What an ordinary chat turn would retrieve: the general top 20 labels.
    chat_context: Vec<String>,
    before: Option<Answer>,
    after: Option<Answer>,
}

#[derive(Debug, Serialize)]
struct Report {
    model: String,
    questions: usize,
    before_mean: Option<f64>,
    after_mean: Option<f64>,
    before_full: Option<usize>,
    after_full: Option<usize>,
    /// Questions for which retrieval returned at least one passage.
    retrieved: Option<usize>,
    /// Questions whose expected source document was among the passages.
    source_found: Option<usize>,
    /// Mean share of expected terms present in the retrieved passages.
    context_recall: Option<f64>,
    /// Questions whose expected source was in an ordinary chat turn's top 20.
    chat_found: Option<usize>,
    rows: Vec<Row>,
}

fn parse_args(values: impl IntoIterator<Item = String>) -> Result<Option<Args>, String> {
    let mut values = values.into_iter();
    let mut questions = None;
    let mut app_dir = None;
    let mut mode = None;
    let mut model = std::env::var("PRISMOS_EVAL_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
    let (mut k, mut chars, mut max_tokens, mut limit, mut out) = (8usize, 2000usize, 400u32, None, None);
    while let Some(flag) = values.next() {
        if flag == "--help" || flag == "-h" {
            return Ok(None);
        }
        let value = values
            .next()
            .filter(|v| !v.is_empty() && !v.starts_with("--"))
            .ok_or_else(|| format!("{flag} needs a value"))?;
        let number = |v: &str| v.parse::<usize>().map_err(|_| format!("{flag} needs a whole number"));
        match flag.as_str() {
            "--questions" => questions = Some(PathBuf::from(value)),
            "--app-dir" => app_dir = Some(PathBuf::from(value)),
            "--model" | "-m" => model = value,
            "--mode" => {
                mode = Some(match value.as_str() {
                    "before" => Mode::Before,
                    "after" => Mode::After,
                    "both" => Mode::Both,
                    "retrieval" => Mode::Retrieval,
                    other => return Err(format!("--mode must be before, after, both or retrieval, not {other}")),
                })
            }
            "--k" => k = number(&value)?.clamp(1, 20),
            "--chars" => chars = number(&value)?.clamp(200, 4000),
            "--max-tokens" => max_tokens = number(&value)?.clamp(64, 4096) as u32,
            "--limit" => limit = Some(number(&value)?),
            "--out" => out = Some(PathBuf::from(value)),
            other => return Err(format!("unknown flag: {other}")),
        }
    }
    let questions = questions.ok_or("--questions is required")?;
    let mode = mode.unwrap_or(if app_dir.is_some() { Mode::Both } else { Mode::Before });
    if mode != Mode::Before && app_dir.is_none() {
        return Err("--mode after, both and retrieval need --app-dir".into());
    }
    Ok(Some(Args { questions, app_dir, mode, model, k, chars, max_tokens, limit, out }))
}

fn load_questions(path: &PathBuf) -> Result<Vec<Question>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let mut seen = std::collections::HashSet::new();
    let mut questions = Vec::new();
    for (n, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        let q: Question = serde_json::from_str(line).map_err(|e| format!("Line {}: {e}", n + 1))?;
        if q.expect.is_empty() || q.expect.iter().any(|e| e.trim().is_empty()) {
            return Err(format!("Line {}: expect needs at least one non-empty term", n + 1));
        }
        if !seen.insert(q.id.clone()) {
            return Err(format!("Line {}: duplicate id {}", n + 1, q.id));
        }
        questions.push(q);
    }
    if questions.is_empty() {
        return Err("No questions found".into());
    }
    Ok(questions)
}

/// Lowercase, unify dashes and spaces, collapse whitespace.
fn normalize(s: &str) -> String {
    let unified: String = s
        .chars()
        .map(|c| match c {
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2212}' => '-',
            '\u{00a0}' | '\u{202f}' => ' ',
            c => c,
        })
        .collect();
    unified.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Whole-term match: a hit may not run on into a longer word or number
/// ("6" does not match inside "2026", "2.19.1" does not match "2.19.10").
fn contains_term(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let first_alnum = needle.chars().next().map_or(false, |c| c.is_alphanumeric());
    let last_alnum = needle.chars().next_back().map_or(false, |c| c.is_alphanumeric());
    let mut from = 0;
    while let Some(pos) = haystack[from..].find(needle) {
        let start = from + pos;
        let end = start + needle.len();
        let before_ok = !first_alnum || haystack[..start].chars().next_back().map_or(true, |c| !c.is_alphanumeric());
        let after_ok = !last_alnum || haystack[end..].chars().next().map_or(true, |c| !c.is_alphanumeric());
        if before_ok && after_ok {
            return true;
        }
        from = start + needle.chars().next().map_or(1, |c| c.len_utf8());
    }
    false
}

fn score(answer: &str, expect: &[String], seconds: f64, truncated: bool) -> Answer {
    let text = normalize(answer);
    let (mut matched, mut missing) = (Vec::new(), Vec::new());
    for term in expect {
        let hit = term.split('|').map(normalize).any(|alt| contains_term(&text, &alt));
        if hit { matched.push(term.clone()) } else { missing.push(term.clone()) }
    }
    let score = matched.len() as f64 / expect.len() as f64;
    Answer { text: answer.trim().to_string(), matched, missing, score, seconds, truncated }
}

const INSTRUCTIONS: &str = "You are a careful SAP Basis and security assistant. Answer in at most three sentences. \
Give exact identifiers (SAP Note numbers, CVE ids, parameter names and values, versions, dates) when you are sure of them. \
If you are not sure, say so instead of guessing.";

/// Indexed chunks start with "Source: ...\nChunk: i/n\nChars: a-b"; keep the text.
fn passage_text(content: &str, chars: usize) -> String {
    let mut body = content;
    for prefix in ["Source:", "Chunk:", "Chars:"] {
        if body.starts_with(prefix) {
            body = body.split_once('\n').map_or("", |(_, rest)| rest);
        }
    }
    let body = body.trim();
    match body.char_indices().nth(chars) {
        Some((cut, _)) => format!("{}...", &body[..cut]),
        None => body.to_string(),
    }
}

fn source_name(label: &str) -> String {
    let name = label.trim_start_matches(|c: char| !c.is_ascii_alphanumeric());
    match name.find(" [chunk ") {
        Some(i) => name[..i].to_string(),
        None => name.to_string(),
    }
}

fn prompt_before(question: &str) -> String {
    format!("{INSTRUCTIONS}\n\nQuestion: {question}")
}

fn prompt_after(question: &str, passages: &[(String, String)]) -> String {
    let notes = passages
        .iter()
        .enumerate()
        .map(|(i, (label, text))| format!("[{}] {}\n{}", i + 1, label, text))
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "{INSTRUCTIONS} Use the reference notes below when they are relevant; they come from the local knowledge pack and may be incomplete.\n\n\
Reference notes:\n{notes}\n\nQuestion: {question}"
    )
}

/// Remove <think>...</think> blocks some models leak into the answer.
fn strip_think(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    if !rest.contains("<think>") {
        if let Some(close) = rest.find("</think>") {
            return rest[close + 8..].trim().to_string();
        }
    }
    while let Some(start) = rest.find("<think>") {
        out.push_str(&rest[..start]);
        match rest[start + 7..].find("</think>") {
            Some(end) => rest = &rest[start + 7 + end + 8..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
struct Generated {
    #[serde(default)]
    response: String,
    #[serde(default)]
    done_reason: Option<String>,
}

async fn generate(http: &reqwest::Client, model: &str, prompt: &str, max_tokens: u32) -> Result<(String, bool), String> {
    let mut body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "options": { "num_ctx": 16384, "num_predict": max_tokens, "temperature": 0, "seed": 7 },
    });
    // Hybrid qwen3 chat models think by default; answers are scored, not the trace.
    let lower = model.to_lowercase();
    if lower.contains("qwen3") && !lower.contains("coder") {
        body["think"] = serde_json::json!(false);
    }
    let url = format!("{OLLAMA}/api/generate");
    let mut response = http.post(&url).json(&body).timeout(GENERATE_TIMEOUT).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() && body.get("think").is_some() && (400..=422).contains(&response.status().as_u16()) {
        if let Some(object) = body.as_object_mut() {
            object.remove("think");
        }
        response = http.post(&url).json(&body).timeout(GENERATE_TIMEOUT).send().await.map_err(|e| e.to_string())?;
    }
    if !response.status().is_success() {
        return Err(format!("ollama returned {}", response.status()));
    }
    let parsed: Generated = response.json().await.map_err(|e| e.to_string())?;
    Ok((strip_think(&parsed.response), parsed.done_reason.as_deref() == Some("length")))
}

fn mean(values: impl Iterator<Item = f64>) -> Option<f64> {
    let v: Vec<f64> = values.collect();
    if v.is_empty() { None } else { Some(v.iter().sum::<f64>() / v.len() as f64) }
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match parse_args(std::env::args().skip(1)) {
        Ok(Some(args)) => args,
        Ok(None) => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(e) => {
            eprintln!("error: {e}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let mut questions = match load_questions(&args.questions) {
        Ok(q) => q,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::from(2);
        }
    };
    if let Some(n) = args.limit {
        questions.truncate(n);
    }
    let http = match client() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::from(1);
        }
    };
    let up = args.mode == Mode::Retrieval
        || http.get(format!("{OLLAMA}/api/version")).timeout(HEALTH_TIMEOUT).send().await.map(|r| r.status().is_success()).unwrap_or(false);
    if !up {
        eprintln!("error: Ollama is not answering at {OLLAMA}. Start it with `ollama serve`.");
        return ExitCode::from(1);
    }

    println!("prismos-eval · model {} · {} questions · mode {:?}", args.model, questions.len(), args.mode);
    let mut rows = Vec::new();
    for q in &questions {
        let mut row = Row { id: q.id.clone(), question: q.question.clone(), source: q.source.clone(), passages: Vec::new(), context_recall: None, chat_context: Vec::new(), before: None, after: None };
        if matches!(args.mode, Mode::Before | Mode::Both) {
            let started = Instant::now();
            match generate(&http, &args.model, &prompt_before(&q.question), args.max_tokens).await {
                Ok((text, truncated)) => row.before = Some(score(&text, &q.expect, started.elapsed().as_secs_f64(), truncated)),
                Err(e) => {
                    eprintln!("error on {}: {e}", q.id);
                    return ExitCode::from(1);
                }
            }
        }
        if args.mode != Mode::Before {
            let app_dir = args.app_dir.as_ref().expect("checked in parse_args");
            let passages = match retrieve_passages(app_dir, &q.question, args.k) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("error: {e}");
                    return ExitCode::from(1);
                }
            };
            row.chat_context = match chat_context_labels(app_dir, &q.question) {
                Ok(labels) => labels,
                Err(e) => {
                    eprintln!("error: {e}");
                    return ExitCode::from(1);
                }
            };
            let notes: Vec<(String, String)> = passages.iter().map(|p| (source_name(&p.label), passage_text(&p.content, args.chars))).collect();
            row.passages = passages.iter().map(|p| p.label.clone()).collect();
            let context = notes.iter().map(|(_, text)| text.as_str()).collect::<Vec<_>>().join("\n");
            row.context_recall = Some(score(&context, &q.expect, 0.0, false).score);
            if args.mode == Mode::Retrieval {
                println!("{:<22} context {:>4.0}%   passages {}", row.id, row.context_recall.unwrap_or(0.0) * 100.0, row.passages.len());
                rows.push(row);
                continue;
            }
            let started = Instant::now();
            match generate(&http, &args.model, &prompt_after(&q.question, &notes), args.max_tokens).await {
                Ok((text, truncated)) => row.after = Some(score(&text, &q.expect, started.elapsed().as_secs_f64(), truncated)),
                Err(e) => {
                    eprintln!("error on {}: {e}", q.id);
                    return ExitCode::from(1);
                }
            }
        }
        let show = |a: &Option<Answer>| a.as_ref().map_or("-".to_string(), |a| format!("{}/{}", a.matched.len(), a.matched.len() + a.missing.len()));
        println!("{:<22} before {:>5}   after {:>5}   passages {}", row.id, show(&row.before), show(&row.after), row.passages.len());
        rows.push(row);
    }

    let full = |pick: fn(&Row) -> Option<&Answer>| -> Option<usize> {
        let answered: Vec<&Answer> = rows.iter().filter_map(pick).collect();
        if answered.is_empty() { None } else { Some(answered.iter().filter(|a| a.missing.is_empty()).count()) }
    };
    let report = Report {
        model: args.model.clone(),
        questions: rows.len(),
        before_mean: mean(rows.iter().filter_map(|r| r.before.as_ref().map(|a| a.score))),
        after_mean: mean(rows.iter().filter_map(|r| r.after.as_ref().map(|a| a.score))),
        before_full: full(|r| r.before.as_ref()),
        after_full: full(|r| r.after.as_ref()),
        retrieved: (args.mode != Mode::Before).then(|| rows.iter().filter(|r| !r.passages.is_empty()).count()),
        context_recall: mean(rows.iter().filter_map(|r| r.context_recall)),
        source_found: (args.mode != Mode::Before).then(|| {
            rows.iter()
                .filter(|r| r.source.as_ref().map_or(false, |s| r.passages.iter().any(|p| p.contains(s.as_str()))))
                .count()
        }),
        chat_found: (args.mode != Mode::Before).then(|| {
            rows.iter()
                .filter(|r| r.source.as_ref().map_or(false, |s| r.chat_context.iter().any(|p| p.contains(s.as_str()))))
                .count()
        }),
        rows,
    };
    let pct = |v: Option<f64>| v.map_or("-".to_string(), |v| format!("{:.0}%", v * 100.0));
    let count = |v: Option<usize>| v.map_or("-".to_string(), |v| format!("{v}/{}", report.questions));
    println!(
        "\nkeyword score  before {}  after {}\nfully correct  before {}  after {}\nretrieval      passages found for {}; expected document among them for {}; expected terms in the passages {}\nchat context   expected document in an ordinary chat turn's top 20 for {}",
        pct(report.before_mean), pct(report.after_mean), count(report.before_full), count(report.after_full), count(report.retrieved), count(report.source_found), pct(report.context_recall), count(report.chat_found)
    );
    if let Some(path) = &args.out {
        match serde_json::to_string_pretty(&report) {
            Ok(json) => {
                if let Err(e) = std::fs::write(path, json) {
                    eprintln!("error: cannot write {}: {e}", path.display());
                    return ExitCode::from(1);
                }
                println!("full results: {}", path.display());
            }
            Err(e) => {
                eprintln!("error: {e}");
                return ExitCode::from(1);
            }
        }
    }
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terms_match_whole_tokens_only() {
        let a = normalize("Lock after 6 failed attempts (default since 2026). Version 2.19.1 is current.");
        assert!(contains_term(&a, "6"));
        assert!(!contains_term(&normalize("Released in 2026."), "6"));
        assert!(contains_term(&a, "2.19.1"));
        assert!(!contains_term(&normalize("Version 2.19.10"), "2.19.1"));
        assert!(contains_term(&normalize("POST /developmentserver/metadatauploader?x=1"), "/developmentserver/metadatauploader"));
        assert!(contains_term(&normalize("SAP Note 3594142."), "3594142"));
    }

    #[test]
    fn scoring_accepts_alternative_spellings_and_unified_dashes() {
        let s = score("It was added on April 29, 2025 \u{2014} see CVE\u{2011}2025\u{2011}31324.", &["2025-04-29|April 29, 2025".into(), "CVE-2025-31324".into(), "3594142".into()], 1.0, false);
        assert_eq!(s.matched.len(), 2);
        assert_eq!(s.missing, vec!["3594142".to_string()]);
        assert!((s.score - 2.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn passages_lose_the_chunk_header_and_are_capped() {
        let content = "Source: knowledge-pack://sap-and-security/sap-hana-security.md\nChunk: 2/9\nChars: 1800-3800\n\nDeactivate SYSTEM.";
        assert_eq!(passage_text(content, 1200), "Deactivate SYSTEM.");
        assert_eq!(passage_text("abcdef", 3), "abc...");
        assert_eq!(source_name("📄 knowledge-pack://sap-and-security/sap-hana-security.md [chunk 2/9]"), "knowledge-pack://sap-and-security/sap-hana-security.md");
        let prompt = prompt_after("Which note?", &[("knowledge-pack://p/a.md".into(), "Note 1.".into())]);
        assert!(prompt.contains("[1] knowledge-pack://p/a.md\nNote 1."));
        assert!(prompt.ends_with("Question: Which note?"));
    }

    #[test]
    fn arguments_and_question_files_are_checked() {
        assert!(parse_args(Vec::<String>::new()).is_err());
        assert!(parse_args(["--questions", "q.jsonl", "--mode", "after"].map(String::from)).is_err());
        let both = parse_args(["--questions", "q.jsonl", "--app-dir", "/tmp/app"].map(String::from)).unwrap().unwrap();
        assert_eq!(both.mode, Mode::Both);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("q.jsonl");
        std::fs::write(&path, "{\"id\":\"a\",\"question\":\"Q?\",\"expect\":[\"x\"]}\n{\"id\":\"a\",\"question\":\"Q2?\",\"expect\":[\"y\"]}\n").unwrap();
        assert!(load_questions(&path).unwrap_err().contains("duplicate id"));
        std::fs::write(&path, "{\"id\":\"a\",\"question\":\"Q?\",\"expect\":[\"x\"],\"extra\":1}\n").unwrap();
        assert!(load_questions(&path).is_err());
        assert_eq!(strip_think("<think>hmm</think>\nAnswer."), "Answer.");
    }
}
