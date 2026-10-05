// PrismOS-AI Intent Input — Natural Language Input with Voice + Vision Support
//
// Supports typed, voice, image drag-drop, and camera capture input.
// All processing stays local — no data leaves your device.
// Vision powered by local multimodal models (llava, llama3.2-vision).

import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type DragEvent, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVoice } from "../hooks/useVoice";
import { cleanHeader } from "../lib/researchLane";
import "./IntentInput.css";

/** Image extensions we accept for vision analysis */
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif"];

/** Document extensions we accept for text extraction & analysis */
const DOCUMENT_EXTENSIONS = [
  "pdf", "docx", "pptx", "xlsx", "xls", "txt", "md", "csv", "json", "rtf",
  // Logs and configs for the security lane (SAP instance profiles are often DEFAULT.PFL).
  "log", "ini", "pfl", "conf", "cfg", "yaml", "yml", "xml", "sql", "tsv",
];

/** Several sources can be attached at once; the research lane cites each one. */
const MAX_SOURCES = 8;
const DOC_PROMPT = "Summarize this document.";
const MULTI_PROMPT = "Compare these sources: where do they agree and where do they differ?";

/** Maximum file size in bytes (25 MB) — keeps memory & performance safe */
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_FILE_SIZE_LABEL = "25 MB";

/** Audio we transcribe offline via the whisper.cpp sidecar (see whisper_engine.rs) */
const AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "flac", "ogg", "aac", "webm", "aiff", "aif", "opus"];
/** Recordings are large; the Rust side re-checks its own cap. */
const MAX_AUDIO_SIZE_BYTES = 200 * 1024 * 1024;
const AUDIO_PROMPT = "Summarize this recording: key points, decisions, and action items.";

/** One attached source: its extracted text (with its [Document|File|Audio: …] header). */
interface AttachedDoc {
  name: string;
  text: string;
  meta: string;
}

/** Check if a filename is a supported audio recording */
function isAudioFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSIONS.includes(ext);
}

/** Base64-encode a File in chunks (avoids call-stack overflow on large files). */
async function fileToBase64(file: File): Promise<string> {
  const uint8 = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 32768;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Check if a filename is an image */
function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

/** Check if a filename is a supported document */
function isDocumentFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return DOCUMENT_EXTENSIONS.includes(ext);
}

/** Get emoji icon for document type */
function getDocIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf": return "📕";
    case "docx": case "doc": return "📘";
    case "pptx": case "ppt": return "📙";
    case "xlsx": case "xls": return "📗";
    case "csv": return "📊";
    case "md": return "📝";
    case "wav": case "mp3": case "m4a": case "flac": case "ogg": case "aac": case "webm": case "aiff": case "aif": case "opus": return "🎙️";
    default: return "📄";
  }
}

interface IntentInputProps {
  onSubmit: (input: string, imageData?: string, documentText?: string) => void;
  isProcessing: boolean;
  voiceEnabled?: boolean;
  pendingIntent?: string;
  onPendingConsumed?: () => void;
  onScreenRead?: (prompt?: string) => Promise<void>;
}

