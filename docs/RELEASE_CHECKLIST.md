# PrismOS-AI Release Checklist

> Complete checklist for releasing new versions across all platforms

---

## Pre-Release Phase

### Code & Documentation

- [ ] All features for this release are complete and merged
- [ ] All tests passing (162/162):
  ```bash
  npm test  # 97 frontend tests
  cd src-tauri && cargo test  # 65 backend tests
  ```
- [ ] No failing TypeScript checks:
  ```bash
  npx tsc --noEmit
  ```
- [ ] No Rust clippy warnings:
  ```bash
  cd src-tauri && cargo clippy -- -D warnings
  ```
- [ ] CHANGELOG.md updated with new version
- [ ] README.md version badge updated
- [ ] All documentation reflects new features
- [ ] Screenshots updated if UI changed
- [ ] Demo video updated if major UI changes

### Version Bumping

- [ ] Update version in `package.json`:
  ```json
  {
    "version": "X.X.X"
  }
  ```

- [ ] Update version in `src-tauri/Cargo.toml`:
  ```toml
  [package]
  version = "X.X.X"
  ```

- [ ] Update version in `src-tauri/tauri.conf.json`:
  ```json
  {
    "version": "X.X.X"
  }
  ```

- [ ] Update version in `src-tauri/gen/android/app/build.gradle`:
  ```gradle
  defaultConfig {
      versionCode X
      versionName "X.X.X"
  }
  ```

- [ ] Commit version bump:
  ```bash
  git add .
  git commit -m "release: bump version to vX.X.X"
  ```

### Testing

- [ ] Test desktop build locally:
  ```bash
  npm run tauri build
  ```

- [ ] Test Android build locally:
  ```bash
  npx tauri android build --apk --release
  ```

- [ ] Install and test on multiple platforms:
  - [ ] Windows 10
  - [ ] Windows 11
  - [ ] macOS (Intel)
  - [ ] macOS (Apple Silicon)
  - [ ] Ubuntu 22.04
  - [ ] Android 8.0+
  - [ ] Android 13+

- [ ] Test all major features:
  - [ ] Intent Console (text input)
  - [ ] Spectrum Graph visualization
  - [ ] Vision analysis (image upload)
  - [ ] Document analysis (PDF, DOCX)
  - [ ] Voice input
  - [ ] Settings panel
  - [ ] You-Port export/import
  - [ ] Global hotkey (Ctrl+Space, Alt+Space)
  - [ ] System tray (minimize/restore)

- [ ] Test with different Ollama models:
  - [ ] llama3.2
  - [ ] mistral
  - [ ] llama3.2-vision
  - [ ] deepseek-r1

- [ ] Test auto-updater flow (if applicable)

---

## Release Phase

### Git Tagging

- [ ] Create and push git tag:
  ```bash
  git tag vX.X.X
  git push origin vX.X.X
  ```

### GitHub Actions Build

- [ ] Monitor GitHub Actions workflow:
  - https://github.com/mkbhardwas12/prismos-ai/actions

- [ ] Wait for all builds to complete (10-20 minutes):
  - [ ] Windows (.msi, .exe)
  - [ ] macOS Apple Silicon (.dmg)
  - [ ] macOS Intel (.dmg)
  - [ ] Linux (.deb, .AppImage)
  - [ ] Android (.apk)

- [ ] Download and verify all artifacts

### GitHub Release

- [ ] Go to https://github.com/mkbhardwas12/prismos-ai/releases/new

- [ ] Fill release form:
  - **Tag**: vX.X.X (select existing tag)
  - **Release title**: PrismOS-AI vX.X.X — [Release Name]
  - **Description**: Use template below

- [ ] Upload additional files:
  - [ ] Android AAB (for Play Store)
  - [ ] SHA256 checksums file
  - [ ] Source code (auto-attached)

- [ ] Check "Set as latest release"

- [ ] Click "Publish release"

**Release Description Template:**

````markdown
## PrismOS-AI vX.X.X — [Release Name]

**Patent Pending** — US Provisional Patent filed February 2026

### 🎯 Highlights

- New feature 1
- New feature 2
- Performance improvements

### ✨ What's New

**New Features:**
- Feature description with details
- Another feature with use case

**Improvements:**
- Performance optimization: 30% faster graph queries
- UI polish: smoother animations
- Better error messages

**Bug Fixes:**
- Fixed crash when importing large graphs
- Fixed vision model detection
- Fixed mobile layout on tablets

### 📦 Downloads

Choose the right installer for your platform:

