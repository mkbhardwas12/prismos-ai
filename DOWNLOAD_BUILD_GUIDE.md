# PrismOS-AI Download & Build Guide

> Complete guide for downloading pre-built packages or building from source

---

## Quick Start for Users

### Option 1: Download Pre-Built Packages (Recommended)

**Latest Release**: Visit [Releases Page](https://github.com/mkbhardwas12/prismos-ai/releases/latest)

| Platform | Package | Installation |
|----------|---------|--------------|
| **Windows** | `.msi` or `.exe` | Double-click to install |
| **macOS** | `.dmg` | Drag to Applications folder |
| **Linux (Debian/Ubuntu)** | `.deb` | `sudo dpkg -i prismos_*.deb` |
| **Linux (Universal)** | `.AppImage` | `chmod +x *.AppImage && ./prismos_*.AppImage` |
| **Android** | `.apk` | Install via file manager (enable "Unknown sources") |

### Option 2: Install via Package Managers

**Coming Soon:**
- Homebrew (macOS): `brew install --cask prismos-ai`
- Snap (Linux): `snap install prismos-ai`
- Chocolatey (Windows): `choco install prismos-ai`

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

### Mobile (Android)

**Minimum:**
- Android 8.0 (API 26)
- 2 GB RAM
- 1 GB free storage

**Recommended:**
- Android 10+
- 4 GB RAM
- 4 GB free storage

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

1. Download `PrismOS-AI_X.X.X_x64_en-US.msi`
2. Double-click the file
3. Click "Next" through the wizard
4. Choose installation folder (default: `C:\Program Files\PrismOS-AI`)
5. Click "Install" (may require administrator privileges)
6. Click "Finish" when complete
7. Launch from Start Menu

**Method 2: EXE Installer**

1. Download `PrismOS-AI_X.X.X_x64-setup.exe`
2. Run the installer
3. Follow on-screen instructions
4. Launch after installation

**Post-Installation:**

Install Ollama:
```powershell
# Download Ollama from https://ollama.com/download
# Or use winget:
winget install Ollama.Ollama

# Pull a model:
ollama pull llama3.2
```

### macOS

**Installation:**

1. Download `PrismOS-AI_X.X.X_aarch64.dmg` (Apple Silicon) or `_x64.dmg` (Intel)
2. Open the DMG file
3. Drag PrismOS-AI icon to Applications folder
4. Eject the DMG
5. Launch from Applications or Spotlight (⌘+Space → "PrismOS")

**First Launch:**

macOS may show "PrismOS-AI cannot be opened because it is from an unidentified developer":

1. Right-click (or Control+click) on PrismOS-AI
2. Select "Open"
3. Click "Open" in the dialog

Or remove quarantine flag:
```bash
sudo xattr -rd com.apple.quarantine /Applications/PrismOS-AI.app
```

**Post-Installation:**

```bash
# Install Ollama
brew install ollama

# Or download from https://ollama.com/download

# Pull a model
ollama pull llama3.2
```

### Linux

**Debian/Ubuntu (.deb)**

```bash
# Download the .deb file
wget https://github.com/mkbhardwas12/prismos-ai/releases/download/vX.X.X/prismos_X.X.X_amd64.deb

# Install
sudo dpkg -i prismos_X.X.X_amd64.deb

# Install missing dependencies (if any)
sudo apt-get install -f

# Launch
prismos
```

**Universal (.AppImage)**

```bash
# Download AppImage
wget https://github.com/mkbhardwas12/prismos-ai/releases/download/vX.X.X/PrismOS-AI_X.X.X_amd64.AppImage

# Make executable
chmod +x PrismOS-AI_X.X.X_amd64.AppImage

# Run
./PrismOS-AI_X.X.X_amd64.AppImage
```

**Optional: Add to Applications Menu**

```bash
# Create desktop entry
cat > ~/.local/share/applications/prismos-ai.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=PrismOS-AI
Comment=Local-First Agentic Personal AI Operating System
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
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3.2
```

### Android

**Installation:**

1. Download `prismos-android-vX.X.X.apk`
2. On your device, go to Settings → Security
3. Enable "Install from unknown sources" or "Allow from this source"
4. Open Downloads folder
5. Tap the APK file
6. Tap "Install"
7. Tap "Open" when complete

**Via ADB (for developers):**

```bash
# Connect device via USB
adb devices

# Install APK
adb install prismos-android-vX.X.X.apk

# Launch app
adb shell am start -n com.prismos.app/.MainActivity
```

**Note**: Android version has limited functionality. Full Ollama integration is experimental.

---

## Building from Source

### Prerequisites

Install these tools first:

1. **Node.js** (≥ 18): https://nodejs.org/
2. **Rust** (≥ 1.75): https://rustup.rs/
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
# Install Node.js dependencies
npm install

# Verify Rust installation
rustc --version
cargo --version
```

### Configure Ollama

```bash
# Start Ollama server (in separate terminal)
ollama serve

# Pull required models
ollama pull llama3.2
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

### Build Android from Source

```bash
# Prerequisites
export ANDROID_HOME=$HOME/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/29.0.13846066

# Add Android Rust targets
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# Initialize Android project
npx tauri android init

# Build APK
npx tauri android build --apk -- --features vendored-ssl

# Output: src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk
```

### Build iOS from Source (macOS only)

See [iOS_BUILD_SETUP.md](docs/IOS_BUILD_SETUP.md) for complete instructions.

```bash
# Add iOS targets
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim

# Initialize iOS project
npx tauri ios init

# Build for iOS
npx tauri ios build --release
```

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

### Test Coverage

The project includes **162 tests**:
- 97 frontend tests (Vitest + React Testing Library)
- 65 backend tests (Cargo)

---

## Troubleshooting

### Build Errors

**"command not found: npm"**
```bash
# Install Node.js from https://nodejs.org/
```

**"command not found: cargo"**
```bash
# Install Rust from https://rustup.rs/
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

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

**"Model 'llama3.2' not found"**
```bash
# Pull the model
ollama pull llama3.2

# List installed models
ollama list
```

**"Permission denied" (Linux AppImage)**
```bash
# Make executable
chmod +x PrismOS-AI_*.AppImage
```

**"App is damaged" (macOS)**
```bash
# Remove quarantine flag
sudo xattr -rd com.apple.quarantine /Applications/PrismOS-AI.app
```

---

## Configuration

### Default Settings

PrismOS-AI uses these defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| Ollama URL | `http://localhost:11434` | Local Ollama server |
| Default Model | `llama3.2` | Text generation model |
| Theme | `dark` | UI theme |
| Max Tokens | `2048` | Response length limit |

### Configuration Files

**Location:**

- Windows: `C:\Users\{User}\AppData\Roaming\com.prismos.app\`
- macOS: `~/Library/Application Support/com.prismos.app/`
- Linux: `~/.local/share/com.prismos.app/`

**Files:**

- `spectrum.db`: SQLite database (knowledge graph)
- `settings.json`: User preferences
- `audit.log`: Security audit trail

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

### Auto-Update (Desktop)

PrismOS-AI includes auto-updater:

1. Help → Check for Updates
2. Click "Download" if update available
3. Restart when prompted

### Manual Update

1. Download latest release from GitHub
2. Install over existing installation
3. Your data is preserved (stored separately)

### Update via Package Manager

**Homebrew (macOS):**
```bash
brew upgrade --cask prismos-ai
```

**Snap (Linux):**
```bash
snap refresh prismos-ai
```

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

**Remove Data:**
```powershell
Remove-Item -Recurse "$env:APPDATA\com.prismos.app"
```

### macOS

1. Drag PrismOS-AI from Applications to Trash
2. Empty Trash

**Remove Data:**
```bash
rm -rf ~/Library/Application\ Support/com.prismos.app
rm -rf ~/Library/Caches/com.prismos.app
```

### Linux

**Debian/Ubuntu:**
```bash
sudo apt-get remove prismos
```

**AppImage:**
```bash
rm PrismOS-AI_*.AppImage
rm -rf ~/.local/share/com.prismos.app
```

### Android

1. Long-press app icon
2. Tap "Uninstall"
3. Confirm

Or via Settings:
1. Settings → Apps → PrismOS-AI
2. Tap "Uninstall"

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
- **Patent**: US Provisional Patent (Feb 2026)

---

## Next Steps

After installation:

1. Complete the onboarding wizard
2. Download recommended models
3. Try your first intent: "What is AI?"
4. Explore the Spectrum Graph visualization
5. Read the [User Guide](docs/COMPREHENSIVE_GUIDE.md#user-guide)

---

**PrismOS-AI v0.5.1** — Your mind, your machine, your OS.

Built with by [Manish Kumar](https://github.com/mkbhardwas12)

---

## Quick Links

- [📥 Download Latest Release](https://github.com/mkbhardwas12/prismos-ai/releases/latest)
- [📖 Documentation](docs/)
- [🐛 Report Bug](https://github.com/mkbhardwas12/prismos-ai/issues/new)
- [💡 Request Feature](https://github.com/mkbhardwas12/prismos-ai/issues/new)
- [📋 Changelog](CHANGELOG.md)
- [🤝 Contributing](CONTRIBUTING.md)