export default function IntentInput({
  onSubmit,
  isProcessing,
  voiceEnabled = true,
  pendingIntent,
  onPendingConsumed,
  onScreenRead,
}: IntentInputProps) {
  const [input, setInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [droppedFileName, setDroppedFileName] = useState<string | null>(null);
  // ── Vision state (Phase 5.5) ──
  const [attachedImage, setAttachedImage] = useState<string | null>(null); // base64
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null); // data URL for preview
  const [imageName, setImageName] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  // ── Document state (Phase 5.5); several sources can be attached at once ──
  const [docs, setDocs] = useState<AttachedDoc[]>([]);
  const docsRef = useRef<AttachedDoc[]>([]); // synchronous copy for sequential multi-file attaches
  // Files still being read or transcribed; sending waits until all are in.
  const [pending, setPending] = useState<{ id: number; name: string; note: string }[]>([]);
  const pendingRef = useRef(0);
  const nextPendingId = useRef(0);
  const isExtractingDoc = pending.length > 0;
  const attachedDocument = docs.length ? docs.map((d) => d.text).join("\n\n") : null;
  // ── Screen reading state (Phase 7) ──
  const [isReadingScreen, setIsReadingScreen] = useState(false);
  // ── Attach menu state ──
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Auto-fill input when a pending intent arrives (from example chips)
  useEffect(() => {
    if (pendingIntent) {
      setInput(pendingIntent);
      onPendingConsumed?.();
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
        }
      }, 50);
    }
  }, [pendingIntent, onPendingConsumed]);

  // Voice transcript callback — auto-submits when speech is final
  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      if (transcript.trim() && !isProcessing) {
        setInput(transcript);
        onSubmit(transcript.trim());
        setInput("");
      }
    },
    [onSubmit, isProcessing]
  );

  const voice = useVoice(handleVoiceTranscript, voiceEnabled);

  function handleSubmit() {
    const trimmed = input.trim();
    if ((!trimmed && !attachedImage && !attachedDocument) || isProcessing || pendingRef.current > 0) return;
    const prompt = trimmed || (attachedImage ? "Describe this image in detail." : docs.length > 1 ? MULTI_PROMPT : DOC_PROMPT);
    onSubmit(prompt, attachedImage ?? undefined, attachedDocument ?? undefined);
    setInput("");
    clearAttachedImage();
    clearAttachedDocument();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  /** Clear attached image state */
  function clearAttachedImage() {
    setAttachedImage(null);
    setImagePreviewUrl(null);
    setImageName(null);
  }

  /** Clear every attached document */
  function clearAttachedDocument() {
    docsRef.current = [];
    setDocs([]);
  }

  /** Remove one attached source */
  function removeDocument(index: number) {
    docsRef.current = docsRef.current.filter((_, i) => i !== index);
    setDocs(docsRef.current);
  }

  /** Add a source after the ones already attached. */
  function addDocument(doc: AttachedDoc) {
    // Every source keeps a clean header so the research lane can tell them apart.
    const text = cleanHeader(doc.text, doc.name);
    docsRef.current = [...docsRef.current, { ...doc, text }];
    setDocs(docsRef.current);
  }

  /** Track a file that is being read; returns the id to finish it with. */
  function beginPending(name: string, note: string): number {
    const id = nextPendingId.current++;
    pendingRef.current += 1;
    setPending((prev) => [...prev, { id, name, note }]);
    return id;
  }

  function endPending(id: number) {
    pendingRef.current = Math.max(0, pendingRef.current - 1);
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  /** Room for one more source (counting files still being read)? Warns in the input when not. */
  function hasRoomForSource(name: string): boolean {
    if (docsRef.current.length + pendingRef.current < MAX_SOURCES) return true;
    setInput((prev) => prev + `\n⚠️ ${name} not attached: ${MAX_SOURCES} sources is the limit for one question.`);
    return false;
  }

  /** Fill the input with a sensible request, unless the user already typed one. */
  function suggestPrompt(single: string) {
    const next = docsRef.current.length > 1 ? MULTI_PROMPT : single;
    setInput((prev) => (!prev.trim() || [DOC_PROMPT, AUDIO_PROMPT, MULTI_PROMPT].includes(prev.trim()) ? next : prev));
  }

  /** Attach a document by extracting its text via Rust backend */
  async function attachDocumentFromPath(filePath: string, fileName: string) {
    if (!hasRoomForSource(fileName)) return;
    const job = beginPending(fileName, "Extracting text...");
    try {
      const text: string = await invoke("extract_file_text", { path: filePath });
      // Parse metadata from the header line [Document: ... | Type: ... | ...]
      const metaMatch = text.match(/\[Document:.*?\|(.+?)\]/);
      addDocument({ name: fileName, text, meta: metaMatch ? metaMatch[1].trim() : `${fileName.split('.').pop()?.toUpperCase()} document` });
    } catch (err) {
      console.error("Document extraction error:", err);
      // Show error in input as fallback
      setInput((prev) => prev + `\n⚠️ Could not extract text from ${fileName}: ${err}`);
    } finally {
      endPending(job);
    }
  }

  /** Attach a document from a File object — sends binary files to Rust for proper extraction */
  async function attachDocumentFromFile(file: File) {
    if (!hasRoomForSource(file.name)) return;
    const job = beginPending(file.name, "Extracting text...");
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || "";
      const binaryFormats = ["pdf", "docx", "pptx", "xlsx", "xls"];

      if (binaryFormats.includes(ext)) {
        // Binary formats (PDF/DOCX/PPTX/XLSX): read as ArrayBuffer → base64 → send to Rust
        const base64 = await fileToBase64(file);
        const text: string = await invoke("extract_document_from_bytes", {
          data: base64,
          fileName: file.name,
        });
        const metaMatch = text.match(/\[Document:.*?\|(.+?)\]/);
        addDocument({ name: file.name, text, meta: metaMatch ? metaMatch[1].trim() : `${ext.toUpperCase()} document` });
      } else {
        // Text formats: read as UTF-8 text directly
        const text = await file.text();
        addDocument({ name: file.name, text: `[File: ${file.name}]\n${text}`, meta: `${ext.toUpperCase()} | ${Math.round(text.length / 1024)}KB` });
      }
    } catch (err) {
      console.error("Document extraction error:", err);
      setInput((prev) => prev + `\n⚠️ Could not extract text from ${file.name}: ${err}`);
    } finally {
      endPending(job);
    }
  }

  /** Attach an audio recording: transcribed offline by the whisper.cpp sidecar, then
   *  handled exactly like a document (RAG answer + indexed into the graph). */
  async function attachAudioFromFile(file: File) {
    if (file.size > MAX_AUDIO_SIZE_BYTES) {
      setInput((prev) => prev + `\n⚠️ ${file.name} is larger than 200 MB — trim the recording first.`);
      return;
    }
    if (!hasRoomForSource(file.name)) return;
    const job = beginPending(file.name, "Transcribing locally…");
    try {
      // Honest pre-flight: fail with the install hint instead of a cryptic error.
      const status = JSON.parse(await invoke<string>("audio_sidecar_status")) as {
        ready: boolean; cli_path: string | null; model_path: string | null; install_hint: string;
      };
      if (!status.ready) {
        throw new Error(status.cli_path ? `No whisper model found. ${status.install_hint}` : `whisper.cpp is not installed. ${status.install_hint}`);
      }
      const base64 = await fileToBase64(file);
      const result = JSON.parse(await invoke<string>("transcribe_audio_bytes", { data: base64, fileName: file.name })) as {
        text: string; engine: string; audio_seconds: number | null;
      };
      const secs = result.audio_seconds ? `${Math.round(result.audio_seconds)}s` : "";
      addDocument({
        name: file.name,
        text: `[Audio: ${file.name}${secs ? ` | ${secs}` : ""} | transcribed offline by ${result.engine}]\n\n${result.text}`,
        meta: `Transcript${secs ? ` · ${secs}` : ""} · ${result.engine}`,
      });
    } catch (err) {
      console.error("Audio transcription error:", err);
      setInput((prev) => prev + `\n⚠️ Could not transcribe ${file.name}: ${err instanceof Error ? err.message : err}`);
    } finally {
      endPending(job);
    }
  }

  /** Attach an image from a base64 string */
  function attachImageBase64(base64: string, name: string) {
    setAttachedImage(base64);
    setImagePreviewUrl(`data:image/png;base64,${base64}`);
    setImageName(name);
  }

  /** Read a File object as base64 and attach it */
  function attachImageFromFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Extract pure base64 (strip data:image/...;base64, prefix)
      const base64 = dataUrl.split(",")[1] ?? dataUrl;
      setAttachedImage(base64);
      setImagePreviewUrl(dataUrl);
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  }

  // ── Camera capture (Phase 5.5) ──
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      cameraStreamRef.current = stream;
      setCameraActive(true);
      // Wait for the video element to mount
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch (err) {
      console.error("Camera access denied:", err);
    }
  }

  function captureFrame() {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1] ?? dataUrl;
    setAttachedImage(base64);
    setImagePreviewUrl(dataUrl);
    setImageName("camera-capture.png");
    stopCamera();
  }

  function stopCamera() {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraActive(false);
  }

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Close attach menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    }
    if (attachMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [attachMenuOpen]);

  /** Check file size and show error if too large. Returns true if OK. */
  function checkFileSize(file: File): boolean {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setInput((prev) => prev + `\n⚠️ File too large (${sizeMB} MB). Maximum is ${MAX_FILE_SIZE_LABEL}.`);
      return false;
    }
    return true;
  }

  /** Handle image file selection via hidden file input */
  function handleImageFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && isImageFile(file.name)) {
      if (!checkFileSize(file)) { e.target.value = ""; return; }
      attachImageFromFile(file);
    }
    // Reset input so the same file can be selected again
    e.target.value = "";
  }

  /** Attach one document or recording (picker or drop). */
  async function attachSourceFile(file: File) {
    if (isAudioFile(file.name)) {
      await attachAudioFromFile(file);
      suggestPrompt(AUDIO_PROMPT);
      return;
    }
    if (!checkFileSize(file)) return;
    const filePath = (file as File & { path?: string }).path;
    if (filePath) {
      await attachDocumentFromPath(filePath, file.name);
    } else {
      await attachDocumentFromFile(file);
    }
    suggestPrompt(DOC_PROMPT);
  }

  /** Handle document file selection via hidden file input (several files allowed) */
  async function handleDocFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const target = e.target;
    const files = Array.from(target.files ?? []);
    // Reset first so the same file can be picked again later
    target.value = "";
    for (const file of files) {
      await attachSourceFile(file);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function autoResize() {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }

  // ── Drag & Drop File Ingest (Phase 5) ──
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  // A plain function (not memoised) so it always sees the current input.
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    // Several files: each one is attached in turn (documents become separate sources).
    for (const file of files) {
      await attachDroppedFile(file);
    }
  }

  async function attachDroppedFile(file: File) {
    const fileName = file.name;

    // ── Audio recordings and documents → attached sources ──
    if (isAudioFile(fileName)) {
      await attachSourceFile(file);
      return;
    }

    // ── File size guard ──
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setInput((prev) => prev + `\n⚠️ File too large (${sizeMB} MB). Maximum is ${MAX_FILE_SIZE_LABEL}.`);
      return;
    }

    // ── Image files → attach for vision analysis ──
    if (isImageFile(fileName)) {
      const filePath = (file as File & { path?: string }).path;
      if (filePath) {
        // Tauri desktop: read image via Rust backend
        try {
          const base64: string = await invoke("read_image_as_base64", { path: filePath });
          attachImageBase64(base64, fileName);
        } catch (err) {
          console.error("Image read error:", err);
        }
      } else {
        // Browser fallback: read via FileReader
        attachImageFromFile(file);
      }
      setInput((prev) => (prev.trim() ? prev : "Describe this image in detail."));
      return;
    }

    // ── Document files → attach for analysis (Phase 5.5) ──
    if (isDocumentFile(fileName)) {
      await attachSourceFile(file);
      return;
    }

    // ── Other text files → extract content inline (existing behavior) ──
    setDroppedFileName(fileName);

    try {
      const filePath = (file as File & { path?: string }).path;

      if (filePath) {
        const text: string = await invoke("extract_file_text", { path: filePath });
        setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
        autoResize();
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          const prefixed = `[File: ${fileName}]\n${text}`;
          setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${prefixed}` : prefixed));
          autoResize();
        };
        reader.readAsText(file);
      }
    } catch (err) {
      console.error("File drop error:", err);
      setDroppedFileName(null);
    }

    setTimeout(() => setDroppedFileName(null), 4000);
  }

  return (
    <div
      className={`intent-input-container ${isDragOver ? "drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay indicator */}
      {isDragOver && (
        <div className="drag-overlay" aria-hidden="true">
          <span className="drag-overlay-icon">📄</span>
          <span className="drag-overlay-text">Drop file, image, or document to analyze</span>
        </div>
      )}

      {/* Dropped file indicator */}
      {droppedFileName && (
        <div className="dropped-file-badge" role="status">
          <span>📎 {droppedFileName}</span>
          <button onClick={() => setDroppedFileName(null)} aria-label="Remove file">×</button>
        </div>
      )}

      {/* ── Attached Image Preview (Phase 5.5 — Local Vision) ── */}
      {imagePreviewUrl && (
        <div className="vision-preview" role="status">
          <img src={imagePreviewUrl} alt={imageName ?? "Attached image"} className="vision-preview-img" />
          <div className="vision-preview-info">
            <span className="vision-preview-name">🖼️ {imageName}</span>
            <span className="vision-preview-hint">Will analyze with local vision model</span>
          </div>
          <button
            className="vision-preview-remove"
            onClick={clearAttachedImage}
            aria-label="Remove attached image"
            title="Remove image"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Attached Document Preview (Phase 5.5 — Document Analysis) ── */}
      {(docs.length > 0 || pending.length > 0) && (
        <div className={`doc-preview-list ${docs.length + pending.length > 1 ? "doc-preview-list-multi" : ""}`}>
          {docs.map((doc, index) => (
            <div className="doc-preview" role="status" key={`${doc.name}-${index}`}>
              <span className="doc-preview-icon">{getDocIcon(doc.name)}</span>
              <div className="doc-preview-info">
                <span className="doc-preview-name">{doc.name}</span>
                <span className="doc-preview-hint">{doc.meta || "Ready for analysis"}</span>
              </div>
              {!isExtractingDoc && (
                <button
                  className="doc-preview-remove"
                  onClick={() => removeDocument(index)}
                  aria-label={docs.length > 1 ? `Remove ${doc.name}` : "Remove attached document"}
                  title="Remove document"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {pending.map((job) => (
            <div className="doc-preview" role="status" key={`pending-${job.id}`}>
              <span className="doc-preview-icon">{getDocIcon(job.name)}</span>
              <div className="doc-preview-info">
                <span className="doc-preview-name">{job.name}</span>
                <span className="doc-preview-hint">⏳ {job.note}</span>
              </div>
            </div>
          ))}
          {docs.length > 1 && pending.length === 0 && (
            <div className="doc-preview-sources">
              {docs.length} sources · the answer cites the passages it uses
            </div>
          )}
        </div>
      )}

      {/* ── Camera Viewfinder (Phase 5.5) ── */}
      {cameraActive && (
        <div className="vision-camera" role="dialog" aria-label="Camera viewfinder">
          <video ref={videoRef} className="vision-camera-video" autoPlay playsInline muted />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <div className="vision-camera-controls">
            <button className="vision-camera-capture" onClick={captureFrame} title="Capture photo" aria-label="Capture photo">
              📸 Capture
            </button>
            <button className="vision-camera-cancel" onClick={stopCamera} title="Cancel" aria-label="Cancel camera">
              ✕ Cancel
            </button>
          </div>
        </div>
      )}

      {/* Hidden file input for image selection */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleImageFileSelect}
      />

      {/* Hidden file input for document selection */}
      <input
        ref={docFileInputRef}
        type="file"
        accept=".pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.csv,.tsv,.json,.rtf,.log,.ini,.pfl,.conf,.cfg,.yaml,.yml,.xml,.sql,.wav,.mp3,.m4a,.flac,.ogg,.aac,.webm,.aiff,.aif,.opus"
        multiple
        style={{ display: "none" }}
        onChange={handleDocFileSelect}
      />

      <div className="intent-input-wrapper">
        <textarea
          ref={textareaRef}
          className="intent-input"
          aria-label="Express your intent"
          placeholder={
            voice.isListening
              ? "🎙️ Listening…"
              : "Ask anything, or attach a file with +"
          }
          value={voice.isListening && voice.interimTranscript ? voice.interimTranscript : input}
          onChange={(e) => {
            setInput(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isProcessing || voice.isListening}
        />

        {/* Voice input button */}
        {voiceEnabled && voice.sttSupported && (
          <button
            className={`intent-voice-btn ${voice.isListening ? "voice-active" : ""}`}
            onClick={voice.toggleListening}
            disabled={isProcessing}
            title={voice.isListening ? "Stop listening" : "Voice input"}
            type="button"
          >
            {voice.isListening ? (
              <span className="voice-pulse">⏹</span>
            ) : (
              "🎙️"
            )}
          </button>
        )}

        {/* ── Unified Attach Button (+) with popup menu ── */}
        <div className="intent-attach-container" ref={attachMenuRef}>
          <button
            className={`intent-attach-btn ${attachMenuOpen ? "attach-active" : ""}`}
            onClick={() => setAttachMenuOpen((v) => !v)}
            disabled={isProcessing}
            title="Attach file, image, or capture photo"
            aria-label="Attach"
            aria-expanded={attachMenuOpen}
            type="button"
          >
            <span className={`attach-icon ${attachMenuOpen ? "attach-icon-rotated" : ""}`}>+</span>
          </button>

          {attachMenuOpen && (
            <div className="intent-attach-menu" role="menu" aria-label="Attachment options">
              {onScreenRead && (
                <button
                  className="attach-menu-item attach-menu-screen"
                  role="menuitem"
                  onClick={async () => {
                    setAttachMenuOpen(false);
                    setIsReadingScreen(true);
                    try {
                      await onScreenRead(input.trim() || undefined);
                    } finally {
                      setIsReadingScreen(false);
                    }
                  }}
                  disabled={isProcessing || isReadingScreen}
                >
                  <span className="attach-menu-icon">🖥️</span>
                  <div className="attach-menu-label">
                    <span className="attach-menu-title">Read Screen</span>
                    <span className="attach-menu-hint">AI sees what you see — 100% local</span>
                  </div>
                </button>
              )}
              <button
                className="attach-menu-item"
                role="menuitem"
                onClick={() => { docFileInputRef.current?.click(); setAttachMenuOpen(false); }}
                disabled={isExtractingDoc}
              >
                <span className="attach-menu-icon">📄</span>
                <div className="attach-menu-label">
                  <span className="attach-menu-title">Document</span>
                  <span className="attach-menu-hint">PDF, DOCX, XLSX, CSV, logs · pick several to compare</span>
                </div>
              </button>
              <button
                className="attach-menu-item"
                role="menuitem"
                onClick={() => { docFileInputRef.current?.click(); setAttachMenuOpen(false); }}
                disabled={isExtractingDoc}
              >
                <span className="attach-menu-icon">🎙️</span>
                <div className="attach-menu-label">
                  <span className="attach-menu-title">Audio recording</span>
                  <span className="attach-menu-hint">Voice memo or meeting — transcribed offline</span>
                </div>
              </button>
              <button
                className="attach-menu-item"
                role="menuitem"
                onClick={() => { fileInputRef.current?.click(); setAttachMenuOpen(false); }}
              >
                <span className="attach-menu-icon">🖼️</span>
                <div className="attach-menu-label">
                  <span className="attach-menu-title">Image</span>
                  <span className="attach-menu-hint">JPG, PNG, WebP, GIF</span>
                </div>
              </button>
              <button
                className="attach-menu-item"
                role="menuitem"
                onClick={() => { cameraActive ? stopCamera() : startCamera(); setAttachMenuOpen(false); }}
              >
                <span className="attach-menu-icon">📷</span>
                <div className="attach-menu-label">
                  <span className="attach-menu-title">Camera</span>
                  <span className="attach-menu-hint">Capture a live photo</span>
                </div>
              </button>
              <div className="attach-menu-footer">Max {MAX_FILE_SIZE_LABEL} per file</div>
            </div>
          )}
        </div>

        <button
          className="intent-send-btn"
          onClick={handleSubmit}
          disabled={(!input.trim() && !attachedImage && !attachedDocument) || isProcessing || isExtractingDoc}
          title="Send intent"
          aria-label="Send intent"
        >
          ▶
        </button>
      </div>

      {/* Screen reading indicator */}
      {isReadingScreen && (
        <div className="screen-reading-bar" role="status" aria-live="polite">
          <span className="screen-reading-pulse">🖥️</span>
          <span className="screen-reading-text">Reading your screen... analyzing with local vision model</span>
        </div>
      )}

      {/* Voice listening indicator */}
      {voice.isListening && (
        <div className="voice-listening-bar" role="status" aria-live="polite">
          <span className="voice-listening-dot" />
          <span className="voice-listening-text">Listening...</span>
          {voice.interimTranscript && (
            <span className="voice-interim">"{voice.interimTranscript}"</span>
          )}
        </div>
      )}

      <div className="intent-hint">
        <span className="intent-hint-keys">Enter ↵ send · Shift+Enter ↵ newline</span>
        <span className="intent-hint-sep">·</span>
        <span>📎 Attach files (max {MAX_FILE_SIZE_LABEL}) · 🎙️ Voice · 100% local</span>
      </div>
    </div>
  );
}
