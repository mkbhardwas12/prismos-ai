# Android Production Setup for PrismOS-AI

> [!WARNING]
> **Planning document; the current Android target, Google Play submission, and
> release claims below have not been validated end to end.** Do not submit the
> sample privacy or store copy as-is. Revalidate browser/WebView speech behavior,
> model downloads, permissions, signing, and every network boundary for the exact
> artifact and target OS.

---

## Prerequisites

1. **Google Play Console Account** ($25 one-time registration)
   - Sign up at: https://play.google.com/console/signup

2. **Development Environment**:
   - Java JDK 17+
   - Android SDK 33+
   - Android NDK r29+
   - Rust with Android targets

3. **Signing Credentials**:
   - Keystore file (.jks)
   - Keystore password
   - Key alias and password

---

## Step 1: Environment Setup

### Install Java

```bash
# Ubuntu/Debian
sudo apt-get install openjdk-17-jdk

# macOS
brew install openjdk@17

# Windows
# Download from https://adoptium.net/
```

### Install Android SDK

```bash
# Using Android Studio (recommended)
# Download from https://developer.android.com/studio

# Or using command-line tools
wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip
unzip commandlinetools-linux-9477386_latest.zip -d $HOME/Android/cmdline-tools
```

### Set Environment Variables

```bash
# Add to ~/.bashrc or ~/.zshrc

export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export NDK_HOME=$ANDROID_HOME/ndk/29.0.13846066
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

### Install Android NDK

```bash
sdkmanager --install "ndk;29.0.13846066"
sdkmanager --install "platforms;android-33"
sdkmanager --install "build-tools;33.0.2"
```

### Add Rust Android Targets

```bash
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi
rustup target add i686-linux-android
rustup target add x86_64-linux-android
```

---

## Step 2: Initialize Android Project

```bash
# Navigate to project root
cd prismos-ai

# Initialize Tauri Android
npx tauri android init

# This creates:
# src-tauri/gen/android/
# src-tauri/gen/android/app/
# src-tauri/gen/android/app/build.gradle
# src-tauri/gen/android/app/src/main/AndroidManifest.xml
```

---

## Step 3: Configure build.gradle

### Update `src-tauri/gen/android/app/build.gradle`

```gradle
plugins {
    id 'com.android.application'
    id 'org.jetbrains.kotlin.android'
}

android {
    namespace 'com.prismos.app'
    compileSdk 33

    defaultConfig {
        applicationId "com.prismos.app"
        minSdk 26
        targetSdk 33
        versionCode 2
        versionName "0.5.2"

        ndk {
            abiFilters 'arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'
        }
    }

    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'

            // Production build config
            debuggable false
            jniDebuggable false
            renderscriptDebuggable false
            zipAlignEnabled true
        }
        debug {
            minifyEnabled false
            debuggable true
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_11
        targetCompatibility JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = '11'
    }

    buildFeatures {
        buildConfig true
    }

    packagingOptions {
        resources {
            excludes += '/META-INF/{AL2.0,LGPL2.1}'
        }
    }
}

dependencies {
    implementation 'androidx.core:core-ktx:1.10.1'
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.9.0'

    testImplementation 'junit:junit:4.13.2'
    androidTestImplementation 'androidx.test.ext:junit:1.1.5'
    androidTestImplementation 'androidx.test.espresso:espresso-core:3.5.1'
}
```

---

## Step 4: Create Signing Configuration

### Generate Release Keystore

```bash
# Generate new keystore (SAVE THIS SECURELY!)
keytool -genkey -v -keystore ~/prismos-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias prismos-key \
  -storepass YOUR_STORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD \
  -dname "CN=Your Name, OU=PrismOS, O=PrismOS-AI, L=YourCity, ST=YourState, C=US"

