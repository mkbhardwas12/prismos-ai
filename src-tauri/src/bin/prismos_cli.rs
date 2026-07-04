// PrismOS-AI — CLI mode
//
// A tiny, dependency-light command-line entrypoint that talks directly to a
// locally running Ollama daemon. It does NOT pull in the Tauri app, so devs can
// kick the tires without a GUI:
//
//   prismos-cli ask "what's the difference between async and threads in Rust?"
//   echo "summarize this" | prismos-cli ask --model qwen3:4b --stdin
//   prismos-cli models
//   prismos-cli health
//
// The full GUI still does the agent debate / Spectrum Graph / Brain Wrapped
// flow — this CLI is the "quick check" surface for devs and shell scripts.
//

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use std::process::ExitCode;
use std::time::Duration;

const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";
const DEFAULT_MODEL: &str = "qwen3:4b";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
const GENERATE_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    prompt: String,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct GenerateChunk {
    #[serde(default)]
    response: String,
    #[serde(default)]
    done: bool,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    name: String,
    #[serde(default)]
    size: u64,
}

#[derive(Debug, Deserialize)]
struct ModelList {
    models: Vec<ModelEntry>,
}

// ─── arg parsing ──────────────────────────────────────────────────────────────

#[derive(Debug)]
struct Args {
    cmd: Cmd,
    model: String,
    base_url: String,
    no_stream: bool,
    from_stdin: bool,
    prompt: String,
}

#[derive(Debug, PartialEq, Eq)]
enum Cmd {
    Ask,
    Models,
    Health,
    Help,
    Version,
}

fn parse_args() -> Result<Args, String> {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    if raw.is_empty() {
        return Ok(Args::help());
    }

    let cmd = match raw[0].as_str() {
        "ask"               => Cmd::Ask,
        "models" | "list"   => Cmd::Models,
        "health" | "ping"   => Cmd::Health,
        "-h" | "--help" | "help" => Cmd::Help,
        "-V" | "--version"  => Cmd::Version,
        other => return Err(format!("unknown command: {other}")),
    };

    let mut args = Args {
        cmd,
        model:     std::env::var("PRISMOS_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string()),
        base_url:  std::env::var("PRISMOS_OLLAMA_URL").unwrap_or_else(|_| DEFAULT_OLLAMA_URL.to_string()),
        no_stream: false,
        from_stdin: false,
        prompt: String::new(),
    };

    let mut i = 1;
    let mut positional: Vec<String> = Vec::new();
    while i < raw.len() {
        match raw[i].as_str() {
            "--model" | "-m" => {
                i += 1;
                args.model = raw.get(i).ok_or("--model needs a value")?.clone();
            }
            "--url" => {
                i += 1;
                args.base_url = raw.get(i).ok_or("--url needs a value")?.clone();
            }
            "--no-stream" => args.no_stream = true,
            "--stdin"     => args.from_stdin = true,
            "--help" | "-h" => {
                args.cmd = Cmd::Help;
            }
            other if other.starts_with("--") => {
                return Err(format!("unknown flag: {other}"));
            }
            other => positional.push(other.to_string()),
        }
        i += 1;
    }

    if args.cmd == Cmd::Ask {
        if args.from_stdin {
            let mut buf = String::new();
            io::stdin().read_to_string(&mut buf).map_err(|e| e.to_string())?;
            args.prompt = buf.trim().to_string();
        } else {
            args.prompt = positional.join(" ");
        }
        if args.prompt.is_empty() {
            return Err("ask: empty prompt (pass a quoted string or use --stdin)".to_string());
        }
    }

    Ok(args)
}

impl Args {
    fn help() -> Self {
        Args {
            cmd: Cmd::Help,
            model: DEFAULT_MODEL.to_string(),
            base_url: DEFAULT_OLLAMA_URL.to_string(),
            no_stream: false,
            from_stdin: false,
            prompt: String::new(),
        }
    }
}

const HELP: &str = "\
prismos-cli — quick local LLM checks for PrismOS-AI

USAGE
  prismos-cli <command> [options]

COMMANDS
  ask  \"<prompt>\"     Run a single-shot completion against your local Ollama.
  models               List models available on the local Ollama daemon.
  health               Check that the local Ollama daemon is reachable.
  help, --help, -h     Show this help.
  --version, -V        Print version.

OPTIONS
  -m, --model <name>   Model to use (default: qwen3:4b, env: PRISMOS_MODEL)
      --url <url>      Ollama base URL (default: http://localhost:11434,
                       env: PRISMOS_OLLAMA_URL)
      --no-stream      Print the full answer at the end instead of streaming.
      --stdin          Read the prompt from stdin (lets you pipe in files).

EXAMPLES
  prismos-cli health
  prismos-cli models
  prismos-cli ask \"explain WASM sandboxing in one paragraph\"
  cat notes.md | prismos-cli ask --stdin --model qwen3:4b

The CLI talks to Ollama directly — your data never leaves the machine.
For the full agent-debate experience, launch the GUI: `npm run tauri dev`.
";

// ─── runtime ──────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("error: {e}");
            eprintln!("\n{HELP}");
            return ExitCode::from(2);
        }
    };

    match args.cmd {
        Cmd::Help    => { print!("{HELP}"); ExitCode::SUCCESS }
        Cmd::Version => { println!("prismos-cli {}", env!("CARGO_PKG_VERSION")); ExitCode::SUCCESS }
        Cmd::Health  => match check_health(&args.base_url).await {
            Ok(true)  => { println!("ok — ollama is up at {}", args.base_url); ExitCode::SUCCESS }
            Ok(false) => { eprintln!("down — no response from {}", args.base_url); ExitCode::from(1) }
            Err(e)    => { eprintln!("error: {e}"); ExitCode::from(1) }
        },
        Cmd::Models  => match list_models(&args.base_url).await {
            Ok(models) => {
                if models.is_empty() {
                    println!("(no models pulled — try: ollama pull qwen3:4b)");
                } else {
                    for m in models {
                        println!("{:<32}  {:>10}", m.name, human_size(m.size));
                    }
                }
                ExitCode::SUCCESS
            }
            Err(e) => { eprintln!("error: {e}"); ExitCode::from(1) }
        },
        Cmd::Ask => {
            if !matches!(check_health(&args.base_url).await, Ok(true)) {
                eprintln!(
                    "error: can't reach ollama at {}\nhint: start it with `ollama serve` (or install via scripts/install.sh)",
                    args.base_url
                );
                return ExitCode::from(1);
            }
            let res = if args.no_stream {
                generate_blocking(&args).await
            } else {
                generate_streaming(&args).await
            };
            match res {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => { eprintln!("\nerror: {e}"); ExitCode::from(1) }
            }
        }
    }
}

