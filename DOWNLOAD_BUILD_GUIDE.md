# PrismOS-AI Download & Build Guide

> Build from reviewed source, or install only independently verified release packages

---

## Quick Start for Users

### Option 1: Install a verified release package

The current GitHub Actions workflow is manually dispatched and produces
**unsigned, unnotarized, unpublished candidate artifacts** for maintainer testing.
It does not create a GitHub Release. Do not treat a workflow artifact as a trusted
installer.

Use the [Releases Page](https://github.com/mkbhardwas12/prismos-ai/releases/latest)
only when the exact package has an independently verified source revision, SHA-256
digest, platform publisher signature, and—on macOS—notarization result.

| Platform | Package | Installation |
|----------|---------|--------------|
| **Windows** | `.msi` or `.exe` | Double-click to install |
| **macOS** | `.dmg` | Drag to Applications folder |
| **Linux (Debian/Ubuntu)** | `.deb` | `sudo dpkg -i prismos_*.deb` |
| **Linux (Universal)** | `.AppImage` | `chmod +x *.AppImage && ./prismos_*.AppImage` |
| **Android** | Not produced by the candidate workflow | Developer build only until a separately signed/tested release exists |

### Option 2: Install via Package Managers

No package-manager channel is currently published by this source tree. Do not run
an assumed Homebrew, Snap, or Chocolatey recipe. Treat any future recipe as a
separate distributor until its source, maintainer, package digest, and signature
have been verified.

---

## System Requirements

### Desktop (Windows/macOS/Linux)

**Minimum:**
- 4 GB RAM
- 2 GB free disk space (plus space for AI models)
- 64-bit processor
- OpenGL 3.3 compatible graphics

**Recommended:**
- 8 GB RAM or more
- 10 GB free disk space
- Multi-core processor
- SSD for better performance

**OS Versions:**
- Windows 10 or later
- macOS 11 Big Sur or later
- Ubuntu 20.04+ / Debian 11+ / Fedora 35+ / Arch Linux

### Mobile status

Android and iOS are not built by the current manual desktop candidate workflow and
are not advertised as supported prebuilt releases. Mobile builds remain developer
experiments until separately signed, provenance-linked artifacts pass device testing.

### iOS (Coming Soon)

**Requirements:**
- iOS 13.0 or later
- iPhone 6s or newer
- iPad (5th generation) or newer
- 2 GB RAM minimum

---

## Installation Instructions

### Windows

**Method 1: MSI Installer (Recommended)**

1. Download an approved `PrismOS-AI_X.X.X_x64_en-US.msi`
2. Verify its published SHA-256 digest and Windows publisher signature
3. Double-click the verified file
4. Click "Next" through the wizard
5. Choose installation folder
6. Approve elevation only if the reviewed installer requires it for that scope
7. Click "Finish" and launch from Start Menu

**Method 2: EXE Installer**

1. Download an approved `PrismOS-AI_X.X.X_x64-setup.exe`
2. Verify its published SHA-256 digest and Windows publisher signature
3. Run the verified installer
4. Follow on-screen instructions and launch after installation

**Post-Installation:**

Install Ollama from its reviewed official distribution, then pull the configured
default model with `ollama pull qwen3:4b`.

### macOS

**Installation:**

1. Download an approved `PrismOS-AI_X.X.X_aarch64.dmg` (Apple Silicon) or `_x64.dmg` (Intel)
2. Verify its published SHA-256 digest, code signature, and notarization result
3. Open the verified DMG file
4. Drag PrismOS-AI icon to Applications folder
5. Eject the DMG and launch from Applications or Spotlight

**First launch:** Do not remove quarantine metadata or bypass Gatekeeper. The current
candidate artifacts are unsigned and unnotarized. If an alleged release fails
signature/notarization checks, stop, delete it, and obtain a verified package or build
from reviewed source.

**Post-Installation:**

Install Ollama from its reviewed official distribution, then pull the configured
default model with `ollama pull qwen3:4b`.

### Linux

**Debian/Ubuntu (.deb)**

After downloading an approved package and its release evidence, verify its
publisher/provenance and run the published checksum procedure. Only then install
the already verified local file:

```bash
sha256sum -c SHA256SUMS
sudo dpkg -i ./prismos_X.X.X_amd64.deb

# Install missing dependencies (if any)
sudo apt-get install -f

# Launch
prismos
```

**Universal (.AppImage)**

After the same provenance, signature, and checksum verification:

```bash
sha256sum -c SHA256SUMS
chmod +x PrismOS-AI_X.X.X_amd64.AppImage
./PrismOS-AI_X.X.X_amd64.AppImage
```

**Optional: Add to Applications Menu**

```bash
# Create desktop entry
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

# Update database
update-desktop-database ~/.local/share/applications
```

**Post-Installation:**

```bash
# Install Ollama from the official distribution after reviewing its current
# publisher, package or install script, and available digest/signature information:
# https://ollama.com/download

# Pull a model
ollama pull llama3.2
```

### Mobile developer status

There is no approved prebuilt Android or iOS package in the current candidate
workflow. This guide intentionally provides no unknown-source APK installation or
mobile release-build shortcut. Mobile experiments need a separately reviewed build,
signing, provenance, privacy, and device-test process before distribution.

---

## Building from Source

### Prerequisites

Install these tools first:

1. **Node.js** (≥ 22.12; Node 24 LTS recommended): https://nodejs.org/
2. **Rust** (version selected by `rust-toolchain.toml`): obtain `rustup` from
   [rustup.rs](https://rustup.rs/) after reviewing the official download,
   publisher, and available checksum/signature guidance. Do not pipe a mutable
   network response directly into a shell.
3. **Ollama**: https://ollama.com/
4. **Platform-specific tools**:

**Windows:**
- Visual Studio Build Tools: https://visualstudio.microsoft.com/downloads/
- Select "Desktop development with C++"

**macOS:**
```bash
xcode-select --install
```

**Linux (Debian/Ubuntu):**
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

### Clone Repository

```bash
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai
```

### Install Dependencies

```bash
# Install the locked Node.js dependency graph
npm ci

# Verify Rust installation
rustc --version
cargo --version
```

### Configure Ollama

```bash
# Start Ollama server (in separate terminal)
ollama serve

# Pull the configured default model
ollama pull qwen3:4b

# Optional: install a compatible vision model only if image analysis is needed
ollama pull llama3.2-vision
```

### Development Build

```bash
# Run in development mode (hot-reload enabled)
npm run tauri dev
```

This will:
1. Start Vite dev server on port 1420
2. Compile Rust backend
3. Launch the application with hot-reload

### Production Build

```bash
# Build production installer
npm run tauri build
```

**Build Output Locations:**

**Windows:**
- `src-tauri/target/release/bundle/msi/PrismOS-AI_X.X.X_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/PrismOS-AI_X.X.X_x64-setup.exe`

**macOS:**
- `src-tauri/target/release/bundle/dmg/PrismOS-AI_X.X.X_aarch64.dmg`
- `src-tauri/target/release/bundle/dmg/PrismOS-AI_X.X.X_x64.dmg`

**Linux:**
- `src-tauri/target/release/bundle/deb/prismos_X.X.X_amd64.deb`
- `src-tauri/target/release/bundle/appimage/PrismOS-AI_X.X.X_amd64.AppImage`

### Build Time Estimates

| Platform | Time (First Build) | Time (Incremental) |
|----------|-------------------|-------------------|
| Windows | 10-15 minutes | 2-3 minutes |
| macOS | 10-15 minutes | 2-3 minutes |
| Linux | 10-15 minutes | 2-3 minutes |

*Times vary based on hardware. SSD and multi-core processors help significantly.*

### Mobile builds

Mobile packaging is outside this desktop guide. Generated Tauri configuration alone
does not establish a supported Android or iOS build. Treat the existing mobile notes
as design references until a separately reviewed, signed, and device-tested process
is documented.

---

## Testing

### Run Tests

```bash
# Frontend tests (Vitest)
npm test

# Backend tests (Cargo)
cd src-tauri
cargo test

# Type checking
npx tsc --noEmit

# Linting
cd src-tauri
cargo clippy
```

### Test inventory

Do not rely on a frozen test count. Run the complete current suites and record the
totals and revision in the candidate evidence.

---

## Troubleshooting

### Build Errors

**"command not found: npm"**
```bash
# Install Node.js from https://nodejs.org/
```

**"command not found: cargo"**

Download the platform-appropriate `rustup` installer from
[rustup.rs](https://rustup.rs/), inspect and verify it using the current official
publisher/checksum guidance, then run it explicitly. Do not pipe a mutable network
response into a shell. Reopen the terminal and confirm `rustc --version` and
`cargo --version`.

**"Ollama connection failed"**
```bash
# Start Ollama server
ollama serve &

# Verify it's running
curl http://localhost:11434/api/tags
```

**"Missing system dependencies" (Linux)**
```bash
# Install all dependencies
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

**"Build takes too long"**
```bash
# Enable parallel compilation
export CARGO_BUILD_JOBS=4  # Adjust to your CPU cores

# Use faster linker (Linux)
sudo apt-get install mold
export RUSTFLAGS="-C link-arg=-fuse-ld=mold"

# Clear cache and rebuild
cargo clean
npm run tauri build
```

### Runtime Errors

**"Model 'qwen3:4b' not found"**
```bash
# Pull the model
ollama pull qwen3:4b

# List installed models
ollama list
```

**"Permission denied" (Linux AppImage)**
```bash
# Make executable
chmod +x PrismOS-AI_*.AppImage
```

**"App is damaged" (macOS)**

Do not remove quarantine metadata to force the app open. Verify the digest, signature,
notarization, and source revision. If any check is absent or fails, delete the package
and build from reviewed source or obtain an independently verified release.

---

## Configuration

### Default Settings

PrismOS-AI uses these defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| Ollama URL | `http://localhost:11434` | Local Ollama server |
| Default Model | `qwen3:4b` | Text generation model |
| Theme | `dark` | UI theme |
| Max Tokens | `2048` | Response length limit |

### Configuration Files

**Location:**

- Windows: `C:\Users\{User}\AppData\Roaming\com.prismos.app\`
- macOS: `~/Library/Application Support/com.prismos.app/`
- Linux: `~/.local/share/com.prismos.app/`

**Files:**

- `spectrum_graph.db`: SQLite knowledge and learned-state database
- `prismos-audit.log`: Tamper-evident audit chain
- Webview-local settings: user-interface preferences (not a portable backup)

### Environment Variables

```bash
# Override Ollama URL
export OLLAMA_HOST=http://localhost:11434

# Change log level (for development)
export RUST_LOG=debug

# Development mode
export NODE_ENV=development
```

---

## Updating

PrismOS-AI does not ship an in-app updater. Releases are installed manually:

1. Download only an approved installer from the project's GitHub Releases page.
2. Verify its published SHA-256 digest, publisher signature, source revision, and
   macOS notarization where applicable.
3. Close PrismOS-AI and install the release over the existing application.
4. Restart and confirm the displayed version. Application data is stored separately from the executable, but keep independently verified recovery media before any upgrade; a Private Vault must pass a clean-profile restore drill before reliance.

Package-manager recipes are supported only when an independently maintained package exists; the source tree does not publish or control a Homebrew cask or Snap channel.

---

## Uninstallation

### Windows

1. Settings → Apps → Installed apps
2. Find "PrismOS-AI"
3. Click "⋮" → Uninstall

Or use the uninstaller:
```
C:\Program Files\PrismOS-AI\uninstall.exe
```

Uninstalling the application does not intentionally erase the private profile.
Before removing profile data, create and clean-profile-test a Private Vault, close
PrismOS, and move the exact resolved app-data directory to an offline holding
location. Delete that held copy only after confirming the backup and retention
decision; never paste a recursive deletion command from a generic guide.

### macOS

1. Drag PrismOS-AI from Applications to Trash
2. Empty Trash

The private profile is separate from the application bundle. Preserve and verify a
Private Vault before moving the exact resolved app-data directory to an offline
holding location. Do not recursively delete it while diagnosing, migrating, or
validating a restore.

### Linux

**Debian/Ubuntu:**
```bash
sudo apt-get remove prismos
```

**AppImage:**
Remove only the exact verified AppImage pathname; do not use a broad wildcard.

Keep the Linux private profile until a Private Vault has been verified in a clean
profile and the retention decision is explicit. Mobile uninstall guidance is omitted
because no supported mobile release is currently distributed.

---

## Getting Help

### Documentation

- **Comprehensive Guide**: [docs/COMPREHENSIVE_GUIDE.md](docs/COMPREHENSIVE_GUIDE.md)
- **Installation Guide**: [docs/INSTALLATION.md](docs/INSTALLATION.md)
- **Architecture**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)

### Support Channels

- **Issues**: https://github.com/mkbhardwas12/prismos-ai/issues
- **Discussions**: https://github.com/mkbhardwas12/prismos-ai/discussions
- **Email**: Open an issue on GitHub

### Community

- **GitHub**: https://github.com/mkbhardwas12/prismos-ai
- **License**: MIT (see [LICENSE](LICENSE))

---

## Next Steps

After installation:

1. Complete the onboarding wizard
2. Download recommended models
3. Try your first intent: "What is AI?"
4. Explore the Spectrum Graph visualization
5. Read the [User Guide](docs/COMPREHENSIVE_GUIDE.md#user-guide)

---

**PrismOS-AI v0.5.2** — Your work, your machine, your control.

Built with by [Manish Kumar](https://github.com/mkbhardwas12)

---

## Quick Links

- [📥 Verify Available Releases](https://github.com/mkbhardwas12/prismos-ai/releases/latest)
- [📖 Documentation](docs/)
- [🐛 Report Bug](https://github.com/mkbhardwas12/prismos-ai/issues/new)
- [💡 Request Feature](https://github.com/mkbhardwas12/prismos-ai/issues/new)
- [📋 Changelog](CHANGELOG.md)
- [🤝 Contributing](CONTRIBUTING.md)