# Verify keystore
keytool -list -v -keystore ~/prismos-release.jks
```

**IMPORTANT**:
- Store keystore file safely (never commit to git)
- Store passwords in secure password manager
- Backup keystore — if lost, you cannot update your app!

### Create keystore.properties

Create `src-tauri/gen/android/keystore.properties` (DO NOT commit to git):

```properties
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=prismos-key
storeFile=/path/to/prismos-release.jks
```

### Update build.gradle with Signing Config

Add to `src-tauri/gen/android/app/build.gradle`:

```gradle
// Load keystore properties
def keystorePropertiesFile = rootProject.file("../keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    // ... existing config

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
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### Add to .gitignore

```bash
echo "src-tauri/gen/android/keystore.properties" >> .gitignore
echo "*.jks" >> .gitignore
echo "*.keystore" >> .gitignore
```

---

## Step 5: Configure AndroidManifest.xml

### Update `src-tauri/gen/android/app/src/main/AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.prismos.app">

    <!-- Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
        android:maxSdkVersion="28" />
    <uses-permission android:name="android.permission.CAMERA" />

    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />

    <application
        android:name=".PrismOSApplication"
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.PrismOS"
        android:hardwareAccelerated="true"
        android:usesCleartextTraffic="true">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|screenLayout|uiMode"
            android:launchMode="singleTask"
            android:windowSoftInputMode="adjustResize">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <!-- File provider for document access -->
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
    </application>

</manifest>
```

---

## Step 6: Configure ProGuard Rules

### Create `src-tauri/gen/android/app/proguard-rules.pro`

```proguard
# Keep Tauri classes
-keep class com.tauri.** { *; }
-keep class rust.** { *; }

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep WebView classes
-keepclassmembers class fqcn.of.javascript.interface.for.webview {
   public *;
}

# Keep Parcelable
-keepclassmembers class * implements android.os.Parcelable {
    static ** CREATOR;
}

# Kotlin
-dontwarn kotlin.**
-keepclassmembers class kotlin.** { *; }

# Ollama integration
-keep class com.prismos.app.ollama.** { *; }

# Prevent R8 from removing constructors
-keepclasseswithmembers class * {
    public <init>(...);
}

# Keep enum classes
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Logging
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
}
```

---

## Step 7: Build Production APK/AAB

### Build AAB (for Play Store)

```bash
# Build release AAB (Android App Bundle)
npx tauri android build --aab --release -- --features vendored-ssl

# Output:
# src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab
```

### Build APK (for testing/sideload)

```bash
# Build release APK
npx tauri android build --apk --release -- --features vendored-ssl

# Output:
# src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk
```

### Verify Signing

```bash
# Check AAB signature
jarsigner -verify -verbose -certs \
  src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab

# Check APK signature
jarsigner -verify -verbose -certs \
  src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk

# Should show: "jar verified."
```

---

## Step 8: Google Play Console Setup

### Create App

1. Go to https://play.google.com/console
2. Create app → Fill details:
   - **App name**: PrismOS-AI
   - **Default language**: English (United States)
   - **App or game**: App
   - **Free or paid**: Free
   - **Declarations**: Accept all

### Set up App Access

**Privacy Policy:**
```
https://github.com/mkbhardwas12/prismos-ai/blob/main/PRIVACY.md
```

Content:
```
Privacy Policy for PrismOS-AI

Last updated: August 1, 2026

The canonical source notice is the linked PRIVACY.md file. This abbreviated
planning excerpt does not replace exact-artifact review.

PrismOS-AI is a local-first application. The app does not include analytics,
advertising, or telemetry. Core chat inference is restricted to a fixed-loopback
Ollama endpoint.

NETWORK BOUNDARY
- Model downloads require network access
- Explicitly enabled remote features may transmit data to the selected provider
- Store, operating-system, and distribution services may process their own data
- Confirm these statements against the exact submitted build and providers

LOCAL DATA
- Conversations and the knowledge graph are stored in the app's local database
- The live database is permission-restricted but is not encrypted at rest
- Private Vault recovery candidates use authenticated encryption and require a clean-profile restore drill before reliance

PERMISSIONS:
- Internet: Loopback Ollama, model downloads, platform speech, and explicit remote-management opt-in
- Microphone: Optional browser/WebView speech input; provider network behavior varies
- Storage: User-selected attachments; analysis uses the documented parser and inference boundaries
- Camera: User-initiated image capture; analysis uses fixed-loopback inference

CONTACT: https://github.com/mkbhardwas12/prismos-ai/issues

