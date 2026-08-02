# PrismOS-AI Deployment Guide

> [!WARNING]
> **Planning guide, not proof of production readiness.** Revalidate signing,
> notarization/store review, permissions, browser/WebView speech providers, model
> downloads, and all network boundaries against each exact release artifact.

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
  "version": "0.5.2",
  "buildNumber": "2",
  "category": "Productivity",
  "description": "Local-first desktop assistant with bounded sequential workflows",
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
   - Subtitle: Local-First Desktop Assistant
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
   PrismOS-AI — Local-First Desktop Assistant with Bounded Sequential Workflows

   Your local-first AI assistant. Core chat uses a loopback Ollama endpoint by
   default; optional model downloads and explicit remote features use the network.

   FEATURES:
   • 5 core software roles in a bounded sequential workflow
   • Persistent local SQLite graph memory with bounded retrieval
   • Local vision analysis for images
   • Bounded one-off DOCX, PPTX, and UTF-8 text/code/CSV/TSV analysis
     (convert PDF to UTF-8 text; export XLSX and legacy .xls as CSV/TSV)
   • Voice input and output
   • Offline-capable core after required models are installed

   PRIVACY FIRST:
   Private inference is fixed to loopback Ollama and PrismOS emits no telemetry.
   Model downloads, platform speech, and explicit remote model management have
   separate network boundaries. Your conversations and knowledge graph remain in
   local storage.

   REQUIREMENTS:
   • Ollama installed (https://ollama.com)
   • At least one LLM model downloaded
   • 4GB+ RAM recommended
   ```

6. **Keywords**
   ```
   AI, privacy, local-first, knowledge graph, personal assistant,
   offline AI, local-first assistant, LLM, Ollama, private
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
2. Run: ollama pull qwen3:4b
3. Start Ollama service
4. Launch PrismOS-AI

DEMO CREDENTIALS: N/A (no account system)

SPECIAL NOTES:
- App requires local Ollama installation for AI features
- Core chat uses loopback Ollama by default
- Model acquisition and explicitly enabled remote features use the network
```

### Step 9: Submit for Review

1. Click "Submit for Review"
2. Answer questionnaires:
   - **Export Compliance**: Declare the shipped cryptography accurately.
     PrismOS uses AES-256-GCM for protected exports and Private Vault packages;
     obtain jurisdiction-specific legal and store-review guidance.
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
        versionCode 2
        versionName "0.5.2"
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
   - Target audience: Select only after reviewing the shipped content, privacy
     behavior, and current Play policy (the app contains no ads)
   - Content rating: Everyone

3. **Store Listing**

   **Short Description** (80 chars max):
   ```
   Local-first AI assistant with private on-device knowledge and local chat.
   ```

   **Full Description** (4000 chars max):
   ```
   PrismOS-AI — Local-First Desktop Assistant with Bounded Sequential Workflows

   Your local-first AI assistant. Core chat uses a loopback Ollama endpoint by
   default; optional model downloads and explicit remote features use the network.

   ✨ KEY FEATURES

   • 5 Core Software Roles
     Orchestrator, Memory Keeper, Reasoner, Tool Smith, and Sentinel participate
     in a bounded sequential plan → build → judge → refine workflow. Email,
     calendar, and finance integrations are not available in this release.

   • Spectrum Graph Knowledge Memory
     Approved knowledge, successful conversations, and explicit feedback are
     stored in a persistent local SQLite graph.

   • Fixed-Loopback Vision Analysis
     Analyze images through the loopback Ollama inference boundary. Model
     downloads and explicitly enabled remote features still use the network.

   • Bounded One-Off Document Analysis
     Analyze bounded DOCX, PPTX, and allowlisted UTF-8 text/code, including
     CSV/TSV, through the fixed-loopback core. PDF extraction is disabled until
     it can be safely resource-isolated; convert PDFs to UTF-8 text. XLSX and
     legacy .xls fail closed before parsing; export spreadsheets as CSV/TSV.
     One-off attachments remain ephemeral. Project Knowledge is a separate,
     approval-gated UTF-8 text/code index.

   • Voice Input & Output
     Browser/WebView speech services when supported; provider-specific network
     behavior must be disclosed for the submitted platform.

   • Offline-Capable Core
     Core inference uses loopback Ollama by default after models are installed.

   🔒 PRIVACY FIRST

   • Local by Default: Core chat is restricted to loopback Ollama
   • Explicit Network: Downloads, platform speech, and remote model management change the boundary
   • No PrismOS Telemetry: No first-party analytics or application telemetry endpoint
   • No Accounts: No sign-up, no login
   • Recovery Candidates: Private Vault packages use authenticated encryption;
     the live SQLite database is permission-restricted but not encrypted at rest,
     and a clean-profile restore drill is required before reliance

   📋 REQUIREMENTS

   • Android 8.0 or later
   • 2GB RAM minimum, 4GB recommended
   • 1GB free storage (plus space for AI models)
   • Ollama app installed (available separately)

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
3. Release name: `0.5.2`
4. Release notes:
   ```
   PrismOS-AI — Placeholder Android Release Notes

   Features:
   • 5 core software roles in a bounded sequential workflow
   • Persistent local SQLite graph memory
   • Local vision and document analysis
   • Voice input and output
   • Offline-capable core after local models are installed

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

Submit accurate answers and use the rating assigned by the platform; do not
predict or advertise a rating before review.

### Step 9: Data Safety

**Data Collection:**
- PrismOS does not include app telemetry or analytics
- Core chat inference is restricted to loopback Ollama
- Model downloads and explicitly enabled remote features create network egress;
  complete the store declaration from the exact shipped build and providers

**Security Practices:**
- Core inference transport: fixed loopback
- Live database: OS-account permission restricted, not encrypted at rest
- Private Vault and supported export packages: AES-256-GCM authenticated encryption
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

### Manual Candidate-Artifact Workflow

`.github/workflows/release.yml` is a manually dispatched, read-only candidate
builder. It does **not** run on tags, request a write token, create or modify a
GitHub Release, sign packages, notarize macOS bundles, or publish anything.

Before any desktop candidate is built, the workflow requires frontend type
checking/tests, production npm audit, Rust check/tests/lint, and a release-
blocking Cargo audit to pass. As of 2026-08-01 the Cargo audit reports zero known
vulnerabilities and 19 reviewed maintenance/unsound warnings. The gate compares
their advisory ID, class, package, and version with the checked-in baseline. That
dated result is not a waiver: any vulnerability or warning-set change stops the
candidate until the baseline change is explicitly reviewed.

```bash
# Dispatch from the reviewed source revision; the label affects artifact names only.
gh workflow run release.yml -f version=v0.5.2-rc1

# Inspect the run. A failed security gate is a stop condition, not an override cue.
gh run list --workflow release.yml
gh run view RUN_ID
```

If every gate passes, the workflow uploads unsigned, unpublished candidates for
Windows x64, macOS arm64/x64, and Linux x64 with 14-day retention. It does not
currently build an Android release candidate.

### Manual GitHub Release

Do not begin publication until maintainers have resolved every release-blocking
test or audit, reproduced and clean-machine tested each candidate, completed
platform signing/notarization, generated and reviewed SHA-256 checksums and an
SBOM, verified install/uninstall/upgrade and Private Vault restore behavior, and
recorded explicit human release approval.

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
   - **Android**: separately built, signed, and tested `.apk`/`.aab` if approved

   ### Requirements
   - Ollama installed with at least one model

   ### Installation
   See [INSTALLATION.md](https://github.com/mkbhardwas12/prismos-ai/blob/main/docs/INSTALLATION.md)
   ```
5. Upload only approved signed/notarized artifacts, checksums, and the SBOM
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
- [ ] Resolve every npm/Cargo audit finding that blocks the candidate workflow
- [ ] Build locally and test all platforms
- [ ] Update documentation if needed
- [ ] Update screenshots if UI changed

### Release

- [ ] Manually dispatch the candidate-artifact workflow from the reviewed revision
- [ ] Confirm all test, lint, and audit gates passed without waivers
- [ ] Download and clean-machine test all unsigned candidates
- [ ] Sign Windows/Linux deliverables and sign + notarize macOS deliverables
- [ ] Generate and review an SBOM and SHA-256 checksums for final artifacts
- [ ] Record explicit maintainer approval
- [ ] Create and push the final tag; tags do not trigger or publish the workflow
- [ ] Create the GitHub Release manually with only approved artifacts

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

## Release Builds and Manual Publication

GitHub Actions may be used only to build candidate artifacts after every test,
lint, and dependency-audit gate passes. The workflow has `contents: read`, keeps
checkout credentials disabled, and cannot create a release. A maintainer must
review the workflow revision, clean-machine test candidates, complete signing
and notarization, generate and review checksums plus an SBOM, record human
approval, and publish the GitHub Release manually. The application has no
in-app update client, update manifest, or automatic installation path.

```bash
# Optional: dispatch the candidate-artifact workflow after inspecting it
gh workflow run release.yml -f version=v0.5.2-rc1

# Inspect the completed run and download artifacts for clean-machine testing
gh run list --workflow release.yml
```

Do not publish a release only because CI completed. A failed audit is a release
blocker. Confirm source/version alignment, signatures and notarization,
checksums/SBOM, install and uninstall behavior, the manual upgrade path, and
Private Vault restore instructions before publication.

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

### Open Source License

Include MIT License text in all distributions:
- iOS: Settings.bundle → Acknowledgements
- Android: About screen
- Desktop: Help → About

### Privacy and Regulatory Review

Local-first architecture and the absence of built-in telemetry can reduce data
exposure, but they do not make a release automatically compliant with GDPR,
CCPA/CPRA, export-control rules, app-store policies, or sector regulations.
Before publication, review the exact shipped build, optional network features,
data-retention behavior, privacy notices, processor relationships, user rights,
and target jurisdictions with qualified legal and compliance professionals.

Complete each App Store or Play data-safety declaration from observed behavior
of the submitted build. Do not select “No data collected” solely because core
chat uses loopback inference; model distribution, store infrastructure, crash
reporting, and optional remote features may change the required answers.

---

**PrismOS-AI v0.5.2** — Distribution planning guide; release approval remains a
maintainer, platform-review, security-review, and jurisdiction-specific decision.

Questions? Open an issue on GitHub or contact the maintainer.
