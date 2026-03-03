// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
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
                <p>PrismOS-AI is a <strong>local-first AI operating system</strong> that runs entirely on your device. No cloud, no data sharing, no subscriptions.</p>

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
                    A GPU with 6GB+ VRAM will make responses 5-10× faster but is not required — CPU-only works fine.
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
                  <p>Type any intent in the input bar at the bottom. PrismOS-AI will route it through its <strong>Refractive Core</strong> pipeline — analyzing, selecting the best agent, and building knowledge in your Spectrum Graph.</p>
                </div>

                <div className="guide-card highlight">
                  <h4>🔒 Your Privacy</h4>
                  <p>Everything runs locally. Your conversations, data, and knowledge graph never leave your computer. PrismOS-AI uses AES-256-GCM encryption for all stored data.</p>
                </div>
              </div>
            )}

            {activeSection === "features" && (
              <div className="guide-section">
                <h3>✨ Features</h3>

                <div className="guide-card">
                  <h4>💬 Intent Console</h4>
                  <p>Your main conversation view. Type natural language intents and PrismOS-AI intelligently routes them to the best agent. The AI learns from each interaction, building your personal knowledge graph.</p>
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
                  <h4>🔒 Sandbox Prisms</h4>
                  <p>Execute code and actions in WASM-isolated sandboxes with cryptographic signing. Every action is auditable with HMAC-SHA256 verification.</p>
                </div>

                <div className="guide-card">
                  <h4>📅 Spectral Timeline</h4>
                  <p>View your entire activity history chronologically. Filter by event type, search through past interactions, and track how your knowledge evolved.</p>
                </div>

                <div className="guide-card">
                  <h4>🔄 You-Port</h4>
                  <p>Export your entire state (encrypted) to move between devices. Supports multi-device sync with conflict resolution strategies (latest-wins, theirs, ours).</p>
                </div>

                <div className="guide-card">
                  <h4>🤖 Multi-Agent Collaboration</h4>
                  <p>PrismOS-AI can coordinate multiple AI agents working together on complex tasks. View agent activity, collaboration traces, and debate panels in real time.</p>
                </div>

                <div className="guide-card">
                  <h4>🎤 Voice Input/Output</h4>
                  <p>Enable voice input and text-to-speech output in Settings. Speak your intents naturally and hear responses read aloud.</p>
                </div>
              </div>
            )}

            {activeSection === "tips" && (
              <div className="guide-section">
                <h3>💡 Tips & Best Practices</h3>

                <div className="guide-card">
                  <h4>Choose the Right Model</h4>
                  <ul>
                    <li><strong>Fast responses:</strong> Use Llama 3.2 (3B) or Gemma 2 (2B) — lightweight and quick</li>
                    <li><strong>Best quality:</strong> Use Llama 3.1 (8B) or Mistral (7B) — more detailed answers</li>
                    <li><strong>Code tasks:</strong> Use Code Llama — specialized for programming</li>
                    <li><strong>Reasoning:</strong> Use DeepSeek R1 — chain-of-thought reasoning</li>
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
                  <p>Regular usage builds a richer Spectrum Graph. Visit the Spectrum Explorer to see your knowledge network grow. The more you use PrismOS-AI, the smarter it gets about your interests.</p>
                </div>

                <div className="guide-card">
                  <h4>Back Up Your Data</h4>
                  <p>Use <strong>Settings → Export Graph</strong> regularly to create encrypted backups. Use <strong>You-Port</strong> to sync between devices.</p>
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
                    <span>Sandbox Prisms</span>
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
                  <p><strong>No.</strong> Everything stays on your device. PrismOS-AI never sends your data anywhere. All AI processing happens locally using Ollama.</p>
                </div>

                <div className="guide-card">
                  <h4>Why are responses slow?</h4>
                  <p>Response speed depends on your hardware. Tips to speed things up:</p>
                  <ul>
                    <li>Use a smaller model (Llama 3.2 at 3B is very fast)</li>
                    <li>Lower the Max Tokens slider in the model dropdown</li>
                    <li>Close other heavy applications to free up RAM</li>
                    <li>An NVIDIA GPU with 6GB+ VRAM will make responses 5-10× faster</li>
                    <li>Minimum: 8 GB RAM + 4-core CPU. Recommended: 16 GB RAM + dedicated GPU</li>
                  </ul>
                </div>

                <div className="guide-card">
                  <h4>Can I use my own models?</h4>
                  <p>Yes! Any model available in Ollama works with PrismOS-AI. You can also create custom Modelfiles. Just pull the model via <code>ollama pull model-name</code> and it will appear in the model selector.</p>
                </div>

                <div className="guide-card">
                  <h4>How do I move my data to another computer?</h4>
                  <p>Go to <strong>Settings → You-Port</strong> to export an encrypted package. Import it on your other device. You can also use <strong>Multi-Device Sync</strong> for more advanced merge strategies.</p>
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

                <div className="guide-card highlight">
                  <h4>📋 Patent Notice</h4>
                  <p><strong>Patent Pending</strong> — US Provisional Patent Application (filed February 2026).</p>
                  <p>PrismOS-AI and its core architectures are protected by a pending United States patent.</p>
                  <p style={{ marginTop: "10px", fontSize: "12px", opacity: 0.8 }}>Created by Manish Kumar</p>
                </div>

                <div className="guide-card">
                  <h4>📄 License</h4>
                  <p>PrismOS-AI is released under the <strong>MIT License</strong> for personal and educational use.</p>
                  <p>Commercial use of the patented inventions (Spectrum Graph, Refractive Core, You-Port) requires a separate license from the creator.</p>
                </div>

                <div className="guide-card">
                  <h4>🔷 About PrismOS-AI</h4>
                  <p><strong>Version:</strong> 0.4.0</p>
                  <p><strong>Released:</strong> March 3, 2026</p>
                  <p><strong>GitHub:</strong> github.com/mkbhardwas12/prismos-ai</p>
                  <p>PrismOS-AI is a local-first AI operating system built on a physics-inspired 7-dimensional knowledge graph. It processes your intents through multi-agent collaboration — all running 100% offline on your own hardware.</p>
                </div>

                <div className="guide-card">
                  <h4>🏗️ Built With</h4>
                  <ul>
                    <li><strong>Tauri 2.0</strong> — Desktop shell &amp; native integration</li>
                    <li><strong>React 18</strong> — User interface</li>
                    <li><strong>Rust</strong> — Backend, graph engine &amp; security</li>
                    <li><strong>Ollama</strong> — Local AI model serving</li>
                    <li><strong>SQLite</strong> — Persistent knowledge storage</li>
                    <li><strong>wasmtime</strong> — WASM sandbox isolation</li>
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
