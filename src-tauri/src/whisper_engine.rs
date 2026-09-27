// Whisper Engine — 100% Local Voice Capture + Transcription Pipeline
//
// Provides true offline speech-to-text by:
//   1. Recording audio with cpal (cross-platform audio capture)
//   2. Saving as 16kHz mono WAV with hound
//   3. Transcribing with a local whisper.cpp sidecar (`whisper-cli`), spawned
//      only when needed — nothing runs in the background, nothing is bundled
//      into the app binary. Any audio format is first normalised to 16 kHz mono
//      WAV with ffmpeg when it is installed.
//
// No audio data ever leaves the device. If the sidecar or a model is missing the
// status says so honestly instead of pretending a transcript exists.

use std::path::{Path, PathBuf};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use serde::{Deserialize, Serialize};

/// Result of a whisper transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
    pub duration_ms: u64,
    pub engine: String,
    /// Length of the audio itself (when it could be read), not the processing time.
    #[serde(default)]
    pub audio_seconds: Option<f64>,
}

/// Whisper model size options (for future whisper.cpp integration)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WhisperModelSize {
    Tiny,    // ~75 MB, fastest
    Base,    // ~150 MB, good balance
    Small,   // ~500 MB, better quality
}

impl WhisperModelSize {
    pub fn filename(&self) -> &str {
        match self {
            WhisperModelSize::Tiny => "ggml-tiny.en.bin",
            WhisperModelSize::Base => "ggml-base.en.bin",
            WhisperModelSize::Small => "ggml-small.en.bin",
        }
    }

    pub fn download_url(&self) -> String {
        format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
            self.filename()
        )
    }

    #[allow(dead_code)]
    pub fn label(&self) -> &str {
        match self {
            WhisperModelSize::Tiny => "Tiny (75 MB) — Fastest",
            WhisperModelSize::Base => "Base (150 MB) — Recommended",
            WhisperModelSize::Small => "Small (500 MB) — Better quality",
        }
    }
}

/// Status of the whisper engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperStatus {
    pub available: bool,
    pub model_loaded: bool,
    pub model_name: Option<String>,
    pub model_path: Option<String>,
    pub recording: bool,
    /// The transcription sidecar (`whisper-cli`) was found on this machine.
    #[serde(default)]
    pub cli_available: bool,
    #[serde(default)]
    pub cli_path: Option<String>,
    #[serde(default)]
    pub install_hint: String,
}

/// Get the whisper models directory
pub fn models_dir(app_dir: &Path) -> PathBuf {
    let dir = app_dir.join("whisper-models");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// List available (downloaded) whisper models
pub fn list_models(app_dir: &Path) -> Vec<String> {
    let dir = models_dir(app_dir);
    let mut models = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("ggml-") && name.ends_with(".bin") {
                models.push(name);
            }
        }
    }

    models
}

/// Download a whisper model from Hugging Face (streaming download with progress)
pub async fn download_model(
    app_dir: &Path,
    size: WhisperModelSize,
    progress_callback: impl Fn(f64, String) + Send + 'static,
) -> Result<PathBuf, String> {
    let model_path = models_dir(app_dir).join(size.filename());

    if model_path.exists() && model_path.metadata().map(|m| m.len() > 1024).unwrap_or(false) {
        progress_callback(100.0, "Model already downloaded".to_string());
        return Ok(model_path);
    }

    let url = size.download_url();
    progress_callback(0.0, format!("Downloading {}...", size.filename()));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let temp_path = model_path.with_extension("bin.tmp");
    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {}", e))?;

        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let pct = (downloaded as f64 / total_size as f64) * 100.0;
            progress_callback(
                pct,
                format!(
                    "Downloading: {:.0} MB / {:.0} MB",
                    downloaded as f64 / 1_048_576.0,
                    total_size as f64 / 1_048_576.0
                ),
            );
        }
    }

    file.flush().await.map_err(|e| format!("Flush error: {}", e))?;
    drop(file);

    tokio::fs::rename(&temp_path, &model_path)
        .await
        .map_err(|e| format!("Rename error: {}", e))?;

    progress_callback(100.0, "Download complete!".to_string());
    Ok(model_path)
}

