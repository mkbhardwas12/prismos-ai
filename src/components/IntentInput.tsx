// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Intent Input — Natural Language Input with Voice + Vision Support
//
// Supports typed, voice, image drag-drop, and camera capture input.
// All processing stays local — no data leaves your device.
// Vision powered by local multimodal models (llava, llama3.2-vision).

import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type DragEvent, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVoice } from "../hooks/useVoice";
import "./IntentInput.css";

/** Image extensions we accept for vision analysis */
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif"];

/** Document extensions we accept for text extraction & analysis */
const DOCUMENT_EXTENSIONS = ["pdf", "docx", "pptx", "xlsx", "xls", "txt", "md", "csv", "json", "rtf"];

/** Maximum file size in bytes (25 MB) — keeps memory & performance safe */
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_FILE_SIZE_LABEL = "25 MB";

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
    default: return "📄";
  }
}

interface IntentInputProps {
  onSubmit: (input: string, imageData?: string, documentText?: string) => void;
  isProcessing: boolean;
  voiceEnabled?: boolean;
  pendingIntent?: string;
  onPendingConsumed?: () => void;
}

export default function IntentInput({
  onSubmit,
  isProcessing,
  voiceEnabled = true,
  pendingIntent,
  onPendingConsumed,
}: IntentInputProps) {
  const [input, setInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [droppedFileName, setDroppedFileName] = useState<string | null>(null);
  // ── Vision state (Phase 5.5) ──
  const [attachedImage, setAttachedImage] = useState<string | null>(null); // base64
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null); // data URL for preview
  const [imageName, setImageName] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  // ── Document state (Phase 5.5) ──
  const [attachedDocument, setAttachedDocument] = useState<string | null>(null); // extracted text
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [documentMeta, setDocumentMeta] = useState<string | null>(null); // e.g. "PDF | 5 pages"
  const [isExtractingDoc, setIsExtractingDoc] = useState(false);
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
    if ((!trimmed && !attachedImage && !attachedDocument) || isProcessing) return;
    const prompt = trimmed || (attachedImage ? "Describe this image in detail." : "Summarize this document.");
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

  /** Clear attached document state */
  function clearAttachedDocument() {
    setAttachedDocument(null);
    setDocumentName(null);
    setDocumentMeta(null);
  }

  /** Attach a document by extracting its text via Rust backend */
  async function attachDocumentFromPath(filePath: string, fileName: string) {
    setIsExtractingDoc(true);
    setDocumentName(fileName);
    setDocumentMeta("Extracting...");
    try {
      const text: string = await invoke("extract_file_text", { path: filePath });
      setAttachedDocument(text);
      // Parse metadata from the header line [Document: ... | Type: ... | ...]
      const metaMatch = text.match(/\[Document:.*?\|(.+?)\]/);
      setDocumentMeta(metaMatch ? metaMatch[1].trim() : `${fileName.split('.').pop()?.toUpperCase()} document`);
    } catch (err) {
      console.error("Document extraction error:", err);
      setDocumentMeta(null);
      setDocumentName(null);
      setAttachedDocument(null);
      // Show error in input as fallback
      setInput((prev) => prev + `\n⚠️ Could not extract text from ${fileName}: ${err}`);
    } finally {
      setIsExtractingDoc(false);
    }
  }

  /** Attach a document from a File object — sends binary files to Rust for proper extraction */
  async function attachDocumentFromFile(file: File) {
    setIsExtractingDoc(true);
    setDocumentName(file.name);
    setDocumentMeta("Extracting...");
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || "";
      const binaryFormats = ["pdf", "docx", "pptx", "xlsx", "xls"];

      if (binaryFormats.includes(ext)) {
        // Binary formats (PDF/DOCX/PPTX/XLSX): read as ArrayBuffer → base64 → send to Rust
        const arrayBuffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        // Convert to base64 in chunks to avoid call stack overflow on large files
        let binary = "";
        const chunkSize = 32768;
        for (let i = 0; i < uint8.length; i += chunkSize) {
          binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);
        const text: string = await invoke("extract_document_from_bytes", {
          data: base64,
          fileName: file.name,
        });
        setAttachedDocument(text);
        const metaMatch = text.match(/\[Document:.*?\|(.+?)\]/);
        setDocumentMeta(metaMatch ? metaMatch[1].trim() : `${ext.toUpperCase()} document`);
      } else {
        // Text formats: read as UTF-8 text directly
        const text = await file.text();
        const prefixed = `[File: ${file.name}]\n${text}`;
        setAttachedDocument(prefixed);
        setDocumentMeta(`${ext.toUpperCase()} | ${Math.round(text.length / 1024)}KB`);
      }
    } catch (err) {
      console.error("Document extraction error:", err);
      clearAttachedDocument();
      setInput((prev) => prev + `\n⚠️ Could not extract text from ${file.name}: ${err}`);
    } finally {
      setIsExtractingDoc(false);
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

  /** Handle document file selection via hidden file input */
  async function handleDocFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!checkFileSize(file)) { e.target.value = ""; return; }
    const filePath = (file as File & { path?: string }).path;
    if (filePath) {
      await attachDocumentFromPath(filePath, file.name);
    } else {
      await attachDocumentFromFile(file);
    }
    if (!input.trim()) {
      setInput("Summarize this document.");
    }
    e.target.value = "";
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

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const fileName = file.name;

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
      if (!input.trim()) {
        setInput("Describe this image in detail.");
      }
      return;
    }

    // ── Document files → attach for analysis (Phase 5.5) ──
    if (isDocumentFile(fileName)) {
      const filePath = (file as File & { path?: string }).path;
      if (filePath) {
        await attachDocumentFromPath(filePath, fileName);
      } else {
        await attachDocumentFromFile(file);
      }
      if (!input.trim()) {
        setInput("Summarize this document.");
      }
      return;
    }

    // ── Other text files → extract content inline (existing behavior) ──
    setDroppedFileName(fileName);

    try {
      const filePath = (file as File & { path?: string }).path;

      if (filePath) {
        const text: string = await invoke("extract_file_text", { path: filePath });
        const currentInput = input.trim();
        const newInput = currentInput
          ? `${currentInput}\n\n${text}`
          : text;
        setInput(newInput);
        autoResize();
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          const prefixed = `[File: ${fileName}]\n${text}`;
          const currentInput = input.trim();
          const newInput = currentInput
            ? `${currentInput}\n\n${prefixed}`
            : prefixed;
          setInput(newInput);
          autoResize();
        };
        reader.readAsText(file);
      }
    } catch (err) {
      console.error("File drop error:", err);
      setDroppedFileName(null);
    }

    setTimeout(() => setDroppedFileName(null), 4000);
  }, [input]);

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
      {documentName && (
        <div className="doc-preview" role="status">
          <span className="doc-preview-icon">{getDocIcon(documentName)}</span>
          <div className="doc-preview-info">
            <span className="doc-preview-name">{documentName}</span>
            <span className="doc-preview-hint">
              {isExtractingDoc ? "⏳ Extracting text..." : documentMeta ?? "Ready for analysis"}
            </span>
          </div>
          {!isExtractingDoc && (
            <button
              className="doc-preview-remove"
              onClick={clearAttachedDocument}
              aria-label="Remove attached document"
              title="Remove document"
            >
              ×
            </button>
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
        accept=".pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.csv,.json,.rtf"
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
              ? "🎙️ Listening… speak your intent"
              : "Ask me anything — I'll process it privately on your device…"
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
              <button
                className="attach-menu-item"
                role="menuitem"
                onClick={() => { docFileInputRef.current?.click(); setAttachMenuOpen(false); }}
                disabled={isExtractingDoc}
              >
                <span className="attach-menu-icon">📄</span>
                <div className="attach-menu-label">
                  <span className="attach-menu-title">Document</span>
                  <span className="attach-menu-hint">PDF, DOCX, PPTX, XLSX</span>
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
          disabled={(!input.trim() && !attachedImage && !attachedDocument) || isProcessing}
          title="Send intent"
          aria-label="Send intent"
        >
          ▶
        </button>
      </div>

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
        <span>📎 Attach files (max {MAX_FILE_SIZE_LABEL}) · 🎙️ Voice · 100% local · Patent Pending</span>
      </div>
    </div>
  );
}