| Platform | Package | Installation |
|----------|---------|--------------|
| **Windows** | `.msi` (recommended) or `.exe` | Double-click to install |
| **macOS Apple Silicon** | `_aarch64.dmg` | Drag to Applications |
| **macOS Intel** | `_x64.dmg` | Drag to Applications |
| **Linux (Debian/Ubuntu)** | `.deb` | `sudo dpkg -i prismos_*.deb` |
| **Linux (Universal)** | `.AppImage` | `chmod +x && run` |
| **Android** | `.apk` | Sideload or Play Store |

### 📋 Requirements

- **Desktop**: Windows 10+, macOS 11+, Ubuntu 20.04+ (or equivalent)
- **Mobile**: Android 8.0+
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 2GB + space for AI models
- **Ollama**: Required for desktop (https://ollama.com)

### 🚀 Quick Start

```bash
# 1. Install Ollama
# Download from https://ollama.com

# 2. Pull a model
ollama pull llama3.2

# 3. Start Ollama
ollama serve

# 4. Install PrismOS-AI
# Download installer from this release

# 5. Launch and enjoy!
```

### 📖 Documentation

- **Installation Guide**: [INSTALLATION.md](https://github.com/mkbhardwas12/prismos-ai/blob/main/docs/INSTALLATION.md)
- **User Guide**: [COMPREHENSIVE_GUIDE.md](https://github.com/mkbhardwas12/prismos-ai/blob/main/docs/COMPREHENSIVE_GUIDE.md)
- **Deployment**: [DEPLOYMENT.md](https://github.com/mkbhardwas12/prismos-ai/blob/main/docs/DEPLOYMENT.md)

### 🔒 Security & Privacy

- ✅ 100% local processing — no cloud
- ✅ Zero telemetry — no tracking
- ✅ Encrypted storage — AES-256-GCM
- ✅ Open source — MIT License

### 🧪 Testing

- **162 tests** passing (97 frontend + 65 backend)
- Tested on Windows 10/11, macOS 11-14, Ubuntu 20.04-22.04, Android 8-13

### 🐛 Known Issues

- Issue 1 description (if any)
- Workaround provided

### 🗺️ What's Next (vX.Y.0)

- Upcoming feature 1
- Upcoming feature 2
- See full [roadmap](https://github.com/mkbhardwas12/prismos-ai/blob/main/README.md#roadmap)

### 📝 Full Changelog

See [CHANGELOG.md](https://github.com/mkbhardwas12/prismos-ai/blob/main/CHANGELOG.md) for complete details.

---

**Checksums (SHA256):**

```
[Include SHA256 hashes for all downloadable files]
```

---

Built with ❤️ by [Manish Kumar](https://github.com/mkbhardwas12)
````

---

## App Store Releases

### iOS App Store (if applicable)

- [ ] Open Xcode
- [ ] Select target: "Any iOS Device"
- [ ] Product → Archive
- [ ] Wait for archive to complete
- [ ] In Organizer:
  - [ ] Validate App
  - [ ] Fix any validation errors
  - [ ] Distribute App → App Store Connect
  - [ ] Upload

- [ ] In App Store Connect:
  - [ ] Go to My Apps → PrismOS-AI
  - [ ] Add build to version
  - [ ] Update "What's New" section:
    ```
    PrismOS-AI vX.X.X

    NEW:
    • Feature 1
    • Feature 2

    IMPROVED:
    • Better performance
    • UI enhancements

    FIXED:
    • Bug fixes and stability improvements
    ```
  - [ ] Update screenshots if needed
  - [ ] Submit for Review
  - [ ] Monitor review status (24-48 hours)

### Android Play Store

- [ ] Build signed AAB:
  ```bash
  npx tauri android build --aab --release -- --features vendored-ssl
  ```

- [ ] Verify signing:
  ```bash
  jarsigner -verify -verbose -certs \
    src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab
  ```

- [ ] In Google Play Console:
  - [ ] Go to Production → Releases
  - [ ] Create new release
  - [ ] Upload AAB
  - [ ] Release notes:
    ```
    PrismOS-AI vX.X.X

    NEW:
    • Feature 1
    • Feature 2

    IMPROVED:
    • Better performance
    • UI enhancements

    FIXED:
    • Bug fixes and stability improvements

    Full changelog: github.com/mkbhardwas12/prismos-ai/releases
    ```
  - [ ] Save → Review release
  - [ ] Start rollout to Production
  - [ ] Choose rollout percentage (start with 20%, increase over days)

### Microsoft Store (optional)

- [ ] Build MSIX package:
  ```bash
  npm run tauri build -- --target msix
  ```

- [ ] In Partner Center:
  - [ ] Create submission
  - [ ] Upload MSIX
  - [ ] Update metadata
  - [ ] Submit for certification

---

## Post-Release Phase

### Verification

- [ ] Download installers from GitHub Releases
- [ ] Test installation on clean systems:
  - [ ] Windows (clean VM)
  - [ ] macOS (clean VM)
  - [ ] Linux (clean VM)
  - [ ] Android (factory reset device)

- [ ] Verify auto-updater detects new version
- [ ] Test upgrade path from previous version

### Communication

- [ ] Update README.md with latest version badge
- [ ] Post announcement in GitHub Discussions:
  - https://github.com/mkbhardwas12/prismos-ai/discussions

- [ ] Twitter/X announcement (if applicable):
  ```
  🎉 PrismOS-AI vX.X.X is here!

  ✨ New: [Feature highlights]
  🔒 100% local, privacy-first
  📦 Download: [Release URL]

  #LocalFirst #AI #Privacy
  ```

- [ ] Reddit post in relevant subreddits (if applicable):
  - r/selfhosted
  - r/opensource
  - r/privacy

- [ ] Update website (if applicable)

### Monitoring

- [ ] Monitor GitHub Issues for bug reports:
  - https://github.com/mkbhardwas12/prismos-ai/issues

- [ ] Monitor App Store reviews (iOS):
  - App Store Connect → Ratings and Reviews

- [ ] Monitor Play Store reviews (Android):
  - Play Console → Reviews

- [ ] Monitor crash reports:
  - iOS: Xcode Organizer → Crashes
  - Android: Play Console → Quality → Crashes

- [ ] Set up alerts for critical issues

### Analytics (Optional)

- [ ] Check download stats:
  ```bash
  gh release view vX.X.X --json assets
  ```

- [ ] Monitor GitHub traffic:
  - Insights → Traffic

- [ ] Track star/fork growth

---

## Hotfix Process (If Critical Bug Found)

### Immediate Response

- [ ] Create hotfix branch:
  ```bash
  git checkout -b hotfix/vX.X.Y main
  ```

- [ ] Fix critical bug
- [ ] Add regression test
- [ ] Test thoroughly
- [ ] Bump patch version (X.X.Y)
- [ ] Commit fix:
  ```bash
  git commit -m "fix: [Critical bug description]"
  ```

- [ ] Merge to main:
  ```bash
  git checkout main
  git merge hotfix/vX.X.Y
  ```

- [ ] Tag and release:
  ```bash
  git tag vX.X.Y
  git push origin vX.X.Y
  ```

- [ ] Follow same release process above

---

## Rollback Process (If Release is Broken)

### GitHub Release

- [ ] Mark release as "Pre-release"
- [ ] Add warning notice to description
- [ ] Pin previous stable release as "Latest"

### App Stores

**iOS:**
- [ ] Phased release: Pause rollout
- [ ] Or: Remove from sale temporarily
- [ ] Submit hotfix ASAP

**Android:**
- [ ] Halt staged rollout
- [ ] Or: Revert to previous version
- [ ] Submit hotfix

### Communication

- [ ] Post incident report in Discussions
- [ ] Update affected users via GitHub Issues
- [ ] Provide workaround if available

---

## Checklist Templates by Version Type

### Patch Release (X.X.Y)

Focus: Bug fixes, security patches

- [ ] Critical bugs fixed
- [ ] Security vulnerabilities patched
- [ ] Regression tests added
- [ ] Quick release cycle (days)

### Minor Release (X.Y.0)

Focus: New features, improvements

- [ ] New features complete and tested
- [ ] Documentation updated
- [ ] Marketing materials prepared
- [ ] 2-4 week testing cycle

### Major Release (X.0.0)

Focus: Breaking changes, major features

- [ ] Breaking changes documented
- [ ] Migration guide written
- [ ] Beta testing phase (2-4 weeks)
- [ ] Marketing campaign planned
- [ ] 4-8 week testing cycle

---

## Resources

- **GitHub Releases**: https://github.com/mkbhardwas12/prismos-ai/releases
- **App Store Connect**: https://appstoreconnect.apple.com
- **Play Console**: https://play.google.com/console
- **Semantic Versioning**: https://semver.org/

---

## Sign-Off

**Release Manager**: _________________

**Date**: _________________

**Version**: vX.X.X

**Status**: ☐ PASS  ☐ FAIL

**Notes**:
```
```

---

**PrismOS-AI Release Process** — Ship with confidence

Questions? See [DEPLOYMENT.md](DEPLOYMENT.md) or open an issue.
