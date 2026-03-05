# iOS Build Setup Guide for PrismOS-AI

> Complete guide for setting up iOS builds and App Store submission

---

## Prerequisites

### Required

1. **macOS** (Big Sur 11.0 or later)
2. **Xcode** (14.0 or later) - Download from Mac App Store
3. **Apple Developer Account** ($99/year) - https://developer.apple.com/programs/
4. **CocoaPods** - `sudo gem install cocoapods`
5. **Tauri CLI** with iOS support - `npm install -g @tauri-apps/cli@next`

### Verify Installation

```bash
# Check Xcode
xcodebuild -version

# Check CocoaPods
pod --version

# Check Rust targets for iOS
rustup target list | grep ios
```

---

## Step 1: Add iOS Targets to Rust

```bash
# Add iOS targets
rustup target add aarch64-apple-ios      # iOS devices (iPhone, iPad)
rustup target add x86_64-apple-ios       # iOS Simulator (Intel)
rustup target add aarch64-apple-ios-sim  # iOS Simulator (Apple Silicon)
```

---

## Step 2: Initialize Tauri iOS Project

```bash
# Navigate to project root
cd /path/to/prismos-ai

# Initialize iOS project (Tauri 2.1+)
npx tauri ios init

# This creates:
# src-tauri/gen/apple/
# src-tauri/gen/apple/PrismOS-AI.xcodeproj
# src-tauri/gen/apple/Assets.xcassets/
# src-tauri/gen/apple/Info.plist
```

**If the command fails**, ensure you have Tauri 2.1 or later:

```bash
npm install @tauri-apps/cli@latest
npm install @tauri-apps/api@latest
```

---

## Step 3: Configure Tauri for iOS

### Update `src-tauri/tauri.conf.json`

Add iOS-specific configuration:

```json
{
  "productName": "PrismOS-AI",
  "version": "0.5.1",
  "identifier": "com.prismos.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "iOS": {
      "developmentTeam": "YOUR_TEAM_ID_HERE",
      "minimumSystemVersion": "13.0",
      "frameworks": [],
      "exceptionDomain": "localhost"
    }
  }
}
```

**Find your Team ID:**

1. Open Xcode → Preferences → Accounts
2. Select your Apple ID
3. View team details → Copy Team ID

---

## Step 4: Update Cargo.toml for iOS

### Add iOS Dependencies to `src-tauri/Cargo.toml`

```toml
[package]
name = "prismos"
version = "0.5.1"
description = "PrismOS-AI — Local-First Agentic Personal AI Operating System (Patent Pending)"
authors = ["PrismOS-AI Contributors"]
edition = "2021"

[lib]
name = "prismos_lib"
crate-type = ["staticlib", "cdylib", "rlib", "lib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon", "ios"] }
tauri-plugin-shell = "2"
# ... rest of existing dependencies

# iOS-specific dependencies
[target.'cfg(target_os = "ios")'.dependencies]
tauri = { version = "2", features = ["ios", "tray-icon"] }

# Disable certain features on iOS (WASM, some system APIs)
[target.'cfg(not(target_os = "ios"))'.dependencies]
wasmtime = "27"
xcap = "0.8"
cpal = "0.15"

[features]
default = []
vendored-ssl = ["openssl"]
ios = []
```

---

## Step 5: Create iOS Icon Assets

iOS requires specific icon sizes. Create these PNG files:

### Icon Sizes Required

```
src-tauri/icons/ios/AppIcon.appiconset/
├── Contents.json
├── icon-20@2x.png      (40x40)
├── icon-20@3x.png      (60x60)
├── icon-29@2x.png      (58x58)
├── icon-29@3x.png      (87x87)
├── icon-40@2x.png      (80x80)
├── icon-40@3x.png      (120x120)
├── icon-60@2x.png      (120x120)
├── icon-60@3x.png      (180x180)
├── icon-76.png         (76x76)
├── icon-76@2x.png      (152x152)
├── icon-83.5@2x.png    (167x167)
└── icon-1024.png       (1024x1024)
```

### Create Icons Script

Save as `scripts/generate-ios-icons.sh`:

```bash
#!/bin/bash
# Generate iOS icons from a single 1024x1024 PNG

SOURCE_ICON="icons/icon.png"
OUTPUT_DIR="src-tauri/icons/ios/AppIcon.appiconset"

mkdir -p "$OUTPUT_DIR"

# Generate all sizes using ImageMagick or sips
sips -z 40 40     "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-20@2x.png"
sips -z 60 60     "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-20@3x.png"
sips -z 58 58     "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-29@2x.png"
sips -z 87 87     "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-29@3x.png"
sips -z 80 80     "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-40@2x.png"
sips -z 120 120   "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-40@3x.png"
sips -z 120 120   "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-60@2x.png"
sips -z 180 180   "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-60@3x.png"
sips -z 76 76     "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-76.png"
sips -z 152 152   "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-76@2x.png"
sips -z 167 167   "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-83.5@2x.png"
sips -z 1024 1024 "$SOURCE_ICON" --out "$OUTPUT_DIR/icon-1024.png"

echo "iOS icons generated successfully!"
```

