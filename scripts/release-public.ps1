<#
.SYNOPSIS
    Selectively release commits to the public PrismOS-AI repo.

.DESCRIPTION
    This script helps cherry-pick specific commits from the private repo
    onto the public-release branch, then pushes to the public GitHub repo.

.PARAMETER CommitHash
    One or more commit hashes to cherry-pick onto the public-release branch.

.PARAMETER List
    Show recent commits on main that are NOT yet on public-release.

.PARAMETER Diff
    Show what's different between main and public-release.

.PARAMETER Push
    Push the public-release branch to the public remote after cherry-picking.

.EXAMPLE
    # See what commits are private-only (not yet released)
    .\release-public.ps1 -List

    # Cherry-pick a specific commit and push it public
    .\release-public.ps1 -CommitHash abc1234 -Push

    # Cherry-pick multiple commits
    .\release-public.ps1 -CommitHash abc1234, def5678 -Push

    # Just push (if you already cherry-picked manually)
    .\release-public.ps1 -Push
#>

param(
    [string[]]$CommitHash,
    [switch]$List,
    [switch]$Diff,
    [switch]$Push
)

$ErrorActionPreference = "Stop"

# Ensure we're in the repo
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) {
    Write-Error "Not inside a git repository!"
    exit 1
}

Set-Location $repoRoot

# Colors
function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   $msg" -ForegroundColor Yellow }

# ── List unreleased commits ──────────────────────────────────────────
if ($List) {
    Write-Step "Commits on 'main' NOT yet on 'public-release':"
    $unreleased = git log public-release..main --oneline
    if ($unreleased) {
        $unreleased | ForEach-Object { Write-Host "   $_" -ForegroundColor Yellow }
        Write-Host "`n   Total: $(($unreleased | Measure-Object).Count) unreleased commits" -ForegroundColor Magenta
    } else {
        Write-Ok "Everything on main is already on public-release!"
    }
    exit 0
}

# ── Show diff summary ────────────────────────────────────────────────
if ($Diff) {
    Write-Step "Files different between 'main' and 'public-release':"
    git diff --stat public-release..main
    exit 0
}

# ── Cherry-pick commits ──────────────────────────────────────────────
if ($CommitHash) {
    # Save current branch
    $currentBranch = git branch --show-current

    Write-Step "Switching to 'public-release' branch..."
    git checkout public-release

    foreach ($hash in $CommitHash) {
        Write-Step "Cherry-picking commit: $hash"
        try {
            git cherry-pick $hash
            Write-Ok "Successfully cherry-picked $hash"
        } catch {
            Write-Error "Failed to cherry-pick $hash. Resolve conflicts, then run: git cherry-pick --continue"
            exit 1
        }
    }

    # Switch back
    Write-Step "Switching back to '$currentBranch'..."
    git checkout $currentBranch
}

# ── Push to public remote ────────────────────────────────────────────
if ($Push) {
    Write-Step "Pushing 'public-release' to public remote (as main)..."
    git push public public-release:main
    Write-Ok "Public repo updated!"
    Write-Host ""
    Write-Host "   Public repo: https://github.com/mkbhardwas12/prismos-ai-public" -ForegroundColor Cyan
}

if (-not $CommitHash -and -not $List -and -not $Diff -and -not $Push) {
    Write-Host @"

  PrismOS Public Release Helper
  ──────────────────────────────

  Usage:
    .\release-public.ps1 -List                      # See unreleased commits
    .\release-public.ps1 -Diff                      # See file differences  
    .\release-public.ps1 -CommitHash <hash> -Push   # Cherry-pick & push
    .\release-public.ps1 -Push                      # Just push

  Remotes:
    origin  → Private repo (all features)
    public  → Public repo  (released only)

  Branches:
    main            → Full development (private)
    public-release  → Curated public releases

"@ -ForegroundColor Gray
}
