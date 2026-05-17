// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// BrainWrapped — Animated, shareable story of how the user thinks.
//
// THE INNOVATION: Spotify Wrapped, but for your mind. Generated entirely
// from local cognitive data (Cognitive Imprint, Drift, Currents, Prophecies).
// Every slide is shareable as a PNG card with the unique Cognitive Fingerprint.

import { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import type { BrainSnapshot } from "../types";
import "./BrainWrapped.css";

interface BrainWrappedProps {
  onClose: () => void;
}

const SLIDE_DURATION_MS = 6500;

export default function BrainWrapped({ onClose }: BrainWrappedProps) {
  const [snapshot, setSnapshot] = useState<BrainSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const totalSlides = 7;

  // ─── Load snapshot on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    invoke<string>("generate_brain_snapshot")
      .then((json) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(json) as BrainSnapshot;
          setSnapshot(data);
        } catch (e) {
          setError(`Failed to parse snapshot: ${e}`);
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Auto-advance slides ─────────────────────────────────────────────────
  useEffect(() => {
    if (!snapshot || paused) return;
    const t = setTimeout(() => {
      setSlideIndex((i) => (i + 1 < totalSlides ? i + 1 : i));
    }, SLIDE_DURATION_MS);
    return () => clearTimeout(t);
  }, [snapshot, slideIndex, paused]);

  // ─── Keyboard controls ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " ")
        setSlideIndex((i) => Math.min(totalSlides - 1, i + 1));
      else if (e.key === "ArrowLeft")
        setSlideIndex((i) => Math.max(0, i - 1));
      else if (e.key.toLowerCase() === "p") setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ─── Export current slide as PNG ─────────────────────────────────────────
  const exportPng = useCallback(async () => {
    if (!cardRef.current) return;
    try {
      // Dynamic import to keep main bundle slim
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `prismos-brain-wrapped-slide-${slideIndex + 1}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      console.error("Export failed:", e);
      alert("Export needs the html2canvas package. Run: npm install html2canvas");
    }
  }, [slideIndex]);

  // ─── Copy fingerprint hash to clipboard ──────────────────────────────────
  const copyFingerprint = useCallback(async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(
        `My PrismOS Cognitive Fingerprint: ${snapshot.fingerprint.hash} (${snapshot.fingerprint.archetype})`
      );
    } catch (e) {
      console.error(e);
    }
  }, [snapshot]);

  // ─── Build the full 7-slide poster + share / download ────────────────────
  // This is the viral loop: one tall PNG that captures the whole Wrapped,
  // ready to drop into Twitter / Bluesky / Discord without a screenshot tool.
  //
  // Implementation note: we render the poster into a detached DOM subtree via
  // createRoot, capture it with html2canvas, then tear it down. This keeps the
  // hidden DOM out of the user-facing component tree (so existing tests don't
  // see duplicate "This is your mind." text) and avoids any layout flicker.
  const shareWrapped = useCallback(async () => {
    if (!snapshot || sharing) return;
    setSharing(true);
    setShareStatus("Rendering your Wrapped…");

    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    container.dataset.prismosPoster = "true";
    container.style.cssText =
      "position:fixed;left:-10000px;top:0;width:720px;pointer-events:none;opacity:0;z-index:-1";
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      // Render every slide into the detached container.
      root.render(
        <div>
          {Array.from({ length: totalSlides }).map((_, i) => (
            <div
              key={i}
              className="bw-poster-slide"
              style={{
                width: 720,
                minHeight: 720,
                padding: 32,
                background: "#0a0a14",
                color: "#ffffff",
                boxSizing: "border-box",
                fontFamily: "inherit",
                position: "relative",
              }}
            >
              {renderSlide(i, snapshot)}
              <div className="bw-watermark" style={{ marginTop: 24 }}>
                <span className="bw-watermark-mark">◆ PrismOS-AI</span>
                <span className="bw-watermark-tag">prismos.ai · local · private</span>
              </div>
            </div>
          ))}
        </div>
      );

      // Wait two frames so React commits + the browser paints the subtree.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      const { default: html2canvas } = await import("html2canvas");
      const slideNodes = Array.from(
        container.querySelectorAll<HTMLElement>(".bw-poster-slide")
      );
      if (slideNodes.length === 0) throw new Error("no slides to render");

      // Render each slide to its own canvas, then stitch them top-to-bottom.
      // Serial to keep peak memory low on weaker laptops.
      const slideCanvases: HTMLCanvasElement[] = [];
      for (let i = 0; i < slideNodes.length; i++) {
        setShareStatus(`Rendering slide ${i + 1} of ${slideNodes.length}…`);
        // eslint-disable-next-line no-await-in-loop
        const c = await html2canvas(slideNodes[i], {
          backgroundColor: "#0a0a14",
          scale: 2,
          logging: false,
          useCORS: true,
        });
        slideCanvases.push(c);
      }

      const width = Math.max(...slideCanvases.map((c) => c.width));
      const totalHeight = slideCanvases.reduce((sum, c) => sum + c.height, 0);
      const composite = document.createElement("canvas");
      composite.width = width;
      composite.height = totalHeight;
      const ctx = composite.getContext("2d");
      if (!ctx) throw new Error("canvas 2d context unavailable");
      ctx.fillStyle = "#0a0a14";
      ctx.fillRect(0, 0, width, totalHeight);
      let y = 0;
      for (const c of slideCanvases) {
        const x = Math.floor((width - c.width) / 2);
        ctx.drawImage(c, x, y);
        y += c.height;
      }

      const blob: Blob = await new Promise((resolve, reject) => {
        composite.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
          "image/png"
        );
      });

      const filename = `prismos-brain-wrapped-${snapshot.fingerprint.hash.slice(0, 8)}.png`;
      const shareText = `My cognitive fingerprint is ${snapshot.fingerprint.hash.slice(0, 12)}… — I'm ${snapshot.fingerprint.archetype} in @PrismOS_AI 🧠✨\n\n100% local. 0 bytes left my device.`;

      // Best path: native share sheet with the image attached.
      const file = new File([blob], filename, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (d: ShareData) => boolean;
        share?: (d: ShareData) => Promise<void>;
      };
      const canShareFile =
        typeof nav.canShare === "function" && nav.canShare({ files: [file] });

      if (canShareFile && typeof nav.share === "function") {
        try {
          await nav.share({ files: [file], text: shareText, title: "My PrismOS Brain Wrapped" });
          setShareStatus("Shared ✓");
          setTimeout(() => setShareStatus(null), 2500);
          return;
        } catch (err) {
          if ((err as DOMException)?.name === "AbortError") {
            setShareStatus(null);
            return;
          }
          // Other errors → fall through to download fallback.
        }
      }

      // Fallback: download the image, copy the share text, then open Twitter
      // with the text pre-filled. The user attaches the just-downloaded image.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = filename;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      try {
        await navigator.clipboard.writeText(shareText);
      } catch {
        /* clipboard unavailable — non-fatal */
      }

      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,
        "_blank"
      );
      setShareStatus("Image saved — drag it into your post ✓");
      setTimeout(() => setShareStatus(null), 4500);
    } catch (e) {
      console.error("Share failed:", e);
      setShareStatus(
        `Couldn't build poster: ${e instanceof Error ? e.message : String(e)}`
      );
      setTimeout(() => setShareStatus(null), 4500);
    } finally {
      // Tear down the detached subtree on a microtask so React can finish any
      // pending work that the render kicked off.
      queueMicrotask(() => {
        try {
          root.unmount();
        } catch {
          /* already unmounted */
        }
        container.remove();
      });
      setSharing(false);
    }
  }, [snapshot, sharing]);

  // ─── Render states ───────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="bw-overlay" onClick={onClose}>
        <div className="bw-error">
          <h2>Couldn't generate your Wrapped</h2>
          <p>{error}</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="bw-overlay">
        <div className="bw-loading">
          <div className="bw-prism-pulse" />
          <p>Refracting your mind into a story…</p>
        </div>
      </div>
    );
  }

  const progress = ((slideIndex + 1) / totalSlides) * 100;

  return (
    <div className="bw-overlay" role="dialog" aria-label="Brain Wrapped">
      {/* Top bar: progress dots + controls */}
      <div className="bw-topbar">
        <div className="bw-progress-dots">
          {Array.from({ length: totalSlides }).map((_, i) => (
            <button
              key={i}
              className={`bw-dot ${i === slideIndex ? "active" : ""} ${i < slideIndex ? "done" : ""}`}
              onClick={() => setSlideIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
        <div className="bw-controls">
          <button
            className="bw-icon-btn"
            onClick={() => setPaused((p) => !p)}
            title={paused ? "Resume (P)" : "Pause (P)"}
          >
            {paused ? "▶" : "❚❚"}
          </button>
          <button className="bw-icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
      </div>

      {/* Slide stage */}
      <AnimatePresence mode="wait">
        <motion.div
          key={slideIndex}
          ref={cardRef}
          className="bw-card"
          initial={{ opacity: 0, scale: 0.96, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: -10 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          {renderSlide(slideIndex, snapshot)}

          {/* Watermark */}
          <div className="bw-watermark">
            <span className="bw-watermark-mark">◆ PrismOS-AI</span>
            <span className="bw-watermark-tag">prismos.ai · local · private</span>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Bottom bar: actions */}
      <div className="bw-actionbar">
        <button className="bw-action" onClick={exportPng} disabled={sharing}>
          📥 Save Slide
        </button>
        <button className="bw-action" onClick={copyFingerprint} disabled={sharing}>
          🔗 Copy Fingerprint
        </button>
        <button
          className="bw-action bw-action-share"
          onClick={shareWrapped}
          disabled={sharing}
          title="Build a single tall image of all 7 slides and share it"
        >
          {sharing ? "…" : "🪐 Share My Wrapped"}
        </button>
      </div>

      {shareStatus && (
        <div className="bw-share-toast" role="status" aria-live="polite">
          {shareStatus}
        </div>
      )}

      {/* Animated progress bar */}
      <div className="bw-bottom-progress">
        <div className="bw-bottom-progress-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SLIDE RENDERERS
// ═══════════════════════════════════════════════════════════════════════════

function renderSlide(idx: number, s: BrainSnapshot): React.ReactNode {
  switch (idx) {
    case 0:
      return <SlideFingerprint snapshot={s} />;
    case 1:
      return <SlideArchetype snapshot={s} />;
    case 2:
      return <SlideAxes snapshot={s} />;
    case 3:
      return <SlideEvolution snapshot={s} />;
    case 4:
      return <SlideCurrents snapshot={s} />;
    case 5:
      return <SlideProphecies snapshot={s} />;
    case 6:
      return <SlideStats snapshot={s} />;
    default:
      return null;
  }
}

function SlideFingerprint({ snapshot }: { snapshot: BrainSnapshot }) {
  const fp = snapshot.fingerprint;
  const pathD =
    fp.shape_points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`)
      .join(" ") + " Z";

  return (
    <div className="bw-slide bw-slide-fingerprint">
      <div className="bw-slide-tag">SLIDE 1 · YOUR COGNITIVE FINGERPRINT</div>
      <h1 className="bw-slide-title">This is your mind.</h1>
      <p className="bw-slide-sub">
        Computed from how you think, not what you said. Mathematically unique to you.
      </p>

      <div className="bw-fingerprint-stage">
        <svg
          viewBox="0 0 100 100"
          className="bw-fingerprint-svg"
          style={{
            transform: `rotate(${fp.rotation.toFixed(3)}rad)`,
          }}
        >
          <defs>
            <linearGradient id="bw-fp-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              {fp.palette.map((color, i) => (
                <stop
                  key={i}
                  offset={`${(i / (fp.palette.length - 1)) * 100}%`}
                  stopColor={color}
                />
              ))}
            </linearGradient>
            <filter id="bw-fp-glow">
              <feGaussianBlur stdDeviation="2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Inner concentric guide rings */}
          {[35, 25, 15].map((r) => (
            <circle
              key={r}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="0.3"
            />
          ))}

          {/* Vertex dots */}
          {fp.shape_points.map((p, i) => (
            <circle
              key={i}
              cx={p[0]}
              cy={p[1]}
              r="1.8"
              fill={fp.palette[i]}
              filter="url(#bw-fp-glow)"
            />
          ))}

          {/* Main shape */}
          <path
            d={pathD}
            fill="url(#bw-fp-grad)"
            opacity="0.55"
            stroke="url(#bw-fp-grad)"
            strokeWidth="0.6"
            filter="url(#bw-fp-glow)"
          />
        </svg>
      </div>

      <div className="bw-fingerprint-hash">
        <span className="bw-hash-label">FINGERPRINT</span>
        <span className="bw-hash-value">{fp.hash}</span>
      </div>
    </div>
  );
}

function SlideArchetype({ snapshot }: { snapshot: BrainSnapshot }) {
  const fp = snapshot.fingerprint;
  return (
    <div className="bw-slide bw-slide-archetype">
      <div className="bw-slide-tag">SLIDE 2 · YOUR ARCHETYPE</div>
      <p className="bw-slide-sub">PrismOS classified your thinking as…</p>
      <h1 className="bw-archetype-name" style={{ color: fp.palette[1] }}>
        {fp.archetype}
      </h1>
      <p className="bw-archetype-tagline">{fp.archetype_tagline}</p>
      <div className="bw-archetype-rosette">
        {fp.palette.map((c, i) => (
          <div key={i} className="bw-rosette-petal" style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

function SlideAxes({ snapshot }: { snapshot: BrainSnapshot }) {
  const axes = [
    { key: "depth", label: "Depth", value: snapshot.profile.depth, tier: snapshot.axis_labels.depth },
    { key: "creativity", label: "Creativity", value: snapshot.profile.creativity, tier: snapshot.axis_labels.creativity },
    { key: "formality", label: "Formality", value: snapshot.profile.formality, tier: snapshot.axis_labels.formality },
    { key: "technical", label: "Technical", value: snapshot.profile.technical_level, tier: snapshot.axis_labels.technical_level },
    { key: "examples", label: "Examples", value: snapshot.profile.example_preference, tier: snapshot.axis_labels.example_preference },
  ];
  return (
    <div className="bw-slide bw-slide-axes">
      <div className="bw-slide-tag">SLIDE 3 · YOUR FIVE DIMENSIONS</div>
      <h2 className="bw-slide-title">How your mind tunes itself.</h2>
      <div className="bw-axes-list">
        {axes.map((a, i) => (
          <motion.div
            key={a.key}
            className="bw-axis-row"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 * i, duration: 0.5 }}
          >
            <div className="bw-axis-head">
              <span className="bw-axis-label">{a.label}</span>
              <span className="bw-axis-tier">{a.tier}</span>
            </div>
            <div className="bw-axis-bar">
              <motion.div
                className="bw-axis-fill"
                initial={{ width: 0 }}
                animate={{ width: `${a.value * 100}%` }}
                transition={{ delay: 0.15 * i + 0.2, duration: 0.8, ease: "easeOut" }}
                style={{ background: snapshot.fingerprint.palette[i] }}
              />
            </div>
            <span className="bw-axis-pct">{Math.round(a.value * 100)}%</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SlideEvolution({ snapshot }: { snapshot: BrainSnapshot }) {
  return (
    <div className="bw-slide bw-slide-evolution">
      <div className="bw-slide-tag">SLIDE 4 · HOW YOU'VE CHANGED</div>
      <h2 className="bw-slide-title">Your mind is moving.</h2>
      <p className="bw-evolution-text">{snapshot.evolution_summary}</p>
      {snapshot.drift && (
        <div className="bw-deltas">
          {Object.entries(snapshot.drift.deltas).map(([k, v]) => {
            const pct = Math.round((v as number) * 100);
            const isUp = pct > 0;
            const isFlat = Math.abs(pct) < 1;
            return (
              <div key={k} className="bw-delta-chip">
                <span className="bw-delta-axis">{k.replace("_", " ")}</span>
                <span className={`bw-delta-arrow ${isFlat ? "flat" : isUp ? "up" : "down"}`}>
                  {isFlat ? "—" : isUp ? "▲" : "▼"} {Math.abs(pct)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SlideCurrents({ snapshot }: { snapshot: BrainSnapshot }) {
  return (
    <div className="bw-slide bw-slide-currents">
      <div className="bw-slide-tag">SLIDE 5 · YOUR THOUGHT CURRENTS</div>
      <h2 className="bw-slide-title">What kept pulling at you.</h2>
      {snapshot.top_currents.length === 0 ? (
        <p className="bw-empty">No recurring patterns yet — keep chatting to find your currents.</p>
      ) : (
        <div className="bw-currents-list">
          {snapshot.top_currents.map((c, i) => (
            <motion.div
              key={i}
              className="bw-current-row"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 * i, duration: 0.5 }}
            >
              <span className={`bw-current-momentum bw-momentum-${c.momentum}`}>
                {c.momentum === "rising" ? "↗" : c.momentum === "fading" ? "↘" : "→"}
              </span>
              <span className="bw-current-theme">{c.theme}</span>
              <span className="bw-current-freq">×{c.frequency}</span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function SlideProphecies({ snapshot }: { snapshot: BrainSnapshot }) {
  return (
    <div className="bw-slide bw-slide-prophecies">
      <div className="bw-slide-tag">SLIDE 6 · EDGE PROPHECY</div>
      <h2 className="bw-slide-title">Connections waiting to happen.</h2>
      <p className="bw-evolution-text">
        PrismOS predicts <strong>{snapshot.prophecy_count}</strong> new links your mind hasn't drawn yet.
      </p>
      {snapshot.top_prophecies.length > 0 && (
        <div className="bw-prophecy-list">
          {snapshot.top_prophecies.map((p, i) => (
            <motion.div
              key={i}
              className="bw-prophecy-row"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 * i, duration: 0.5 }}
            >
              <span className="bw-prophecy-node">{p.source_label}</span>
              <span className="bw-prophecy-arrow">⟿</span>
              <span className="bw-prophecy-node">{p.target_label}</span>
              <span className="bw-prophecy-prob">{Math.round(p.probability * 100)}%</span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function SlideStats({ snapshot }: { snapshot: BrainSnapshot }) {
  const s = snapshot.stats;
  return (
    <div className="bw-slide bw-slide-stats">
      <div className="bw-slide-tag">SLIDE 7 · YOUR YEAR IN THINKING</div>
      <h2 className="bw-slide-title">By the numbers.</h2>
      <div className="bw-stats-grid">
        <Stat label="Intents" value={s.total_intents} />
        <Stat label="Knowledge Nodes" value={s.total_nodes} />
        <Stat label="Connections" value={s.total_edges} />
        <Stat label="Active Days" value={s.days_active} />
        <Stat label="Interactions" value={s.interactions} />
        <Stat label="Archetype" value={snapshot.fingerprint.archetype} small />
      </div>
      <p className="bw-final-tag">"{snapshot.fingerprint.archetype_tagline}"</p>
      <p className="bw-final-cta">
        100% generated locally · 0 bytes left your device
      </p>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: number | string; small?: boolean }) {
  return (
    <div className={`bw-stat ${small ? "bw-stat-small" : ""}`}>
      <div className="bw-stat-value">{value}</div>
      <div className="bw-stat-label">{label}</div>
    </div>
  );
}
