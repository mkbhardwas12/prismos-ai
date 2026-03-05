# PrismOS-AI Installation Guide

> Complete installation instructions for all platforms

---

## Table of Contents

1. [Pre-Built Installers (Recommended)](#pre-built-installers-recommended)
2. [Building from Source](#building-from-source)
3. [Platform-Specific Instructions](#platform-specific-instructions)
4. [Post-Installation Setup](#post-installation-setup)
5. [Troubleshooting](#troubleshooting)

---

## Pre-Built Installers (Recommended)

### Download

Visit the [Releases Page](https://github.com/mkbhardwas12/prismos-ai/releases/latest) and download the appropriate installer for your platform.

### Windows

**Option 1: MSI Installer (Recommended)**

1. Download `PrismOS-AI_X.X.X_x64_en-US.msi`
2. Double-click the MSI file
3. Follow the installation wizard
4. Choose installation directory (default: `C:\Program Files\PrismOS-AI`)
5. Click "Install"
6. Launch from Start Menu or Desktop shortcut

**Option 2: EXE Installer**

1. Download `PrismOS-AI_X.X.X_x64-setup.exe`
2. Run the installer (may require administrator privileges)
3. Follow the installation wizard
4. Launch after installation completes

**System Requirements:**
- Windows 10/11 (64-bit)
- 4 GB RAM minimum, 8 GB recommended
- 2 GB free disk space (plus space for models)
- [Ollama](https://ollama.com/download) installed separately

### macOS

**For Apple Silicon (M1/M2/M3)**

1. Download `PrismOS-AI_X.X.X_aarch64.dmg`
2. Open the DMG file
3. Drag PrismOS-AI to Applications folder
4. Right-click and select "Open" (first launch only to bypass Gatekeeper)
5. Launch from Applications or Spotlight

**For Intel Macs**

1. Download `PrismOS-AI_X.X.X_x64.dmg`
2. Follow same steps as Apple Silicon

**System Requirements:**
- macOS 11 Big Sur or later
- 4 GB RAM minimum, 8 GB recommended
- 2 GB free disk space (plus space for models)
- [Ollama](https://ollama.com/download) installed separately

**Note**: On first launch, you may need to grant permissions for:
- Microphone access (for voice input)
- Accessibility access (for global hotkey)

### Linux

**Option 1: DEB Package (Debian/Ubuntu)**

```bash
# Download the .deb file
wget https://github.com/mkbhardwas12/prismos-ai/releases/download/vX.X.X/prismos_X.X.X_amd64.deb

# Install
sudo dpkg -i prismos_X.X.X_amd64.deb

# If dependencies are missing:
sudo apt-get install -f

# Launch
prismos
```

**Option 2: AppImage (Universal)**

```bash
# Download the AppImage
wget https://github.com/mkbhardwas12/prismos-ai/releases/download/vX.X.X/PrismOS-AI_X.X.X_amd64.AppImage

# Make executable
chmod +x PrismOS-AI_X.X.X_amd64.AppImage

# Run
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

**APK Installation (Sideload)**

1. Download `prismos-android-vX.X.X.apk`
2. On your Android device, enable "Install from unknown sources":
   - Settings → Security → Unknown Sources
   - Or Settings → Apps → Special Access → Install Unknown Apps
3. Transfer APK to device or download directly
4. Open the APK file to install
5. Launch PrismOS-AI from app drawer

**System Requirements:**
- Android 8.0 (API 26) or later
- 2 GB RAM minimum, 4 GB recommended
- 1 GB free storage (plus space for models)

**Note**: Android version has limited functionality. Full Ollama integration is not available on mobile yet.

---

## Building from Source

### Prerequisites

Install these tools before building:

1. **Node.js** (≥ 18)
   ```bash
   # Download from https://nodejs.org/
   # Or via package manager:
   # Ubuntu/Debian:
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs

   # macOS:
   brew install node

   # Windows:
   # Download installer from nodejs.org
   ```

2. **Rust** (≥ 1.75)
   ```bash
   # All platforms:
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   ```

3. **Ollama**
   ```bash
   # macOS/Linux:
   curl -fsSL https://ollama.com/install.sh | sh

   # Windows:
   # Download installer from https://ollama.com/download
   ```

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

# 3. Pull a local LLM model
ollama pull llama3.2

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

**Install as System Service (Optional)**

To run PrismOS-AI as a background service:

1. Open Task Scheduler
2. Create Basic Task
3. Trigger: At startup
4. Action: Start a program
5. Program: `C:\Program Files\PrismOS-AI\PrismOS-AI.exe`
6. Check "Run with highest privileges"

**Firewall Configuration**

If Windows Firewall blocks Ollama connections:

1. Windows Security → Firewall & network protection → Allow an app
2. Click "Change settings" → "Allow another app"
3. Browse to `C:\Users\{YourName}\AppData\Local\Programs\ollama\ollama.exe`
4. Check both Private and Public networks

### macOS: Permissions & Codesigning

**Grant Permissions**

On first launch, grant these permissions when prompted:

1. **Microphone**: Required for voice input
2. **Accessibility**: Required for global hotkey (Ctrl+Space)
3. **Full Disk Access** (optional): For file indexer to watch directories

**Manual Permission Grant**

If not prompted:

1. System Settings → Privacy & Security
2. Microphone → Enable PrismOS-AI
3. Accessibility → Enable PrismOS-AI

**Notarization**

Pre-built DMG files are notarized and stapled. If building from source, you'll see a warning on first launch. To bypass:

```bash
sudo xattr -rd com.apple.quarantine /Applications/PrismOS-AI.app
```

### Linux: Desktop Integration

**Add to Applications Menu**

If using AppImage, create a desktop entry:

```bash
mkdir -p ~/.local/share/applications

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

update-desktop-database ~/.local/share/applications
```

**Start on Boot**

```bash
mkdir -p ~/.config/autostart
cp ~/.local/share/applications/prismos-ai.desktop ~/.config/autostart/
```

### Android: Advanced Setup

**Enable Developer Options**

1. Settings → About Phone
2. Tap "Build Number" 7 times
3. Go back → Developer Options
4. Enable "USB Debugging"

**Install via ADB**

```bash
# Connect device via USB
adb devices

# Install APK
adb install prismos-android-vX.X.X.apk

# Launch
adb shell am start -n com.prismos.app/.MainActivity
```

---

## Post-Installation Setup

### 1. Install Ollama

**macOS/Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows:**
Download from https://ollama.com/download

### 2. Start Ollama Service

**Linux/macOS:**
```bash
ollama serve &
```

**Windows:**
Ollama runs as a system service automatically after installation.

### 3. Download Models

**Recommended Models:**

```bash
# Text & Reasoning (choose one)
ollama pull llama3.2         # Default, best balance
ollama pull mistral          # Faster, smaller
ollama pull deepseek-r1      # Advanced reasoning

# Vision (required for image analysis)
ollama pull llama3.2-vision  # Default vision model
ollama pull llava            # Alternative vision model

# Power User (optional)
ollama pull codellama        # Code generation
ollama pull qwen2.5          # Multilingual
ollama pull gemma2:2b        # Lightweight
```

**Model Sizes:**
- `llama3.2`: ~2 GB
- `llama3.2-vision`: ~7.9 GB
- `mistral`: ~4.1 GB
- `deepseek-r1`: ~37 GB (large!)

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

### 7. Optional: File Indexer

To enable automatic document indexing:

1. Create directory: `~/Documents/PrismDocs`
2. Settings → File Indexer → Enable
3. Drop documents into `PrismDocs` folder
4. They'll be auto-ingested into Spectrum Graph

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

3. Verify URL in Settings:
   - Settings → Model → Ollama URL
   - Should be: `http://localhost:11434`

#### Issue: "Model 'llama3.2' not found"

**Solution:**

```bash
# Pull the model
ollama pull llama3.2

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
   - Disable file indexer if not needed

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

1. **Backup first** via You-Port:
   - Settings → You-Port → Export Graph
   - Save the encrypted file

2. Locate database:
   ```bash
   # macOS:
   ~/Library/Application Support/com.prismos.app/spectrum.db

   # Linux:
   ~/.local/share/com.prismos.app/spectrum.db

   # Windows:
   C:\Users\{YourName}\AppData\Roaming\com.prismos.app\spectrum.db
   ```

3. Delete database file (app will recreate on next launch)

4. Re-import from You-Port export

### Platform-Specific Issues

#### Windows: Installer blocked by SmartScreen

**Solution:**

1. Click "More info"
2. Click "Run anyway"
3. This is expected for unsigned installers

#### macOS: "App is damaged and can't be opened"

**Solution:**

```bash
sudo xattr -rd com.apple.quarantine /Applications/PrismOS-AI.app
```

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

**PrismOS-AI v0.5.1** — Your mind, your machine, your OS.
