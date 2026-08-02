// PrismOS-AI User Guide — In-app help & onboarding

import { useState, useCallback } from "react";
import "./UserGuide.css";

interface UserGuideProps {
  open: boolean;
  onClose: () => void;
}

type GuideSection = "getting-started" | "features" | "tips" | "keyboard" | "faq" | "about";

export default function UserGuide({ open, onClose }: UserGuideProps) {
  const [activeSection, setActiveSection] = useState<GuideSection>("getting-started");

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="guide-overlay" onClick={handleBackdropClick}>
      <div className="guide-panel" role="dialog" aria-label="User Guide" aria-modal="true">
        {/* Header */}
        <div className="guide-header">
          <div className="guide-header-title">
            <span className="guide-header-icon">📖</span>
            <h2>PrismOS-AI User Guide</h2>
          </div>
          <button className="guide-close-btn" onClick={onClose} aria-label="Close guide">✕</button>
        </div>

        <div className="guide-body">
          {/* Sidebar Nav */}
          <nav className="guide-nav" aria-label="Guide sections">
            {([
              { id: "getting-started", icon: "🚀", label: "Getting Started" },
              { id: "features", icon: "✨", label: "Features" },
              { id: "tips", icon: "💡", label: "Tips & Best Practices" },
              { id: "keyboard", icon: "⌨️", label: "Keyboard Shortcuts" },
              { id: "faq", icon: "❓", label: "FAQ" },
              { id: "about", icon: "⚖️", label: "About & Legal" },
            ] as { id: GuideSection; icon: string; label: string }[]).map(s => (
              <button
                key={s.id}
                className={`guide-nav-item ${activeSection === s.id ? "active" : ""}`}
                onClick={() => setActiveSection(s.id)}
              >
                <span className="guide-nav-icon">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="guide-content">
            {activeSection === "getting-started" && (
              <div className="guide-section">
                <h3>🚀 Getting Started</h3>
                <p>PrismOS-AI is a <strong>local-first desktop assistant with bounded sequential workflows</strong>. Private chat, document, and attached-image inference use the fixed-loopback Ollama client route. The configurable Ollama URL and <code>PRISMOS_ALLOW_REMOTE_OLLAMA</code> apply only to model management/status; they never reroute private prompts. Screen capture is unavailable in this source build. No platform release is described as security-qualified unless its exact artifact has completed the release checklist.</p>

                <div className="guide-card highlight">
                  <h4>💻 System Requirements</h4>
                  <table className="guide-table">
                    <thead>
                      <tr><th></th><th>Minimum</th><th>Recommended</th></tr>
                    </thead>
                    <tbody>
                      <tr><td><strong>OS</strong></td><td>Windows 10 / macOS 12 / Linux</td><td>Windows 11 / macOS 14+</td></tr>
                      <tr><td><strong>RAM</strong></td><td>8 GB</td><td>16 GB or more</td></tr>
                      <tr><td><strong>Storage</strong></td><td>10 GB free</td><td>20+ GB free</td></tr>
                      <tr><td><strong>CPU</strong></td><td>4-core (Intel i5 / AMD Ryzen 5)</td><td>8-core (i7 / Ryzen 7)</td></tr>
                      <tr><td><strong>GPU</strong></td><td>Not required</td><td>NVIDIA 6GB+ VRAM (CUDA) for fast inference</td></tr>
                    </tbody>
                  </table>
                  <p style={{ marginTop: "10px", fontSize: "12px" }}>
                    <strong>Model sizes vs RAM:</strong> Small models (2-3B) need ~4 GB RAM. Medium models (7B) need ~8 GB. Large models (13B+) need 16+ GB. 
                    A compatible GPU can improve inference speed, but the gain depends on the model,
                    quantization, backend, memory bandwidth, drivers, and hardware. CPU-only operation is supported.
                  </p>
                </div>

                <div className="guide-card">
                  <h4>Step 1 — Install Ollama</h4>
                  <p>Ollama powers the AI models. Download it free from <strong>ollama.com</strong> and install it. It runs quietly in the background.</p>
                </div>

                <div className="guide-card">
                  <h4>Step 2 — Choose a Model</h4>
                  <p>Click the <strong>model selector</strong> in the top-right header bar (shows "Ollama · model name"). You can:</p>
                  <ul>
                    <li>Switch between installed models instantly</li>
                    <li>Download new models with one click from "Get More Models"</li>
                  </ul>
                </div>

                <div className="guide-card">
                  <h4>Step 3 — Start Chatting</h4>
                  <p>Type any intent in the input bar at the bottom. PrismOS-AI routes it through its <strong>Refractive Core</strong> pipeline and can persist successful conversations in your Spectrum Graph. One-off document attachments are analyzed ephemerally and are not auto-ingested; durable project context requires the separate Project Knowledge preview and approval flow.</p>
                </div>

                <div className="guide-card highlight">
                  <h4>🔒 Your Privacy</h4>
                  <p>Private inference is fixed to <code>http://localhost:11434</code>. A configured remote management URL can list, pull, delete, or check models only when explicitly enabled; it cannot receive chat or attachment prompts. Model downloads and browser-provided speech may use the network. The live SQLite graph is account-private but not encrypted at rest; encrypted export packages protect portable copies.</p>
                </div>
              </div>
            )}

            {activeSection === "features" && (
              <div className="guide-section">
                <h3>✨ Features</h3>

                <div className="guide-card">
                  <h4>💬 Intent Console</h4>
                  <p>Your main conversation view. Type natural language intents and PrismOS-AI routes them through its bounded sequential workflow. Successful conversations and explicit feedback can improve future retrieval; this is graph memory, not autonomous model retraining.</p>
                </div>

                <div className="guide-card">
                  <h4>🕸️ Spectrum Graph</h4>
                  <p>A visual force-directed graph of your knowledge. Every conversation creates nodes and edges that connect concepts. Watch your knowledge network grow over time.</p>
                </div>

                <div className="guide-card">
                  <h4>🌈 Spectrum Explorer</h4>
                  <p>Browse, search, and manage individual nodes in your knowledge graph. Add new nodes manually, view details, and see how concepts connect.</p>
                </div>

                <div className="guide-card">
                  <h4>🔒 Action Policies</h4>
                  <p>Evaluate supported action descriptions through bounded allow-list, risk, and anomaly checks. This is not an arbitrary code runner; process-local HMAC tags make in-process action records tamper-evident, not hardware-attested.</p>
                </div>

                <div className="guide-card">
                  <h4>📅 Spectral Timeline</h4>
                  <p>View your entire activity history chronologically. Filter by event type, search through past interactions, and track how your knowledge evolved.</p>
                </div>

                <div className="guide-card">
                  <h4>🔄 Encrypted Portability</h4>
                  <p><strong>Export Graph</strong> creates a device-bound package that can be reopened only while the original PrismOS device secret remains available; it is not a cross-device or disaster-recovery backup. <strong>Multi-Device Sync</strong> uses a shared passphrase for cross-device graph preview and merge. Both formats omit approved Project Knowledge excerpts. <strong>Private Vault Backup &amp; Restore</strong> creates a passphrase-encrypted full-database recovery candidate; prove it with a clean-profile restore drill before relying on it.</p>
                </div>

                <div className="guide-card">
                  <h4>🤖 Sequential Reasoning Workflow</h4>
                  <p>PrismOS-AI runs a plan, draft, judge, and refinement loop around the selected model through fixed-loopback inference, with deterministic routing, policy, voting, memory, and trace stages. The activity panel shows that sequential workflow trace.</p>
                </div>

                <div className="guide-card">
                  <h4>🎤 Browser Speech &amp; Text-to-Speech</h4>
                  <p>Browser/WebView speech recognition and text-to-speech may be available depending on the platform and can have provider-specific network behavior. Real bundled Whisper transcription is not available in this release.</p>
                </div>
              </div>
            )}

            {activeSection === "tips" && (
              <div className="guide-section">
                <h3>💡 Tips & Best Practices</h3>

                <div className="guide-card">
                  <h4>Choose the Right Model</h4>
                  <ul>
                    <li><strong>Lower resource use:</strong> Start with a smaller registered model, then measure latency on your hardware</li>
                    <li><strong>Larger models:</strong> Try a model that fits your RAM, then verify answer quality and latency on your own tasks</li>
                    <li><strong>Code tasks:</strong> Try Qwen 2.5 Coder or another installed code-oriented model and verify its output</li>
                    <li><strong>Reasoning:</strong> Use a supported reasoning model for difficult planning and verification; PrismOS shows concise rationale, not hidden chain-of-thought</li>
                  </ul>
                </div>

                <div className="guide-card">
                  <h4>Adjust Response Length</h4>
                  <p>Use the <strong>Max Tokens</strong> slider in the model dropdown to control response length:</p>
                  <ul>
                    <li><strong>512</strong> — Quick, concise answers</li>
                    <li><strong>2048</strong> — Standard responses (default)</li>
                    <li><strong>4096</strong> — Detailed, comprehensive answers</li>
                    <li><strong>8192</strong> — Maximum length for long-form content</li>
                  </ul>
                </div>

                <div className="guide-card">
                  <h4>Be Specific with Intents</h4>
                  <p>The more specific your input, the better the response. Instead of "tell me about Python," try "explain Python list comprehensions with examples."</p>
                </div>

                <div className="guide-card">
                  <h4>Build Your Knowledge Graph</h4>
                  <p>Regular usage can build a richer Spectrum Graph. Visit the Spectrum Explorer to inspect the stored relationships. Additional history may improve retrieval relevance, but it does not retrain the model or guarantee better answers.</p>
                </div>

                <div className="guide-card">
                  <h4>Back Up Your Data</h4>
                  <p>Use <strong>Settings → Private Vault Backup &amp; Restore</strong> to create an encrypted full-database recovery candidate, then complete a clean-profile restore drill before relying on it. <strong>Export Graph</strong> is device-bound, while <strong>Multi-Device Sync</strong> is the passphrase-based cross-device graph format. Keep independent backups and the original project folders so sources can also be recovered independently.</p>
                </div>
              </div>
            )}

            {activeSection === "keyboard" && (
              <div className="guide-section">
                <h3>⌨️ Keyboard Shortcuts</h3>
                <div className="guide-shortcuts">
                  <div className="guide-shortcut-row">
                    <span className="guide-keys"><kbd>Ctrl</kbd> + <kbd>1</kbd></span>
                    <span>Intent Console</span>
                  </div>
                  <div className="guide-shortcut-row">
                    <span className="guide-keys"><kbd>Ctrl</kbd> + <kbd>2</kbd></span>
                    <span>Spectrum Graph</span>
                  </div>
                  <div className="guide-shortcut-row">
                    <span className="guide-keys"><kbd>Ctrl</kbd> + <kbd>3</kbd></span>
                    <span>Spectrum Explorer</span>
                  </div>
                  <div className="guide-shortcut-row">
                    <span className="guide-keys"><kbd>Ctrl</kbd> + <kbd>4</kbd></span>
                    <span>Action Policies</span>
                  </div>
                  <div className="guide-shortcut-row">
                    <span className="guide-keys"><kbd>Ctrl</kbd> + <kbd>5</kbd></span>
                    <span>Spectral Timeline</span>
                  </div>
                  <div className="guide-shortcut-row">
                    <span className="guide-keys"><kbd>Ctrl</kbd> + <kbd>6</kbd></span>
                    <span>Settings</span>
                  </div>
                  <div className="guide-shortcut-row">
                    <span className="guide-keys"><kbd>Enter</kbd></span>
                    <span>Send intent</span>
                  </div>
                  <div className="guide-shortcut-row">
                    <span className="guide-keys"><kbd>Shift</kbd> + <kbd>Enter</kbd></span>
                    <span>New line in input</span>
                  </div>
                </div>
              </div>
            )}

            {activeSection === "faq" && (
              <div className="guide-section">
                <h3>❓ Frequently Asked Questions</h3>

                <div className="guide-card">
                  <h4>Is PrismOS-AI free?</h4>
                  <p>Yes! PrismOS-AI is free to use. It runs open-source AI models locally on your machine through Ollama. No subscriptions, no API keys, no usage limits.</p>
                </div>

                <div className="guide-card">
                  <h4>Does my data go to the cloud?</h4>
                  <p><strong>Private inference is fixed to loopback Ollama.</strong> Model downloads, browser speech services, synthetic flywheel smoke validation, explicit Brain Wrapped sharing, and enabled remote model-management operations can use the network. Full personal-data training is disabled. The configured management URL never receives private prompts. Email, calendar, and finance commands are unavailable in this build until their private configuration and consent boundaries ship.</p>
                </div>

                <div className="guide-card">
                  <h4>Why are responses slow?</h4>
                  <p>Response speed depends on your hardware. Tips to speed things up:</p>
                  <ul>
                    <li>Use a smaller model (Llama 3.2 at 3B is very fast)</li>
                    <li>Lower the Max Tokens slider in the model dropdown</li>
                    <li>Close other heavy applications to free up RAM</li>
                    <li>A compatible GPU can improve inference speed; results vary by model, quantization, backend, drivers, and hardware</li>
                    <li>Minimum: 8 GB RAM + 4-core CPU. Recommended: 16 GB RAM + dedicated GPU</li>
                  </ul>
                </div>

                <div className="guide-card">
                  <h4>Can I use my own models?</h4>
                  <p>Models reported by the fixed-loopback Ollama daemon can appear in PrismOS-AI, but compatibility depends on model capabilities, context limits, and the installed Ollama version. Custom Modelfiles are not trusted or verified automatically; inspect their source and test them with non-sensitive prompts first.</p>
                </div>

                <div className="guide-card">
                  <h4>How do I move my data to another computer?</h4>
                  <p>Use <strong>Settings → Multi-Device Sync</strong> with the same passphrase on both computers to preview and merge the portable graph. Re-approve Project Knowledge folders on the destination because sync omits their excerpts. For a full-database recovery candidate rather than a graph merge, use a <strong>Private Vault</strong> and run the documented restore drill; do not use the device-bound <strong>Export Graph</strong> package for cross-device transfer.</p>
                </div>

                <div className="guide-card">
                  <h4>What is the Spectrum Graph?</h4>
                  <p>It's your personal knowledge network. Every conversation adds nodes (concepts) and edges (connections) to the graph. Over time, it becomes a rich map of your interests and knowledge that helps PrismOS-AI give better answers.</p>
                </div>
              </div>
            )}

            {activeSection === "about" && (
              <div className="guide-section">
                <h3>⚖️ About & Legal</h3>

                <div className="guide-card">
                  <h4>📄 License</h4>
                  <p>PrismOS-AI is released under the <strong>MIT License</strong>.</p>
                  <p style={{ marginTop: "10px", fontSize: "12px", opacity: 0.8 }}>Created by Manish Kumar</p>
                </div>

                <div className="guide-card">
                  <h4>🔷 About PrismOS-AI</h4>
                  <p><strong>Version:</strong> 0.5.2 source tree</p>
                  <p><strong>Source audit:</strong> August 1, 2026</p>
                  <p><strong>GitHub:</strong> github.com/mkbhardwas12/prismos-ai</p>
                  <p>PrismOS-AI is a local-first desktop assistant built around a SQLite knowledge graph, heuristic retrieval signals, and bounded sequential workflows. One LLM Reasoner is surrounded by deterministic orchestration, memory, policy, and judging stages. Private inference uses a fixed loopback Ollama client route; the configurable endpoint and remote-origin environment opt-in are only for status and explicit model management.</p>
                </div>

                <div className="guide-card">
                  <h4>🏗️ Built With</h4>
                  <ul>
                    <li><strong>Tauri 2.0</strong> — Desktop shell &amp; native integration</li>
                    <li><strong>React 18</strong> — User interface</li>
                    <li><strong>Rust</strong> — Backend, graph engine &amp; security</li>
                    <li><strong>Ollama</strong> — Local AI model serving</li>
                    <li><strong>SQLite</strong> — Persistent knowledge storage</li>
                    <li><strong>Sandbox policy</strong> — bounded allow-list, risk, and anomaly checks</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