/// Record audio from the default input device and save as 16kHz mono WAV.
/// Recording stops when `stop_flag` is set to true.
pub fn record_audio(
    app_dir: &Path,
    stop_flag: Arc<AtomicBool>,
) -> Result<PathBuf, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No audio input device found")?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get input config: {}", e))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as u16;

    let samples: Arc<std::sync::Mutex<Vec<f32>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let samples_clone = Arc::clone(&samples);

    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if let Ok(mut buf) = samples_clone.lock() {
                    buf.extend_from_slice(data);
                }
            },
            |err| {
                eprintln!("[PrismOS-AI Whisper] Audio input error: {}", err);
            },
            None,
        )
        .map_err(|e| format!("Failed to build audio stream: {}", e))?;

    stream.play().map_err(|e| format!("Failed to start recording: {}", e))?;

    while !stop_flag.load(Ordering::Relaxed) {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    drop(stream);

    let raw_samples = samples.lock().map_err(|e| format!("Lock error: {}", e))?.clone();

    if raw_samples.is_empty() {
        return Err("No audio recorded".to_string());
    }

    // Convert to mono
    let mono_samples: Vec<f32> = if channels > 1 {
        raw_samples
            .chunks(channels as usize)
            .map(|chunk| chunk.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        raw_samples
    };

    // Resample to 16kHz for Whisper compatibility
    let target_rate = 16000u32;
    let resampled = if sample_rate != target_rate {
        let ratio = sample_rate as f64 / target_rate as f64;
        let output_len = (mono_samples.len() as f64 / ratio) as usize;
        (0..output_len)
            .map(|i| {
                let src_idx = i as f64 * ratio;
                let idx = src_idx as usize;
                let frac = src_idx - idx as f64;
                let s0 = mono_samples.get(idx).copied().unwrap_or(0.0);
                let s1 = mono_samples.get(idx + 1).copied().unwrap_or(s0);
                s0 + (s1 - s0) * frac as f32
            })
            .collect()
    } else {
        mono_samples
    };

    // Save as 16kHz mono 16-bit PCM WAV
    let wav_path = app_dir.join("whisper-recording.wav");
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::create(&wav_path, spec)
        .map_err(|e| format!("Failed to create WAV: {}", e))?;

    for sample in &resampled {
        let s = (*sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
        writer.write_sample(s).map_err(|e| format!("WAV write error: {}", e))?;
    }
    writer.finalize().map_err(|e| format!("WAV finalize error: {}", e))?;

    Ok(wav_path)
}

/// Full pipeline: record for N seconds → save WAV → return result
pub fn record_and_transcribe(
    app_dir: &Path,
    duration_secs: u64,
) -> Result<TranscriptionResult, String> {
    let start = std::time::Instant::now();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop_flag);

    // Auto-stop after duration
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(duration_secs));
        stop_clone.store(true, Ordering::Relaxed);
    });

    let wav_path = record_audio(app_dir, stop_flag)?;

    let file_size = std::fs::metadata(&wav_path).map(|m| m.len()).unwrap_or(0);
    let duration_estimate = file_size as f64 / (16000.0 * 2.0); // 16kHz, 16-bit

    // Real transcript when the sidecar + a model are present; an honest
    // capture-only note otherwise (never a string that looks like speech).
    if let (Some(cli), Some(model)) = (find_whisper_cli(), find_model(app_dir)) {
        return transcribe_with(&cli, find_ffmpeg().as_deref(), &model, &wav_path, &app_dir.join("audio-tmp"), TRANSCRIBE_TIMEOUT);
    }
    Ok(TranscriptionResult {
        text: format!(
            "[Audio captured: {:.1}s — no offline transcriber installed. {}]",
            duration_estimate, INSTALL_HINT
        ),
        language: "en".to_string(),
        duration_ms: start.elapsed().as_millis() as u64,
        engine: "cpal-local-capture".to_string(),
        audio_seconds: Some(duration_estimate),
    })
}

// ─── Offline transcription sidecar (whisper.cpp) ─────────────────────────────

use std::process::{Command, Stdio};
use std::time::Duration;

/// Audio formats accepted for drag-and-drop / attach.
pub const AUDIO_EXTS: &[&str] = &["wav", "mp3", "flac", "ogg", "m4a", "aac", "webm", "mp4", "aiff", "aif", "wma", "opus"];
/// Formats `whisper-cli` decodes by itself; the rest need ffmpeg.
pub const NATIVE_EXTS: &[&str] = &["wav", "mp3", "flac"];
pub const MAX_AUDIO_BYTES: u64 = 512 * 1024 * 1024;
pub const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
pub const INSTALL_HINT: &str = "Install whisper.cpp (macOS: `brew install whisper-cpp`; other platforms: github.com/ggml-org/whisper.cpp) and put a ggml-*.bin model in the models folder — or use the download button in Settings.";
const CLI_NAMES: &[&str] = &["whisper-cli", "whisper-cpp", "whisper"];
/// Best available quality first; `.en` variants are faster for English-only use.
const MODEL_PREFERENCE: &[&str] = &[
    "ggml-small.en.bin", "ggml-small.bin", "ggml-base.en.bin", "ggml-base.bin", "ggml-tiny.en.bin", "ggml-tiny.bin",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarStatus {
    pub ready: bool,
    pub cli_path: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub model_path: Option<String>,
    pub models_dir: String,
    pub native_formats: Vec<String>,
    pub all_formats: Vec<String>,
    pub install_hint: String,
}

fn is_executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.is_file() && p.metadata().map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        p.is_file()
    }
}

