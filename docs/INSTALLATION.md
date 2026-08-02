# PrismOS-AI Verified Desktop Installation Guide

> Verified desktop installation and reviewed source-build guidance

---

## Table of Contents

1. [Verified Release Installers](#verified-release-installers)
2. [Building from Source](#building-from-source)
3. [Platform-Specific Instructions](#platform-specific-instructions)
4. [Post-Installation Setup](#post-installation-setup)
5. [Troubleshooting](#troubleshooting)

---

## Verified Release Installers

The current GitHub Actions candidate workflow is manual and produces short-lived,
**unsigned and unnotarized** build artifacts. It does not publish a GitHub Release.
Those candidates are for maintainer testing, not trusted distribution.

Only distribute or install a prebuilt PrismOS package after its source revision,
SHA-256 digest, platform signature, and publisher have been independently verified.
macOS packages must also pass notarization verification. If no such approved release
exists, build from reviewed source instead of bypassing an operating-system warning.

### Download

Visit the [Releases Page](https://github.com/mkbhardwas12/prismos-ai/releases/latest)
only after confirming that the release provides approved signed/notarized packages,
checksums, and provenance for the revision you intend to install.

### Windows

**Option 1: MSI Installer (Recommended)**

1. Download `PrismOS-AI_X.X.X_x64_en-US.msi`
2. Verify the published SHA-256 digest and Windows publisher signature
3. Double-click the verified MSI file and follow the installation wizard
4. Choose installation directory (default: `C:\Program Files\PrismOS-AI`)
5. Click "Install"
6. Launch from Start Menu or Desktop shortcut

**Option 2: EXE Installer**

1. Download `PrismOS-AI_X.X.X_x64-setup.exe`
2. Verify the published SHA-256 digest and Windows publisher signature
3. Run the verified installer as a normal user; approve elevation only when the
   reviewed installer requires it for the selected install scope
4. Launch after installation completes

**System Requirements:**
- Windows 10/11 (64-bit)
- 4 GB RAM minimum, 8 GB recommended
- 2 GB free disk space (plus space for models)
- [Ollama](https://ollama.com/download) installed separately

### macOS

**For Apple Silicon (M1/M2/M3)**

1. Download `PrismOS-AI_X.X.X_aarch64.dmg`
2. Verify the published SHA-256 digest, code signature, and notarization result
3. Open the verified DMG file
4. Drag PrismOS-AI to Applications folder
5. Launch from Applications or Spotlight. Do not remove quarantine metadata or
   bypass Gatekeeper for an unverified package

**For Intel Macs**

1. Download `PrismOS-AI_X.X.X_x64.dmg`
2. Follow same steps as Apple Silicon

**System Requirements:**
- macOS 11 Big Sur or later
- 4 GB RAM minimum, 8 GB recommended
- 2 GB free disk space (plus space for models)
- [Ollama](https://ollama.com/download) installed separately

**Note**: You may need to grant:
- Microphone access only when using browser-provided speech recognition. Availability
  and network behavior depend on the system webview/provider; PrismOS does not ship
  working local Whisper transcription.
- Accessibility access for the global hotkey.

### Linux

**Option 1: DEB Package (Debian/Ubuntu)**

Download only an independently approved package plus its release evidence. Verify
publisher/provenance and the published checksum first; then install the verified
local file:

```bash
sha256sum -c SHA256SUMS
sudo dpkg -i ./prismos_X.X.X_amd64.deb

# If dependencies are missing:
sudo apt-get install -f

# Launch
prismos
```

**Option 2: AppImage (Universal)**

After the same provenance, signature, and checksum verification:

```bash
sha256sum -c SHA256SUMS
chmod +x PrismOS-AI_X.X.X_amd64.AppImage
./PrismOS-AI_X.X.X_amd64.AppImage
```

**System Requirements:**
- Ubuntu 20.04+ / Debian 11+ / Fedora 35+ / Arch Linux
- 4 GB RAM minimum, 8 GB recommended
- 2 GB free disk space (plus space for models)
- [Ollama](https://ollama.com/download) installed separately

**Dependencies** (usually pre-installed):
```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-0 \
  libgtk-3-0 \
  libsoup-3.0-0 \
  libjavascriptcoregtk-4.1-0 \
  libasound2 \
  libdbus-1-3
```

### Android

**Android status**

The manual desktop candidate workflow does not build or publish Android packages.
Do not enable unknown-source installation for an unverified PrismOS APK. Android
distribution requires a separately built, signed, provenance-linked package that
has been tested on the advertised device/API range. Otherwise use a developer build
from reviewed source on a dedicated test device.

This guide intentionally provides no APK installation shortcut. Generated mobile
configuration is not evidence of a supported or distributable Android product.

---

## Building from Source

### Prerequisites

Install these tools before building:

1. **Node.js** (≥ 22.12; CI uses the supported Node 24 LTS line)
   Install from [nodejs.org](https://nodejs.org/) or a reviewed operating-system
   package source. Verify the publisher/package and do not pipe a mutable setup
   script from the network directly into a privileged shell.

2. **Rust** (the version pinned in `rust-toolchain.toml`)
   Install `rustup` using the platform instructions at
   [rustup.rs](https://rustup.rs), review the downloaded installer before running
   it, then let the checked-in toolchain file select the exact compiler.

3. **Ollama**
   Download it from [Ollama's official download page](https://ollama.com/download),
   inspect the package/script and publisher information, then install it explicitly.
   PrismOS does not pipe Ollama's mutable network installer directly into a shell.

4. **Platform-Specific Dependencies**

   **Linux:**
   ```bash
   sudo apt-get update
   sudo apt-get install -y \
     libwebkit2gtk-4.1-dev \
     libappindicator3-dev \
     librsvg2-dev \
     patchelf \
     libssl-dev \
     libgtk-3-dev \
     libsoup-3.0-dev \
     libjavascriptcoregtk-4.1-dev \
     libasound2-dev \
     libxcb1-dev \
     libxrandr-dev \
     libdbus-1-dev \
     libpipewire-0.3-dev \
     libwayland-dev \
     libegl-dev \
     libgbm-dev \
     clang
   ```

   **macOS:**
   ```bash
   # Xcode Command Line Tools
   xcode-select --install
   ```

   **Windows:**
   - Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
   - Select "Desktop development with C++" workload

### Build Steps

```bash
# 1. Clone the repository
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai

# 2. Install frontend dependencies
npm install

# 3. Pull a local LLM model (new default: qwen3:4b)
ollama pull qwen3:4b

# 4. Start Ollama server (in separate terminal)
ollama serve

# 5. Run in development mode
npm run tauri dev

# 6. Build production installer
npm run tauri build
```

### Build Outputs

After running `npm run tauri build`, installers are created in:

**Windows:**
- `src-tauri/target/release/bundle/msi/PrismOS-AI_X.X.X_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/PrismOS-AI_X.X.X_x64-setup.exe`

**macOS:**
- `src-tauri/target/release/bundle/dmg/PrismOS-AI_X.X.X_aarch64.dmg` (Apple Silicon)
- `src-tauri/target/release/bundle/dmg/PrismOS-AI_X.X.X_x64.dmg` (Intel)

**Linux:**
- `src-tauri/target/release/bundle/deb/prismos_X.X.X_amd64.deb`
- `src-tauri/target/release/bundle/appimage/PrismOS-AI_X.X.X_amd64.AppImage`

---

## Platform-Specific Instructions

### Windows: Advanced Configuration

**User-level autostart (optional)**

PrismOS does not require elevated or system-service execution. If autostart is
needed, use Windows **Settings → Apps → Startup** or a user-level Task Scheduler
entry triggered **At log on**. Do not select “Run with highest privileges.”

**Firewall Configuration**

PrismOS private inference connects to Ollama over loopback and should not require a
public inbound firewall exception. Do not expose Ollama on a Public network. If a
firewall prompt appears, cancel it, confirm Ollama is bound to loopback, and verify
`http://localhost:11434/api/tags` locally. Any deliberate LAN deployment is outside
the private-inference design and requires its own authentication and firewall review.

### macOS: Permissions & Codesigning

**Grant Permissions**

Grant permissions only when the corresponding feature prompts:

1. **Microphone**: Optional, for browser-provided speech recognition when the
   system webview exposes it. This may use an external provider; bundled real
   Whisper transcription is unavailable.
2. **Accessibility**: Required for the global hotkey (Ctrl+Space).

Full Disk Access is not required for knowledge ingestion. The legacy background
watcher/indexer is disabled; Project Knowledge reads only a bounded root after an
explicit preview and approval.

**Manual Permission Grant**

If not prompted:

1. System Settings → Privacy & Security
2. Microphone → Enable PrismOS-AI only if you choose browser speech recognition
3. Accessibility → Enable PrismOS-AI for the global hotkey

**Signature and notarization**

The current manual candidate artifacts are unsigned and unnotarized. Do not
distribute them as release builds and do not bypass Gatekeeper. A distributable
macOS build must be signed and notarized independently, then verified on the exact
downloaded artifact before installation. For example, release verification may use
`codesign --verify --deep --strict --verbose=2` and `spctl --assess --type execute
--verbose=4`; these checks do not replace checksum and provenance review.

### Linux: Desktop Integration

**Add to Applications Menu**

If using AppImage, create a desktop entry:

```bash
mkdir -p ~/.local/share/applications

cat > ~/.local/share/applications/prismos-ai.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=PrismOS-AI
Comment=Local-first desktop assistant with bounded sequential workflows
Exec=/path/to/PrismOS-AI_X.X.X_amd64.AppImage
Icon=prismos
Terminal=false
Categories=Utility;Development;
EOF

update-desktop-database ~/.local/share/applications
```

**Start on Boot**

```bash
mkdir -p ~/.config/autostart
cp ~/.local/share/applications/prismos-ai.desktop ~/.config/autostart/
```

---

## Post-Installation Setup

### 1. Install Ollama

**All platforms:** download from [Ollama's official download page](https://ollama.com/download),
verify the publisher/package appropriate to your platform, and install explicitly.

### 2. Start Ollama Service

**Linux/macOS:**
```bash
ollama serve &
```

**Windows:**
Ollama runs as a system service automatically after installation.

### 3. Download Models

**Example local models:**

```bash
# Text model configured by default
ollama pull qwen3:4b

# Optional compatible vision model for image analysis
ollama pull llama3.2-vision

# Inspect installed names before selecting a different model
ollama list
```

Model sizes and tags change by quantization and registry version. Inspect the exact
artifact before downloading and confirm that its license, storage, RAM, and context
requirements fit the intended machine.

### 4. First Launch

1. Launch PrismOS-AI
2. **Onboarding Wizard** appears:
   - Choose your default model
   - Select theme (dark/light)
   - Configure startup view
3. Click "Get Started"

### 5. Test Installation

**In Intent Console:**

```
Test query: "What is the capital of France?"
```

If you see a response from the AI, installation is complete!

### 6. Configure Global Hotkey

**Windows/Linux:**
- Default: `Ctrl+Space` or `Alt+Space`
- No configuration needed

**macOS:**
- Go to System Settings → Privacy & Security → Accessibility
- Enable PrismOS-AI

### 7. Optional: Project Knowledge

To ground chat in a project or a folder of projects:

1. Open **Settings → Project Knowledge**.
2. Enter the project-folder path and select **Scan**. This first pass reads
   metadata only; it does not read file contents.
3. Review the bounded candidate count, total size, excluded sensitive files,
   ignored folders, and any truncation warning.
4. Select **Approve & Index** to read that approved file set in read-only mode
   and store cited chunks in PrismOS's local Spectrum Graph.
5. Use **Refresh** after source files change. **Forget** removes only
   PrismOS-owned knowledge chunks; it never deletes or edits the source files.

Project roots are never followed through symlinks, and common secrets,
credentials, vendor/build folders, binaries, and oversized files are excluded.
Secret redaction is best-effort, so review the scan scope before approval. See
[Project Knowledge](PROJECT_KNOWLEDGE.md) for supported files, safety limits,
storage details, refresh behavior, and retrieval semantics.

There is no active background watcher. Refresh is explicit and repeats the preview and
approval flow. Project Knowledge accepts only allowlisted UTF-8 source, documentation,
configuration, and manifest text; it does not parse Office or PDF files. One-off chat
attachments follow a separate ephemeral path supporting bounded DOCX, PPTX, and
allowlisted UTF-8 text/code, including CSV/TSV, and are not automatically added to
Project Knowledge or the Spectrum Graph. Convert PDFs to UTF-8 text before attaching
them. XLSX and legacy `.xls` fail closed before parsing; export spreadsheets as CSV/TSV.

---

## Troubleshooting

### Common Issues

#### Issue: "Ollama connection failed"

**Solution:**

1. Check Ollama is running:
   ```bash
   curl http://localhost:11434/api/tags
   ```

2. If not running:
   ```bash
   # Linux/macOS:
   ollama serve &

   # Windows:
   # Check Services → Ollama Service is running
   ```

3. Private inference always uses `http://localhost:11434`; the Ollama URL shown in
   Settings controls model management/status only and cannot redirect chat, document,
   vision, or workflow prompts.

#### Issue: "Model 'qwen3:4b' not found"

**Solution:**

```bash
# Pull the model
ollama pull qwen3:4b

# Verify installation
ollama list
```

#### Issue: High CPU usage

**Solution:**

1. Reduce model size:
   ```bash
   # Switch to smaller model
   ollama pull gemma2:2b
   ```

2. In Settings:
   - Reduce max tokens (default: 2048 → 1024)
   - Let any explicitly approved Project Knowledge index/refresh finish; there is no
     background watcher to disable

#### Issue: Vision model fails

**Solution:**

1. Install vision model:
   ```bash
   ollama pull llama3.2-vision
   ```

2. PrismOS will auto-detect and switch when image attached

#### Issue: Global hotkey not working (macOS)

**Solution:**

1. System Settings → Privacy & Security → Accessibility
2. Add PrismOS-AI to the list
3. Restart PrismOS-AI

#### Issue: Database corruption

**Solution:**

1. Quit PrismOS and preserve the complete app-data directory. Do not delete or
   overwrite `spectrum_graph.db` or its sidecars while diagnosing corruption.
2. If the app still opens safely, create a new encrypted **Private Vault** outside
   every Git worktree before attempting recovery. Portable You-Port packages omit
   managed Project Knowledge and are not full disaster recovery.
3. Validate the preserved copy and the candidate vault; never disable integrity or
   schema checks to force a restore.
4. Stage a known-good Private Vault through the supported restore workflow and
   restart. Verify representative conversations, sources, learned state, and the
   audit chain before removing any preserved copy.
5. If startup or rollback reports failure, stop reopening the app and seek recovery
   help with the exact non-secret error and protected files intact.

### Platform-Specific Issues

#### Windows: Installer blocked by SmartScreen

**Solution:**

Do not choose “Run anyway” for an unverified build. Confirm the artifact digest and
publisher signature against an independently approved release. If the signature or
provenance cannot be verified, delete the candidate and build from reviewed source.

#### macOS: "App is damaged and can't be opened"

**Solution:**

Do not remove quarantine metadata to force the app open. Re-download an independently
verified signed/notarized package, compare its published digest, or build from reviewed
source. Treat an unexpected Gatekeeper failure as a stop condition.

#### Linux: Missing library errors

**Solution:**

```bash
# Install missing dependencies
sudo apt-get install -y \
  libwebkit2gtk-4.1-0 \
  libgtk-3-0 \
  libsoup-3.0-0 \
  libjavascriptcoregtk-4.1-0
```

### Getting Help

- **Documentation**: See [COMPREHENSIVE_GUIDE.md](COMPREHENSIVE_GUIDE.md)
- **Issues**: https://github.com/mkbhardwas12/prismos-ai/issues
- **Discussions**: https://github.com/mkbhardwas12/prismos-ai/discussions

---

## Next Steps

After installation:

1. Read the [User Guide](COMPREHENSIVE_GUIDE.md#user-guide)
2. Try example intents in Intent Console
3. Explore the Spectrum Graph visualization
4. Check out advanced features (Sandbox Prisms, You-Port)

---

**PrismOS-AI v0.5.2** — Your work, your machine, your control.