// ─── ops ──────────────────────────────────────────────────────────────────────

async fn check_health(url: &str) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::new();
    match client.get(format!("{url}/api/version")).timeout(HEALTH_TIMEOUT).send().await {
        Ok(r) => Ok(r.status().is_success()),
        Err(_) => Ok(false),
    }
}

async fn list_models(url: &str) -> Result<Vec<ModelEntry>, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::new();
    let resp = client.get(format!("{url}/api/tags")).timeout(HEALTH_TIMEOUT * 4).send().await?;
    if !resp.status().is_success() {
        return Err(format!("ollama returned {}", resp.status()).into());
    }
    let list: ModelList = resp.json().await?;
    Ok(list.models)
}

async fn generate_blocking(a: &Args) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::new();
    let body = GenerateRequest { model: &a.model, prompt: a.prompt.clone(), stream: false };
    let resp = client
        .post(format!("{}/api/generate", a.base_url))
        .json(&body)
        .timeout(GENERATE_TIMEOUT)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(format!("ollama returned {}: {}", resp.status(), resp.text().await.unwrap_or_default()).into());
    }
    let parsed: GenerateChunk = resp.json().await?;
    println!("{}", parsed.response);
    Ok(())
}

async fn generate_streaming(a: &Args) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::new();
    let body = GenerateRequest { model: &a.model, prompt: a.prompt.clone(), stream: true };
    let resp = client
        .post(format!("{}/api/generate", a.base_url))
        .json(&body)
        .timeout(GENERATE_TIMEOUT)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(format!("ollama returned {}: {}", resp.status(), resp.text().await.unwrap_or_default()).into());
    }

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk?;
        buf.extend_from_slice(&bytes);
        // Ollama streams newline-delimited JSON objects.
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line = buf.drain(..=pos).collect::<Vec<u8>>();
            let line = &line[..line.len().saturating_sub(1)];
            if line.is_empty() { continue; }
            match serde_json::from_slice::<GenerateChunk>(line) {
                Ok(c) => {
                    if !c.response.is_empty() {
                        out.write_all(c.response.as_bytes())?;
                        out.flush()?;
                    }
                    if c.done {
                        writeln!(out)?;
                        return Ok(());
                    }
                }
                Err(_) => {
                    // ignore malformed/keepalive lines
                }
            }
        }
    }
    writeln!(out)?;
    Ok(())
}

fn human_size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit = 0;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    if unit == 0 { format!("{} {}", bytes, UNITS[0]) } else { format!("{:.1} {}", size, UNITS[unit]) }
}