fn env_tool(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from).filter(|p| is_executable(p))
}

fn find_in_path(names: &[&str]) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    // GUI apps on macOS do not inherit the shell PATH — check Homebrew's dirs too.
    for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(extra));
    }
    for dir in dirs {
        for name in names {
            let candidate = dir.join(name);
            if is_executable(&candidate) {
                return Some(candidate);
            }
            #[cfg(windows)]
            {
                let exe = dir.join(format!("{name}.exe"));
                if exe.is_file() {
                    return Some(exe);
                }
            }
        }
    }
    None
}

pub fn find_whisper_cli() -> Option<PathBuf> {
    env_tool("PRISMOS_WHISPER_CLI").or_else(|| find_in_path(CLI_NAMES))
}

pub fn find_ffmpeg() -> Option<PathBuf> {
    env_tool("PRISMOS_FFMPEG").or_else(|| find_in_path(&["ffmpeg"]))
}

/// Pick the best model present in the models folder (ignores partial downloads).
pub fn find_model(app_dir: &Path) -> Option<PathBuf> {
    let dir = models_dir(app_dir);
    let usable = |p: &Path| p.is_file() && p.metadata().map(|m| m.len() > 1024).unwrap_or(false);
    for name in MODEL_PREFERENCE {
        let p = dir.join(name);
        if usable(&p) {
            return Some(p);
        }
    }
    list_models(app_dir).into_iter().map(|m| dir.join(m)).find(|p| usable(p))
}

pub fn sidecar_status(app_dir: &Path) -> SidecarStatus {
    let cli = find_whisper_cli();
    let model = find_model(app_dir);
    SidecarStatus {
        ready: cli.is_some() && model.is_some(),
        cli_path: cli.map(|p| p.display().to_string()),
        ffmpeg_path: find_ffmpeg().map(|p| p.display().to_string()),
        model_path: model.map(|p| p.display().to_string()),
        models_dir: models_dir(app_dir).display().to_string(),
        native_formats: NATIVE_EXTS.iter().map(|s| s.to_string()).collect(),
        all_formats: AUDIO_EXTS.iter().map(|s| s.to_string()).collect(),
        install_hint: INSTALL_HINT.to_string(),
    }
}

pub fn audio_extension(name: &str) -> Option<String> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    AUDIO_EXTS.contains(&ext.as_str()).then_some(ext)
}

/// Run a tool with a wall-clock limit. stderr is drained on a thread so a
/// chatty tool can never block on a full pipe; the child is killed on timeout.
fn run_with_timeout(cmd: &mut Command, timeout: Duration, what: &str) -> Result<String, String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start {what}: {e}"))?;
    let stderr = child.stderr.take();
    let drain = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut s) = stderr {
            let _ = std::io::Read::read_to_string(&mut s, &mut buf);
        }
        buf
    });
    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    // Do NOT join the drain thread: a grandchild (e.g. a tool's
                    // helper process) may still hold the stderr pipe open and
                    // would make us wait for it. The thread ends on its own.
                    return Err(format!("{what} timed out after {}s", timeout.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("{what} failed: {e}")),
        }
    };
    let stderr_text = drain.join().unwrap_or_default();
    if !status.success() {
        let tail: String = stderr_text.chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(format!("{what} exited with {status}: {}", tail.trim()));
    }
    Ok(stderr_text)
}

fn wav_seconds(path: &Path) -> Option<f64> {
    let reader = hound::WavReader::open(path).ok()?;
    let spec = reader.spec();
    if spec.sample_rate == 0 || spec.channels == 0 {
        return None;
    }
    Some(reader.duration() as f64 / spec.sample_rate as f64)
}