### Run the script:

```bash
chmod +x scripts/generate-ios-icons.sh
./scripts/generate-ios-icons.sh
```

---

## Step 6: Configure Info.plist

Create or update `src-tauri/gen/apple/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>PrismOS-AI</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.5.1</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSRequiresIPhoneOS</key>
    <true/>
    <key>UILaunchStoryboardName</key>
    <string>LaunchScreen</string>
    <key>UIRequiredDeviceCapabilities</key>
    <array>
        <string>arm64</string>
    </array>
    <key>UISupportedInterfaceOrientations</key>
    <array>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <key>UISupportedInterfaceOrientations~ipad</key>
    <array>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationPortraitUpsideDown</string>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <key>UIViewControllerBasedStatusBarAppearance</key>
    <false/>
    <key>NSMicrophoneUsageDescription</key>
    <string>PrismOS-AI needs microphone access for voice input (all processing stays on-device).</string>
    <key>NSPhotoLibraryUsageDescription</key>
    <string>PrismOS-AI needs photo access to analyze images (all processing stays on-device).</string>
    <key>NSCameraUsageDescription</key>
    <string>PrismOS-AI needs camera access to capture and analyze images (all processing stays on-device).</string>
</dict>
</plist>
```

---

## Step 7: Build iOS App

### Development Build (Simulator)

```bash
# Build for simulator
npx tauri ios build --debug

# This opens Xcode automatically
# Click "Run" in Xcode to launch in simulator
```

### Release Build (Device)

```bash
# Build release version
npx tauri ios build --release

# Opens Xcode with release configuration
```

### Manual Build in Xcode

```bash
# Open project in Xcode
open src-tauri/gen/apple/PrismOS-AI.xcodeproj

# In Xcode:
# 1. Select target: PrismOS-AI
# 2. Select device: Your iPhone or Generic iOS Device
# 3. Product → Build (⌘B)
# 4. Product → Run (⌘R) to install on device
```

---

## Step 8: Code Signing

### Automatic Signing (Recommended)

1. Open Xcode project
2. Select target: PrismOS-AI
3. Go to "Signing & Capabilities" tab
4. Check "Automatically manage signing"
5. Select your Team from dropdown
6. Xcode will provision profiles automatically

### Manual Signing (Advanced)

1. Create App ID in Apple Developer Portal:
   - Identifier: `com.prismos.app`
   - Explicit App ID

2. Create Provisioning Profile:
   - Type: iOS App Development (or App Store)
   - App ID: com.prismos.app
   - Certificates: Your development certificate
   - Devices: Your test devices

3. Download and install profile

4. In Xcode:
   - Signing & Capabilities → Manual signing
   - Select profile for Debug and Release

---

## Step 9: Archive and Submit to App Store

### Create Archive

1. In Xcode, select target device: "Any iOS Device"
2. Product → Archive
3. Wait for build to complete
4. Organizer window opens automatically

### Validate Archive

1. In Organizer → Archives tab
2. Select your archive
3. Click "Validate App"
4. Choose distribution method: "App Store Connect"
5. Fix any validation errors

### Upload to App Store Connect

1. Click "Distribute App"
2. Choose: "App Store Connect"
3. Select: "Upload"
4. Click "Next" through options
5. Review and click "Upload"
6. Wait for processing (5-30 minutes)

---

## Step 10: App Store Connect Configuration

### Create App Record

1. Go to https://appstoreconnect.apple.com
2. My Apps → + → New App
3. Fill out:
   - Platform: iOS
   - Name: PrismOS-AI
   - Primary Language: English (U.S.)
   - Bundle ID: com.prismos.app
   - SKU: PRISMOS001

### App Information

- **Subtitle**: Local-First Agentic AI
- **Category**: Primary: Productivity, Secondary: Developer Tools
- **Privacy Policy URL**: https://github.com/mkbhardwas12/prismos-ai/blob/main/PRIVACY.md
- **Copyright**: © 2026 Manish Kumar

### Pricing and Availability

- **Price**: Free
- **Availability**: All countries

### Screenshots

Required sizes (use Xcode Simulator + Screenshot tool):

1. **iPhone 6.7"** (1290 x 2796):
   - Intent Console
   - Spectrum Graph
   - Daily Dashboard
   - Settings

2. **iPhone 6.5"** (1242 x 2688):
   - Same 4 screenshots

3. **iPhone 5.5"** (1242 x 2208):
   - Same 4 screenshots

4. **iPad Pro 12.9"** (2048 x 2732):
   - Landscape versions

### App Description

```
PrismOS-AI — Your Private AI Operating System

A revolutionary local-first AI assistant that runs 100% on your device.
No cloud. No tracking. No compromise.

CORE FEATURES:
• 8 Collaborative AI Agents working together
• Persistent 7D Spectrum Graph memory
• Local vision analysis for images
• Document analysis (PDF, DOCX, PPTX, XLSX)
• Voice input and output
• Fully offline — your data never leaves your device

PRIVACY FIRST:
All AI processing happens locally using on-device models.
Zero telemetry. Zero cloud dependencies. Your data is yours alone.

PATENT PENDING:
PrismOS-AI's core architectures are protected by US Provisional Patent.

REQUIREMENTS:
• iOS 13.0 or later
• 2GB+ RAM recommended
• Compatible AI models (app will guide installation)
```