Review this notice for every release and target jurisdiction; local-first design
does not by itself establish legal or app-store compliance.
```

### Data Safety Section

**Data Collection / Sharing**: Determine from the exact submitted build,
configured providers, store SDKs, crash reporting, model downloads, and optional
remote features. Do not answer “No” solely because core chat is loopback.

**Security Practices**:
- ✅ Core inference transport: fixed loopback
- ⚠️ Live database: permission-restricted, not encrypted at rest
- ⚠️ Private Vault recovery candidates: AES-256-GCM authenticated encryption; clean-profile restore drill required before reliance
- ✅ Users can request data deletion: Yes (via app settings)
- ⚠️ Google Play Families Policy: Review applicability and verify every
  requirement before making a declaration
- ⚠️ Independent security review: not represented by this planning guide

### App Content

**Target Audience**:
- Primary: 18+
- Secondary: None

**News App**: No

**COVID-19 Contact Tracing**: No

**Data Safety Declarations**:
- No ads
- Determine collection and sharing answers from the exact submitted build and
  every configured provider; core loopback inference is not sufficient evidence
  for a blanket “No data collected” declaration

**Content Rating**:
Complete the questionnaire accurately; Google Play determines the rating.

---

## Step 9: Store Listing

### Main Store Listing

**App name** (max 30 chars):
```
PrismOS-AI
```

**Short description** (max 80 chars):
```
Local-first AI with fixed-loopback chat and encrypted recovery exports.
```

**Full description** (max 4000 chars):
```
PrismOS-AI — Local-First Desktop Assistant with Bounded Sequential Workflows

Your local-first AI assistant. Core chat uses fixed-loopback Ollama; model
downloads and explicitly enabled remote features use the network.

✨ KEY FEATURES

• 5 Core Software Roles
  Orchestrator, Memory Keeper, Reasoner, Tool Smith, and Sentinel participate in
  a bounded sequential plan → build → judge → refine workflow. Email, Calendar,
  and Finance integrations are not active in this release.

• Spectrum Graph Knowledge Memory
  Approved knowledge, successful conversations, and explicit feedback are stored in a persistent local SQLite graph.

• Fixed-Loopback Vision Analysis
  Analyze images through the loopback Ollama inference boundary.

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
  After required models are installed, core inference uses fixed-loopback Ollama.

🔒 PRIVACY FIRST

• Local-First Core: Chat inference is restricted to fixed loopback
• Explicit Egress: Downloads, platform speech, and remote model management change the boundary
• No PrismOS Telemetry: No first-party analytics or application telemetry endpoint
• No Accounts: No sign-up, no login
• Recovery Candidates: Private Vault packages use authenticated encryption; the
  live SQLite database is not encrypted at rest, and a clean-profile restore drill
  is required before reliance

📋 REQUIREMENTS

• Android 8.0 or later
• 2GB RAM minimum, 4GB recommended
• 1GB free storage (plus space for AI models)

📖 OPEN SOURCE

MIT License - https://github.com/mkbhardwas12/prismos-ai

⚠️ IMPORTANT NOTE

Android functionality remains experimental and has not been validated end to end. Desktop is the primary implemented target, with limitations documented in the README, security policy, and release guidance.

📧 SUPPORT

GitHub: https://github.com/mkbhardwas12/prismos-ai/issues
```

**App category**:
- Primary: Productivity
- Secondary: None

**Tags** (max 5):
```
AI, Privacy, Knowledge Management, Personal Assistant, Local-First
```

---

## Step 10: Graphics Assets

### App Icon

**Requirements**:
- Size: 512 x 512 px
- Format: PNG (32-bit)
- No transparency
- No rounded corners (Google Play adds them)

**Create:**
```bash
# From your existing icon
convert icons/icon.png -resize 512x512 playstore-icon.png
```

### Feature Graphic

**Requirements**:
- Size: 1024 x 500 px
- Format: PNG or JPG
- No transparency

**Template:**
- Background: Gradient or solid color matching brand
- Text: "PrismOS-AI — Local-First Desktop Assistant"
- Visual: App screenshot or icon

### Screenshots

**Phone (Required)**:
- At least 2, max 8 screenshots
- Size: 16:9 aspect ratio
- Recommended: 1080 x 1920 px

**Suggested Screenshots**:
1. Intent Console with example query
2. Spectrum Graph visualization
3. Daily Dashboard
4. Settings panel

**Tablet (Optional but recommended)**:
- At least 2, max 8 screenshots
- Size: 16:9 aspect ratio
- Recommended: 1080 x 1920 px

### Promo Video (Optional)

**Requirements**:
- YouTube video link
- 30 seconds to 2 minutes
- Demonstrates key features

---

## Step 11: Release Preparation

### Internal Testing Track

1. Play Console → Testing → Internal testing
2. Create release
3. Upload AAB
4. Add release notes:

```
PrismOS-AI v0.5.2 — Internal Test Build

Features to test:
• Intent Console input and response
• Spectrum Graph visualization
• Document upload functionality
• Voice input
• Settings panel

Known issues:
• Ollama integration experimental on Android
• Some desktop features not yet available