/// Transcribe one audio file with explicit tool paths (testable without whisper
/// installed). `ffmpeg` normalises any format to 16 kHz mono WAV first.
pub fn transcribe_with(
    cli: &Path,
    ffmpeg: Option<&Path>,
    model: &Path,
    audio: &Path,
    work_dir: &Path,
    timeout: Duration,
) -> Result<TranscriptionResult, String> {
    let start = std::time::Instant::now();
    let name = audio.file_name().and_then(|n| n.to_str()).unwrap_or("audio");
    let ext = audio_extension(name).ok_or_else(|| {
        format!("Unsupported audio format '{name}'. Supported: {}", AUDIO_EXTS.join(", "))
    })?;
    let size = std::fs::metadata(audio).map_err(|e| format!("Cannot read audio file: {e}"))?.len();
    if size > MAX_AUDIO_BYTES {
        return Err(format!("Audio file is too large ({} MB > {} MB)", size / 1_048_576, MAX_AUDIO_BYTES / 1_048_576));
    }
    std::fs::create_dir_all(work_dir).map_err(|e| format!("Cannot create work folder: {e}"))?;
    let job = uuid::Uuid::new_v4().to_string();
    let mut temp_files: Vec<PathBuf> = Vec::new();

    let input: PathBuf = match ffmpeg {
        Some(ff) => {
            let wav = work_dir.join(format!("{job}.wav"));
            let mut cmd = Command::new(ff);
            cmd.args(["-nostdin", "-loglevel", "error", "-y", "-i"])
                .arg(audio)
                .args(["-vn", "-ac", "1", "-ar", "16000", "-f", "wav"])
                .arg(&wav);
            run_with_timeout(&mut cmd, timeout, "ffmpeg")?;
            temp_files.push(wav.clone());
            wav
        }
        None if NATIVE_EXTS.contains(&ext.as_str()) => audio.to_path_buf(),
        None => {
            return Err(format!(
                "'{ext}' files need ffmpeg to decode (brew install ffmpeg). Without it only {} are supported.",
                NATIVE_EXTS.join("/")
            ))
        }
    };
    let audio_seconds = wav_seconds(&input);

    let out_base = work_dir.join(&job);
    let out_txt = work_dir.join(format!("{job}.txt"));
    temp_files.push(out_txt.clone());
    let mut cmd = Command::new(cli);
    cmd.arg("-m").arg(model).arg("-f").arg(&input)
        .args(["-otxt", "-of"]).arg(&out_base)
        .args(["-nt", "-np", "-l", "auto"]);
    let run = run_with_timeout(&mut cmd, timeout, "whisper-cli");
    let text = run.and_then(|_| {
        std::fs::read_to_string(&out_txt).map_err(|e| format!("whisper-cli produced no transcript: {e}"))
    });
    for f in &temp_files {
        let _ = std::fs::remove_file(f);
    }
    let raw = text?;
    let text: String = raw
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if text.is_empty() {
        return Err("No speech was recognised in this recording.".to_string());
    }
    Ok(TranscriptionResult {
        text,
        language: "auto".to_string(),
        duration_ms: start.elapsed().as_millis() as u64,
        engine: "whisper.cpp (local sidecar)".to_string(),
        audio_seconds,
    })
}

/// Transcribe with whatever is installed on this machine.
pub fn transcribe_file(app_dir: &Path, audio: &Path) -> Result<TranscriptionResult, String> {
    let cli = find_whisper_cli().ok_or_else(|| format!("No offline transcriber found. {INSTALL_HINT}"))?;
    let model = find_model(app_dir).ok_or_else(|| {
        format!("No whisper model found in {}. {INSTALL_HINT}", models_dir(app_dir).display())
    })?;
    transcribe_with(&cli, find_ffmpeg().as_deref(), &model, audio, &app_dir.join("audio-tmp"), TRANSCRIBE_TIMEOUT)
}

#[cfg(all(test, unix))]
mod sidecar_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }
    // Fake whisper-cli: writes a transcript to "<-of arg>.txt".
    const FAKE_CLI: &str = r#"out=""; while [ $# -gt 0 ]; do case "$1" in -of) out="$2"; shift;; esac; shift; done; printf '  Hello   world.

  Second line.