### Keywords (max 100 chars)

```
AI,privacy,local,knowledge,assistant,offline,graph,agentic,personal
```

### What's New (Release Notes)

```
PrismOS-AI v0.5.1 — Initial iOS Release

Features:
• 8 collaborative AI agents
• 7D Spectrum Graph knowledge memory
• Local vision and document analysis
• Voice input and output
• Fully offline, 100% private

Note: Some desktop features are still in development for iOS.
```

### App Review Information

**Contact Information:**
- First Name: [Your First Name]
- Last Name: [Your Last Name]
- Phone: [Your Phone]
- Email: [Your Email]

**Notes for Reviewer:**

```
PrismOS-AI is a local-first AI operating system.

IMPORTANT FOR TESTING:
1. App requires compatible AI models to function
2. On first launch, the app will guide you through setup
3. All AI processing happens on-device — no external servers

DEMO INSTRUCTIONS:
1. Launch app
2. Complete onboarding wizard
3. Type a query in Intent Console (e.g., "What is AI?")
4. Explore Spectrum Graph to see knowledge visualization
5. Try voice input with microphone button

NO TEST ACCOUNT NEEDED — app has no login system.

PRIVACY:
• Zero network calls to external APIs
• All data stored locally
• No telemetry, no analytics, no tracking
```

---

## Step 11: Submit for Review

1. Complete all required fields in App Store Connect
2. Add build from TestFlight
3. Answer App Privacy questionnaire:
   - Data Collection: None
   - Tracking: No
4. Submit for Review
5. Expected review time: 24-48 hours

---

## Troubleshooting

### Build Errors

**"Signing for PrismOS-AI requires a development team"**

Solution: Add your Team ID to `tauri.conf.json`:

```json
{
  "bundle": {
    "iOS": {
      "developmentTeam": "YOUR_TEAM_ID_HERE"
    }
  }
}
```

**"Could not find or use auto-linked library"**

Solution: Clean and rebuild:

```bash
cd src-tauri/gen/apple
xcodebuild clean
cd ../../..
npx tauri ios build --release
```

**"Module 'Tauri' not found"**

Solution: Re-run pod install:

```bash
cd src-tauri/gen/apple
pod install
cd ../../..
```

### Runtime Issues

**App crashes on launch**

1. Check Xcode console for error logs
2. Verify all required capabilities are enabled
3. Check Info.plist for correct permissions

**Features not working on iOS**

Some desktop features may not work on iOS:
- WASM sandbox (limited on iOS)
- Screen capture (requires permission)
- File indexer (limited file system access)

These are expected limitations and should be documented in App Store description.

---

## Continuous Integration for iOS

### GitHub Actions Workflow

Create `.github/workflows/ios-release.yml`:

```yaml
name: iOS Release Build

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build-ios:
    runs-on: macos-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-ios,x86_64-apple-ios,aarch64-apple-ios-sim

      - name: Install CocoaPods
        run: sudo gem install cocoapods

      - name: Install frontend dependencies
        run: npm ci

      - name: Install Tauri CLI
        run: npm install -g @tauri-apps/cli@next

      - name: Initialize iOS project
        run: npx tauri ios init

      - name: Build iOS IPA
        run: npx tauri ios build --release
        env:
          APPLE_DEVELOPMENT_TEAM: ${{ secrets.APPLE_TEAM_ID }}

      - name: Upload IPA
        uses: actions/upload-artifact@v4
        with:
          name: prismos-ios-ipa
          path: src-tauri/gen/apple/build/Release-iphoneos/*.ipa
```

**Add GitHub Secrets:**
- `APPLE_TEAM_ID`: Your Apple Developer Team ID
- `APPLE_CERTIFICATE`: Base64-encoded p12 certificate
- `APPLE_CERTIFICATE_PASSWORD`: Certificate password

---

## Testing

### TestFlight Beta Testing

1. In App Store Connect, go to TestFlight
2. Select your build
3. Add Internal Testers (up to 100)
4. Or create External Test group
5. Testers receive invite via email
6. Install TestFlight app to test

### Local Testing

```bash
# Run on simulator
npx tauri ios dev --target ios-simulator

# Run on device (requires provisioning profile)
npx tauri ios dev --target ios-device
```

---

## Resources

- **Tauri iOS Guide**: https://v2.tauri.app/develop/mobile/ios
- **Apple Developer Portal**: https://developer.apple.com/
- **App Store Connect**: https://appstoreconnect.apple.com/
- **Human Interface Guidelines**: https://developer.apple.com/design/human-interface-guidelines/ios

---

## Next Steps

After iOS app is live:

1. Monitor crash reports in Xcode Organizer
2. Respond to user reviews
3. Release updates via same process
4. Consider iPad-specific optimizations
5. Explore iOS-specific features (Shortcuts, Widgets)

---

**PrismOS-AI on iOS** — Your private AI in your pocket

Questions? Open an issue on GitHub or contact the maintainer.
