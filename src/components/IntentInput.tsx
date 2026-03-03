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

/** Check if a filename is an image */
function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

interface IntentInputProps {
  onSubmit: (input: string, imageData?: string) => void;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    if ((!trimmed && !attachedImage) || isProcessing) return;
    const prompt = trimmed || "Describe this image in detail.";
    onSubmit(prompt, attachedImage ?? undefined);
    setInput("");
    clearAttachedImage();
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

  /** Handle image file selection via hidden file input */
  function handleImageFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && isImageFile(file.name)) {
      attachImageFromFile(file);
    }
    // Reset input so the same file can be selected again
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

    // ── Text files → extract content (existing behavior) ──
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
          <span className="drag-overlay-text">Drop file or image to ingest</span>
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

        {/* Image upload button (Phase 5.5 — Local Vision) */}
        <button
          className="intent-vision-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
          title="Attach image for vision analysis"
          aria-label="Attach image"
          type="button"
        >
          🖼️
        </button>

        {/* Camera capture button (Phase 5.5 — Local Vision) */}
        <button
          className="intent-vision-btn"
          onClick={cameraActive ? stopCamera : startCamera}
          disabled={isProcessing}
          title={cameraActive ? "Close camera" : "Take photo for vision analysis"}
          aria-label={cameraActive ? "Close camera" : "Capture photo"}
          type="button"
        >
          {cameraActive ? "✕" : "📷"}
        </button>

        <button
          className="intent-send-btn"
          onClick={handleSubmit}
          disabled={(!input.trim() && !attachedImage) || isProcessing}
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
        <span>📷 Vision · 🎙️ Voice · 100% local · Patent Pending</span>
      </div>
    </div>
  );
}
