# PrismOS-AI Deployment Guide

> Complete guide for distributing PrismOS-AI to App Stores and manual distribution

---

## Table of Contents

1. [Overview](#overview)
2. [iOS App Store Deployment](#ios-app-store-deployment)
3. [Android Google Play Store Deployment](#android-google-play-store-deployment)
4. [Desktop Distribution](#desktop-distribution)
5. [GitHub Releases](#github-releases)
6. [Release Checklist](#release-checklist)

---

## Overview

PrismOS-AI can be distributed through multiple channels:

- **iOS App Store** (requires Apple Developer account)
- **Google Play Store** (requires Google Play Console account)
- **Microsoft Store** (optional, requires Microsoft Partner account)
- **GitHub Releases** (open source distribution)
- **Direct Download** (installers on website)

### Current Build System

The project uses **Tauri 2.0** which supports:
- Desktop: Windows, macOS, Linux
- Mobile: Android (iOS support in progress)

---

## iOS App Store Deployment

### Prerequisites

1. **Apple Developer Account** ($99/year)
   - Enroll at: https://developer.apple.com/programs/

2. **Development Environment**
   - macOS 12.0 or later
   - Xcode 14.0 or later
   - CocoaPods installed

3. **App Store Connect Setup**
   - Create App ID: `com.prismos.app`
   - Enable capabilities: Push Notifications (if needed)

### Step 1: Initialize Tauri iOS Project

```bash
# Install iOS dependencies
brew install cocoapods

# Initialize Tauri iOS project (Tauri 2.1+ required)
npm install @tauri-apps/cli@next
npx tauri ios init

# This creates: src-tauri/gen/apple/
```

### Step 2: Configure iOS Project

**Update `src-tauri/tauri.conf.json`:**

```json
{
  "bundle": {
    "iOS": {
      "developmentTeam": "YOUR_TEAM_ID",
      "minimumSystemVersion": "13.0"
    }
  }
}
```

**Update `src-tauri/Cargo.toml`:**

```toml
[target.'cfg(target_os = "ios")'.dependencies]
# iOS-specific dependencies
tauri = { version = "2", features = ["ios"] }
```

### Step 3: Configure App Store Metadata

**Create `src-tauri/gen/apple/metadata.json`:**

```json
{
  "name": "PrismOS-AI",
  "displayName": "PrismOS-AI",
  "bundleIdentifier": "com.prismos.app",
  "version": "0.5.1",
  "buildNumber": "1",
  "category": "Productivity",
  "description": "Local-First Agentic Personal AI Operating System",
  "keywords": ["AI", "privacy", "local-first", "knowledge graph"],
  "primaryLanguage": "en-US",
  "supportedLanguages": ["en"],
  "copyright": "© 2026 Manish Kumar",
  "privacyPolicyURL": "https://github.com/mkbhardwas12/prismos-ai/blob/main/PRIVACY.md",
  "supportURL": "https://github.com/mkbhardwas12/prismos-ai/issues"
}
```

### Step 4: Create App Icons

iOS requires multiple icon sizes. Create icons at:

```
src-tauri/icons/ios/
├── AppIcon.appiconset/
│   ├── icon-20@2x.png      (40x40)
│   ├── icon-20@3x.png      (60x60)
│   ├── icon-29@2x.png      (58x58)
│   ├── icon-29@3x.png      (87x87)
│   ├── icon-40@2x.png      (80x80)
│   ├── icon-40@3x.png      (120x120)
│   ├── icon-60@2x.png      (120x120)
│   ├── icon-60@3x.png      (180x180)
│   ├── icon-76.png         (76x76)
│   ├── icon-76@2x.png      (152x152)
│   ├── icon-83.5@2x.png    (167x167)
│   └── icon-1024.png       (1024x1024)
```

Use `iconutil` or online generators to create all sizes from your base icon.

### Step 5: Build iOS App

```bash
# Development build
npx tauri ios build --debug

# Release build (for App Store)
npx tauri ios build --release

# Build opens in Xcode
```

### Step 6: Archive and Submit

**In Xcode:**

1. Open `src-tauri/gen/apple/PrismOS-AI.xcodeproj`
2. Select target device: "Any iOS Device"
3. Product → Archive
4. Click "Distribute App"
5. Choose "App Store Connect"
6. Select "Upload"
7. Follow prompts to submit

**Via Xcode Cloud (Alternative):**

1. Set up Xcode Cloud in App Store Connect
2. Connect GitHub repository
3. Configure workflow:
   ```yaml
   name: iOS Build
   on:
     push:
       tags:
         - 'v*'
   ```

### Step 7: App Store Connect Submission

**In App Store Connect:**

1. **App Information**
   - Name: PrismOS-AI
   - Subtitle: Local-First Agentic AI
   - Category: Productivity
   - Privacy Policy URL

2. **Pricing and Availability**
   - Price: Free
   - Availability: All territories

3. **App Store Screenshots**
   - 6.7" (iPhone 14 Pro Max): 1290 x 2796 px
   - 6.5" (iPhone 11 Pro Max): 1242 x 2688 px
   - 5.5" (iPhone 8 Plus): 1242 x 2208 px
   - iPad Pro (12.9"): 2048 x 2732 px

4. **App Preview Video** (Optional)
   - 15-30 seconds
   - Showcase key features

5. **Description**
   ```
   PrismOS-AI — Local-First Agentic Personal AI Operating System

   Your private AI assistant that runs 100% on your device. No cloud,
   no tracking, no data sharing. Ever.

   FEATURES:
   • 8 collaborative AI agents working together
   • Persistent 7D Spectrum Graph knowledge memory
   • Local vision analysis for images
   • Document analysis (PDF, DOCX, PPTX, XLSX)
   • Voice input and output
   • Fully offline — your data never leaves your device

   PRIVACY FIRST:
   All AI processing happens locally using Ollama models. Zero telemetry,
   zero cloud dependencies. Your conversations, files, and knowledge graph
   stay on your device.

   PATENT PENDING:
   PrismOS-AI's core architectures (Spectrum Graph, Refractive Core,
   You-Port) are protected by US Provisional Patent.

   REQUIREMENTS:
   • Ollama installed (https://ollama.com)
   • At least one LLM model downloaded
   • 4GB+ RAM recommended
   ```

6. **Keywords**
   ```
   AI, privacy, local-first, knowledge graph, personal assistant,
   offline AI, agentic, LLM, Ollama, private
   ```

7. **Support URL**
   ```
   https://github.com/mkbhardwas12/prismos-ai
   ```

8. **Marketing URL** (Optional)
   ```
   https://github.com/mkbhardwas12/prismos-ai
   ```

### Step 8: App Review Preparation

**Provide Test Credentials:**

Since PrismOS requires Ollama, provide test environment setup:

```
TEST ENVIRONMENT SETUP:
1. Install Ollama from https://ollama.com
2. Run: ollama pull llama3.2
3. Start Ollama service
4. Launch PrismOS-AI

DEMO CREDENTIALS: N/A (no account system)

SPECIAL NOTES:
- App requires local Ollama installation for AI features
- All processing happens on-device
- No network calls to external APIs
```

### Step 9: Submit for Review

1. Click "Submit for Review"
2. Answer questionnaires:
   - **Export Compliance**: No encryption (or declare if using AES-256-GCM)
   - **Content Rights**: You own all content
   - **Advertising Identifier**: No
3. Wait 24-48 hours for review

### Common Rejection Reasons

1. **Functionality not obvious**: Add onboarding explaining Ollama requirement
2. **Privacy concerns**: Emphasize local-first nature
3. **Missing features**: Ensure all advertised features work

---

## Android Google Play Store Deployment

### Prerequisites

1. **Google Play Console Account** ($25 one-time fee)
   - Sign up at: https://play.google.com/console/signup

2. **Development Environment**
   - Java JDK 17+
   - Android SDK 33+
   - Android NDK r25+

### Step 1: Initialize Tauri Android Project

```bash
# Install Android dependencies
# (Ensure ANDROID_HOME and JAVA_HOME are set)

# Initialize Tauri Android
npx tauri android init

# This creates: src-tauri/gen/android/
```

### Step 2: Configure Android Build

**Update `src-tauri/tauri.conf.json`:**

```json
{
  "bundle": {
    "android": {
      "minSdkVersion": 26,
      "targetSdkVersion": 33,
      "compileSdkVersion": 33
    }
  }
}
```

**Update `src-tauri/gen/android/app/build.gradle`:**

```gradle
android {
    namespace 'com.prismos.app'
    compileSdk 33

    defaultConfig {
        applicationId "com.prismos.app"
        minSdk 26
        targetSdk 33
        versionCode 1
        versionName "0.5.1"
    }

    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### Step 3: Create Signing Key

```bash
# Generate keystore
keytool -genkey -v -keystore prismos-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias prismos-key

# Save the keystore securely!
# Create keystore.properties (DO NOT commit to git)
cat > src-tauri/gen/android/keystore.properties << 'EOF'
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=prismos-key
storeFile=/path/to/prismos-release.jks
EOF
```

**Update `src-tauri/gen/android/app/build.gradle`:**

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
keystoreProperties.load(new FileInputStream(keystorePropertiesFile))

android {
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
            // ... other config
        }
    }
}
```

### Step 4: Build Android APK/AAB

```bash
# Build APK (for testing)
npx tauri android build --apk --release

# Build AAB (for Play Store submission)
npx tauri android build --aab --release

# Output:
# src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk
# src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab
```

### Step 5: Test APK Locally

```bash
# Install on connected device
adb install src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk

# Or drag-drop APK to emulator
```

### Step 6: Create Play Store Listing

**In Google Play Console:**

1. **Create App**
   - App name: PrismOS-AI
   - Default language: English (United States)
   - App or game: App
   - Free or paid: Free

2. **App Content**
   - Privacy Policy: https://github.com/mkbhardwas12/prismos-ai/blob/main/PRIVACY.md
   - Target audience: General audiences (no ads, no data collection)
   - Content rating: Everyone

3. **Store Listing**

   **Short Description** (80 chars max):
   ```
   Private AI assistant that runs 100% on your device. Local-first, no cloud.
   ```

   **Full Description** (4000 chars max):
   ```
   PrismOS-AI — Local-First Agentic Personal AI Operating System

   Your private AI assistant that runs entirely on your device. No cloud,
   no tracking, no data sharing. Ever.

   ✨ KEY FEATURES

   • 8 Collaborative AI Agents
     Orchestrator, Memory Keeper, Reasoner, Tool Smith, Sentinel, and
     specialized Email, Calendar, and Finance keepers work together to
     understand and respond to your requests.

   • 7D Spectrum Graph Knowledge Memory
     Your conversations and knowledge are stored in a persistent,
     multi-dimensional graph that grows with you.

   • Local Vision Analysis
     Analyze images using local vision models (llava, llama3.2-vision).
     No images sent to the cloud.

   • Document Analysis
     Upload and analyze PDF, DOCX, PPTX, XLSX documents entirely offline.

   • Voice Input & Output
     Hands-free interaction using local speech recognition.

   • Fully Offline
     All AI processing happens on-device using Ollama models. Zero telemetry.

   🔒 PRIVACY FIRST

   • 100% Local: All processing on your device
   • No Cloud: Zero external API calls
   • No Tracking: No telemetry, no analytics
   • No Accounts: No sign-up, no login
   • Encrypted Storage: Your data is yours alone

   📋 REQUIREMENTS

   • Android 8.0 or later
   • 2GB RAM minimum, 4GB recommended
   • 1GB free storage (plus space for AI models)
   • Ollama app installed (available separately)

   🔬 PATENT PENDING

   PrismOS-AI's core architectures (Spectrum Graph™, Refractive Core™,
   You-Port™) are protected by US Provisional Patent (Feb 2026).

   📖 OPEN SOURCE

   MIT License - https://github.com/mkbhardwas12/prismos-ai

   ⚠️ NOTE

   Android version currently has limited functionality compared to desktop.
   Full Ollama integration is experimental on mobile.

   📧 SUPPORT

   GitHub: https://github.com/mkbhardwas12/prismos-ai/issues
   ```

4. **App Category**
   - Category: Productivity
   - Tags: AI, Privacy, Knowledge Management, Personal Assistant

5. **Store Graphics**

   **Icon** (512x512 PNG):
   - Transparent background or solid color
   - No text in icon

   **Feature Graphic** (1024x500 PNG):
   - Eye-catching banner
   - Showcase app name and key feature

   **Screenshots** (at least 2):
   - Phone: 16:9 aspect ratio (1080x1920 or 1080x2340)
   - Tablet (optional): 16:9 aspect ratio
   - Show main features: Intent Console, Spectrum Graph, Dashboard

   **Promo Video** (Optional, YouTube):
   - 30-second demo on YouTube
   - Paste YouTube URL

### Step 7: App Releases

**In Google Play Console → Production → Releases:**

1. Click "Create new release"
2. Upload `app-release.aab`
3. Release name: `0.5.1`
4. Release notes:
   ```
   PrismOS-AI v0.5.1 — Initial Release

   Features:
   • 8 collaborative AI agents
   • 7D Spectrum Graph knowledge memory
   • Local vision and document analysis
   • Voice input and output
   • Fully offline — 100% local processing

   Requirements:
   • Ollama app for AI models
   • 2GB+ RAM recommended
   ```
5. Save → Review release → Start rollout to Production

### Step 8: Content Rating Questionnaire

Answer truthfully:
- **Violence**: None
- **Sexual content**: None
- **Language**: None
- **Controlled substances**: None
- **Gambling**: None
- **User-generated content**: No
- **Realistic violence**: None
- **Horror**: None

Result: **Everyone** or **Everyone 10+**

### Step 9: Data Safety

**Data Collection:**
- No data collected
- No data shared with third parties
- No data used for analytics

**Security Practices:**
- Data encrypted in transit: N/A (fully local)
- Data encrypted at rest: Yes (AES-256-GCM for exports)
- Users can request data deletion: Yes (via app settings)

### Step 10: Submit for Review

1. Complete all required sections
2. Click "Send for review"
3. Wait 1-7 days for approval

### Common Rejection Reasons

1. **Missing privacy policy**: Ensure URL is accessible
2. **Functionality issues**: Test thoroughly on multiple devices
3. **Misleading descriptions**: Be accurate about features

---

## Desktop Distribution

### Windows Microsoft Store (Optional)

1. **Create Microsoft Partner Account** (free for individuals)
2. **Package as MSIX**:
   ```bash
   # Tauri supports MSIX output
   npm run tauri build -- --target msix
   ```
3. **Submit via Partner Center**:
   - https://partner.microsoft.com/dashboard

### macOS App Store (Optional)

Similar to iOS process, but using Mac Catalyst or macOS target.

### Linux Package Repositories

**Snap Store:**
```bash
# Create snapcraft.yaml
snapcraft

# Publish
snapcraft upload --release=stable prismos_*.snap
```

**Flathub:**
```bash
# Create flatpak manifest
flatpak-builder build-dir com.prismos.app.yml

# Submit to Flathub via PR
```

---

## GitHub Releases

### Automated Release Workflow

The project already has `.github/workflows/release.yml` configured for automated builds.

**To trigger a release:**

```bash
# 1. Update version in package.json and Cargo.toml
npm version 0.5.2

# 2. Commit and tag
git add .
git commit -m "release: v0.5.2"
git tag v0.5.2

# 3. Push tag (triggers release workflow)
git push origin v0.5.2
```

**Workflow builds:**
- Windows: `.msi`, `.exe`
- macOS: `.dmg` (Apple Silicon + Intel)
- Linux: `.deb`, `.AppImage`
- Android: `.apk`

### Manual GitHub Release

1. Go to: https://github.com/mkbhardwas12/prismos-ai/releases/new
2. Tag: `v0.5.2`
3. Release title: `PrismOS-AI v0.5.2 — [Feature Name]`
4. Description:
   ```markdown
   ## PrismOS-AI v0.5.2 — [Release Name]

   ### Highlights
   - New feature 1
   - New feature 2

   ### Changes
   - Changed X
   - Fixed Y

   ### Downloads
   - **Windows**: `.msi` or `.exe`
   - **macOS**: `.dmg` (Apple Silicon / Intel)
   - **Linux**: `.deb` or `.AppImage`
   - **Android**: `.apk`

   ### Requirements
   - Ollama installed with at least one model

   ### Installation
   See [INSTALLATION.md](docs/INSTALLATION.md)
   ```
5. Upload built artifacts
6. Check "Set as latest release"
7. Publish

---

## Release Checklist

### Pre-Release

- [ ] Update version in `package.json`
- [ ] Update version in `src-tauri/Cargo.toml`
- [ ] Update version in `src-tauri/tauri.conf.json`
- [ ] Update `CHANGELOG.md` with release notes
- [ ] Run full test suite: `npm test && cd src-tauri && cargo test`
- [ ] Build locally and test all platforms
- [ ] Update documentation if needed
- [ ] Update screenshots if UI changed

### Release

- [ ] Tag release: `git tag vX.X.X`
- [ ] Push tag: `git push origin vX.X.X`
- [ ] Wait for GitHub Actions to build
- [ ] Download and test all artifacts
- [ ] Create GitHub Release with notes
- [ ] Update `latest.json` for auto-updater

### Post-Release

- [ ] Submit to iOS App Store (if applicable)
- [ ] Submit to Google Play Store (if applicable)
- [ ] Submit to Microsoft Store (if applicable)
- [ ] Announce on GitHub Discussions
- [ ] Update README.md badges
- [ ] Tweet/social media announcement (optional)

### iOS Specific

- [ ] Increment build number in Xcode
- [ ] Archive and upload to App Store Connect
- [ ] Fill out "What's New" section
- [ ] Submit for review
- [ ] Monitor review status

### Android Specific

- [ ] Increment `versionCode` in `build.gradle`
- [ ] Build signed AAB
- [ ] Upload to Google Play Console
- [ ] Fill out release notes
- [ ] Start rollout to production
- [ ] Monitor crash reports

---

## Continuous Deployment

### GitHub Actions Setup

**Automated Release on Tag:**

The existing `.github/workflows/release.yml` handles:
1. Build for all platforms
2. Create GitHub Release
3. Upload artifacts
4. Generate `latest.json` for auto-updater

**Manual Trigger:**

```bash
# Trigger workflow manually
gh workflow run release.yml -f version=v0.5.2
```

### Auto-Updater Configuration

**Update `src-tauri/tauri.conf.json`:**

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/mkbhardwas12/prismos-ai/releases/latest/download/latest.json"
      ],
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

**Generate signing keys:**

```bash
# Generate key pair for signing updates
npx @tauri-apps/cli generate-key

# Add public key to tauri.conf.json
# Keep private key secret (use GitHub Secrets)
```

**Create `latest.json`:**

```json
{
  "version": "0.5.2",
  "notes": "Release notes here",
  "pub_date": "2026-03-04T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/.../prismos_0.5.2_x64_en-US.msi.zip"
    },
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/.../PrismOS-AI_0.5.2_aarch64.dmg.tar.gz"
    },
    "linux-x86_64": {
      "signature": "...",
      "url": "https://github.com/.../prismos_0.5.2_amd64.AppImage.tar.gz"
    }
  }
}
```

---

## Monitoring & Analytics

### Crash Reporting

**iOS**: Xcode Organizer → Crashes

**Android**: Google Play Console → Quality → Crashes

**Desktop**: Implement Sentry or custom telemetry (opt-in only)

### Update Adoption

Monitor download counts on GitHub Releases:
```bash
gh release view v0.5.2 --json assets
```

---

## Support & Maintenance

### User Support Channels

1. **GitHub Issues**: Bug reports and feature requests
2. **GitHub Discussions**: Q&A and community support
3. **Email**: support@prismos.ai (if applicable)

### Update Frequency

- **Patch releases** (0.5.x): Bug fixes, monthly
- **Minor releases** (0.x.0): New features, quarterly
- **Major releases** (x.0.0): Breaking changes, annually

---

## Legal & Compliance

### Patent Notice

All distribution materials must include:
```
Patent Pending — US Provisional Patent filed February 2026
```

### Open Source License

Include MIT License text in all distributions:
- iOS: Settings.bundle → Acknowledgements
- Android: About screen
- Desktop: Help → About

### Privacy Compliance

**GDPR**: No data collection = automatically compliant

**CCPA**: No data sale = automatically compliant

**App Store Privacy**: Declare "No data collected"

---

**PrismOS-AI v0.5.1** — Ready for global distribution

Questions? Open an issue on GitHub or contact the maintainer.