Please report bugs via GitHub Issues.
```

4. Add internal testers (email addresses)
5. Save and review release
6. Start rollout

### Production Track

> **Placeholder only:** this repository does not document a verified Android
> production release. Replace the text below only after testing the exact signed
> artifact, providers, permissions, privacy behavior, and restore workflow.

After testing is complete:

1. Play Console → Production
2. Create new release
3. Upload signed AAB
4. Release notes:

```
PrismOS-AI — Placeholder Android Release Notes

Local-first AI with fixed-loopback core inference.

NEW:
• 5 core software roles in a bounded sequential workflow
• Persistent local SQLite graph memory
• Fixed-loopback vision and document analysis
• Voice input and output
• Offline-capable core after required models are installed

PRIVACY:
• Core chat restricted to fixed loopback
• Optional downloads and remote features have explicit egress
• No first-party PrismOS application telemetry
• Encrypted Private Vault recovery candidates; live database is not encrypted at
  rest, and a clean-profile restore drill is required before reliance

REQUIREMENTS:
• Android 8.0+
• 2GB+ RAM
• Compatible AI models (app will guide setup)

Support: https://github.com/mkbhardwas12/prismos-ai
```

5. Review release → Start rollout to production

---

## Step 12: Post-Release

### Monitor Crashes

- Play Console → Quality → Crashes and ANRs
- Set up email alerts for crashes
- Fix critical bugs in patch releases

### User Reviews

- Respond to user reviews within 7 days
- Address common issues in updates

### Update Rollout

For future releases:

```bash
# Increment versionCode and versionName in build.gradle
versionCode 2
versionName "0.5.2"

# Build new AAB
npx tauri android build --aab --release

# Upload to Play Console → Create new release
```

---

## CI/CD Integration

### GitHub Actions for Android

Create `.github/workflows/android-release.yml`:

```yaml
name: Android Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install NDK
        run: sdkmanager --install "ndk;29.0.13846066"

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24.18.1

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android

      - name: Decode Keystore
        run: |
          echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 --decode > $HOME/prismos-release.jks

      - name: Create keystore.properties
        run: |
          echo "storePassword=${{ secrets.KEYSTORE_STORE_PASSWORD }}" > src-tauri/gen/android/keystore.properties
          echo "keyPassword=${{ secrets.KEYSTORE_KEY_PASSWORD }}" >> src-tauri/gen/android/keystore.properties
          echo "keyAlias=prismos-key" >> src-tauri/gen/android/keystore.properties
          echo "storeFile=$HOME/prismos-release.jks" >> src-tauri/gen/android/keystore.properties

      - name: Install dependencies
        run: npm ci

      - name: Initialize Android
        run: npx tauri android init

      - name: Build AAB
        run: npx tauri android build --aab --release -- --features vendored-ssl
        env:
          NDK_HOME: ${{ env.ANDROID_HOME }}/ndk/29.0.13846066

      - name: Upload AAB
        uses: actions/upload-artifact@v4
        with:
          name: prismos-android-aab
          path: src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab

      - name: Upload to Play Store
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: com.prismos.app
          releaseFiles: src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab
          track: production
          status: completed
```

**GitHub Secrets to Add**:
- `KEYSTORE_BASE64`: Base64-encoded keystore file
- `KEYSTORE_STORE_PASSWORD`: Store password
- `KEYSTORE_KEY_PASSWORD`: Key password
- `PLAY_SERVICE_ACCOUNT_JSON`: Google Play service account JSON

---

## Troubleshooting

### Build Issues

**"SDK location not found"**:
```bash
export ANDROID_HOME=$HOME/Android/Sdk
```

**"NDK not found"**:
```bash
sdkmanager --install "ndk;29.0.13846066"
export NDK_HOME=$ANDROID_HOME/ndk/29.0.13846066
```

**"Keystore not found"**:
Check `keystore.properties` path is absolute, not relative.

### Play Console Issues

**"App not signed"**:
Verify signing config in build.gradle and keystore.properties.

**"Version code must be higher"**:
Increment `versionCode` in build.gradle.

**"Permissions not declared"**:
Add all required permissions to AndroidManifest.xml.

---

## Resources

- **Google Play Console**: https://play.google.com/console
- **Android Developers**: https://developer.android.com/
- **Tauri Android Guide**: https://v2.tauri.app/develop/mobile/android
- **Play Console Help**: https://support.google.com/googleplay/android-developer

---

**PrismOS-AI on Android** — Privacy-first AI in your pocket

Questions? Open an issue on GitHub.