' > "$out.txt""#;
    // Fake ffmpeg: copies the "-i" input to the last argument.
    const FAKE_FFMPEG: &str = r#"in=""; while [ $# -gt 0 ]; do case "$1" in -i) in="$2"; shift;; esac; last="$1"; shift; done; cp "$in" "$last""#;

    fn one_second_wav(path: &Path) {
        let spec = hound::WavSpec { channels: 1, sample_rate: 16000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for _ in 0..16000 { w.write_sample(0i16).unwrap(); }
        w.finalize().unwrap();
    }

    #[test]
    fn transcribes_native_wav_without_ffmpeg_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let cli = script(dir.path(), "whisper-cli", FAKE_CLI);
        let model = dir.path().join("ggml-base.en.bin"); std::fs::write(&model, vec![0u8; 2048]).unwrap();
        let wav = dir.path().join("memo.wav"); one_second_wav(&wav);
        let work = dir.path().join("work");
        let r = transcribe_with(&cli, None, &model, &wav, &work, Duration::from_secs(10)).unwrap();
        assert_eq!(r.text, "Hello world.\nSecond line.");
        assert_eq!(r.audio_seconds, Some(1.0));
        assert_eq!(r.engine, "whisper.cpp (local sidecar)");
        assert_eq!(std::fs::read_dir(&work).unwrap().count(), 0, "temp files must be removed");
        assert!(wav.exists(), "the user's file is never deleted");
    }

    #[test]
    fn non_native_formats_need_ffmpeg_and_use_it_when_present() {
        let dir = tempfile::tempdir().unwrap();
        let cli = script(dir.path(), "whisper-cli", FAKE_CLI);
        let ff = script(dir.path(), "ffmpeg", FAKE_FFMPEG);
        let model = dir.path().join("m.bin"); std::fs::write(&model, vec![0u8; 2048]).unwrap();
        let m4a = dir.path().join("meeting.m4a"); one_second_wav(&m4a); // content is irrelevant to the fake
        let err = transcribe_with(&cli, None, &model, &m4a, &dir.path().join("w1"), Duration::from_secs(10)).unwrap_err();
        assert!(err.contains("ffmpeg"), "{err}");
        let ok = transcribe_with(&cli, Some(&ff), &model, &m4a, &dir.path().join("w2"), Duration::from_secs(10)).unwrap();
        assert!(ok.text.starts_with("Hello world."));
    }

    #[test]
    fn rejects_unsupported_extensions_and_reports_tool_failures() {
        let dir = tempfile::tempdir().unwrap();
        let cli = script(dir.path(), "whisper-cli", FAKE_CLI);
        let model = dir.path().join("m.bin"); std::fs::write(&model, vec![0u8; 2048]).unwrap();
        let exe = dir.path().join("notes.exe"); std::fs::write(&exe, b"x").unwrap();
        assert!(transcribe_with(&cli, None, &model, &exe, dir.path(), Duration::from_secs(5)).unwrap_err().contains("Unsupported audio format"));
        let failing = script(dir.path(), "bad-cli", "echo 'model load failed' >&2; exit 3");
        let wav = dir.path().join("a.wav"); one_second_wav(&wav);
        let err = transcribe_with(&failing, None, &model, &wav, dir.path(), Duration::from_secs(5)).unwrap_err();
        assert!(err.contains("exited with") && err.contains("model load failed"), "{err}");
        let silent = script(dir.path(), "silent-cli", r#"out=""; while [ $# -gt 0 ]; do case "$1" in -of) out="$2"; shift;; esac; shift; done; : > "$out.txt""#);
        assert!(transcribe_with(&silent, None, &model, &wav, dir.path(), Duration::from_secs(5)).unwrap_err().contains("No speech"));
    }

    #[test]
    fn hung_tools_are_killed_at_the_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let slow = script(dir.path(), "slow-cli", "sleep 5");
        let model = dir.path().join("m.bin"); std::fs::write(&model, vec![0u8; 2048]).unwrap();
        let wav = dir.path().join("a.wav"); one_second_wav(&wav);
        let t = std::time::Instant::now();
        let err = transcribe_with(&slow, None, &model, &wav, dir.path(), Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("timed out"), "{err}");
        assert!(t.elapsed() < Duration::from_secs(3), "must not wait for the hung child");
    }

    #[test]
    fn model_preference_and_status_are_honest() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_model(dir.path()).is_none());
        let md = models_dir(dir.path());
        std::fs::write(md.join("ggml-tiny.en.bin"), vec![0u8; 4096]).unwrap();
        std::fs::write(md.join("ggml-small.en.bin"), vec![0u8; 10]).unwrap(); // partial download → ignored
        assert!(find_model(dir.path()).unwrap().ends_with("ggml-tiny.en.bin"));
        std::fs::write(md.join("ggml-base.en.bin"), vec![0u8; 4096]).unwrap();
        assert!(find_model(dir.path()).unwrap().ends_with("ggml-base.en.bin"));
        let status = sidecar_status(dir.path());
        assert_eq!(status.ready, find_whisper_cli().is_some(), "ready must track the real CLI presence");
        assert!(status.install_hint.contains("whisper"));
        assert_eq!(audio_extension("Talk.MP3"), Some("mp3".into()));
        assert_eq!(audio_extension("doc.pdf"), None);
    }
}
