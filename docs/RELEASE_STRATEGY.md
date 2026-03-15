# Public Release Strategy

PrismOS-AI uses a **two-repo strategy** to keep proprietary features private while
releasing the base platform publicly.

## Architecture

| Remote   | Repository                          | Visibility | Purpose                   |
|----------|-------------------------------------|------------|---------------------------|
| `origin` | `mkbhardwas12/prismos-ai`           | **Private**| Full codebase + all features |
| `public` | `mkbhardwas12/prismos-ai-public`    | **Public** | Curated public releases    |

| Branch           | Description                                     |
|------------------|-------------------------------------------------|
| `main`           | Active development — all features (pushed to `origin`) |
| `public-release` | Curated subset — only public-safe commits (pushed to `public`) |

## Daily Workflow

```
   You develop normally on 'main', push to 'origin' (private).
   Nothing goes public unless you explicitly release it.
```

### 1. Develop & Push Privately (normal workflow)
```bash
git add .
git commit -m "feat: new secret feature"
git push origin main          # → private repo only
```

### 2. See What's Unreleased
```powershell
.\scripts\release-public.ps1 -List
```
This shows all commits on `main` that haven't been cherry-picked to `public-release`.

### 3. Release Specific Commits Publicly
```powershell
# Release a single commit
.\scripts\release-public.ps1 -CommitHash abc1234 -Push

# Release multiple commits
.\scripts\release-public.ps1 -CommitHash abc1234, def5678 -Push
```

### 4. Just Push (if you cherry-picked manually)
```powershell
.\scripts\release-public.ps1 -Push
```

## Manual Git Commands (if you prefer)

```bash
# See unreleased commits
git log public-release..main --oneline

# Cherry-pick a commit to public-release
git checkout public-release
git cherry-pick <commit-hash>
git checkout main

# Push to public
git push public public-release:main
```

## What's Currently Private?

| Feature                     | Commit    | Status  |
|-----------------------------|-----------|---------|
| Cognitive Intelligence      | `e25164c` | Private |
| Model Registry (16 models)  | `e25164c` | Private |
| Domain Detection Engine     | `e25164c` | Private |

## Tips

- **Never** run `git push public main` — that would push everything
- Always use `public-release:main` to control what goes to the public repo
- If a cherry-pick has conflicts, resolve them, then run `git cherry-pick --continue`
- Use `.\scripts\release-public.ps1 -Diff` to see file-level differences
