# PrismOS-AI one-line Windows installer
#
#   irm https://raw.githubusercontent.com/mkbhardwas12/prismos-ai/main/scripts/install.ps1 | iex
#
# Detects arch, downloads the latest signed .msi release from GitHub, installs
# it silently, then bootstraps Ollama and pulls the default model. No admin
# required for the per-user MSI path. Re-runnable / idempotent.

[CmdletBinding()]
param(
    [string]$Repo         = 'mkbhardwas12/prismos-ai',
    [string]$DefaultModel = $(if ($env:PRISMOS_DEFAULT_MODEL) { $env:PRISMOS_DEFAULT_MODEL } else { 'qwen3:4b' })
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Info  ($m) { Write-Host "» $m" -ForegroundColor White }
function Ok    ($m) { Write-Host "✓ $m" -ForegroundColor Green }
function Warn  ($m) { Write-Host "! $m" -ForegroundColor Yellow }
function Die   ($m) { Write-Host "✗ $m" -ForegroundColor Red; exit 1 }

# ─── 0. preflight ────────────────────────────────────────────────────────────
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Die "PowerShell 5+ required. You have $($PSVersionTable.PSVersion)."
}

$arch = (Get-CimInstance Win32_Processor).Architecture
# 9 = x64, 12 = ARM64
$assetGlob = switch ($arch) {
    9  { '*_x64.msi'   ; break }
    12 { '*_arm64.msi' ; break }
    default { Die "Unsupported CPU architecture code: $arch" }
}
Info "platform: windows ($($assetGlob -replace '\*|_|\.msi',''))"

# ─── 1. resolve latest release asset ─────────────────────────────────────────
$api = "https://api.github.com/repos/$Repo/releases/latest"
Info "querying latest release …"
try {
    $rel = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'prismos-installer' }
} catch {
    Die "couldn't query GitHub API: $($_.Exception.Message)"
}

$asset = $rel.assets | Where-Object { $_.name -like $assetGlob } | Select-Object -First 1
if (-not $asset) { Die "no release asset matched $assetGlob" }

$dest = Join-Path $env:TEMP $asset.name
Info "downloading $($asset.name) …"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing

# ─── 2. install MSI (per-user, no admin) ─────────────────────────────────────
Info "installing $($asset.name) (silent, per-user) …"
$logPath = Join-Path $env:TEMP 'prismos-msi.log'
$msiArgs = "/i `"$dest`" /qn /norestart MSIINSTALLPERUSER=1 ALLUSERS=`"`" /l*v `"$logPath`""
$proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    Die "msiexec exited with code $($proc.ExitCode). See log: $logPath"
}
Ok "PrismOS-AI installed"

# ─── 3. bootstrap Ollama ─────────────────────────────────────────────────────
function Test-Cmd ($n) { [bool](Get-Command $n -ErrorAction SilentlyContinue) }

if (Test-Cmd 'ollama') {
    Ok "Ollama already installed"
} else {
    Info "installing Ollama (winget) …"
    if (Test-Cmd 'winget') {
        winget install --silent --accept-source-agreements --accept-package-agreements Ollama.Ollama | Out-Null
    } else {
        Warn "winget not found — open https://ollama.com/download/windows and install manually, then re-run."
    }
}

# Try to reach the local Ollama daemon. It usually auto-starts after install
# but a fresh install may need a kick.
function Test-Ollama {
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:11434/api/version' -TimeoutSec 2 -UseBasicParsing
        return $r.StatusCode -eq 200
    } catch { return $false }
}

if (-not (Test-Ollama)) {
    if (Test-Cmd 'ollama') {
        Info "starting ollama in the background …"
        Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
        for ($i = 0; $i -lt 6 -and -not (Test-Ollama); $i++) { Start-Sleep -Seconds 1 }
    }
}

if (Test-Ollama -and (Test-Cmd 'ollama')) {
    $pulled = (& ollama list 2>$null) -split "`n" | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] }
    if ($pulled -contains $DefaultModel) {
        Ok "model $DefaultModel already pulled"
    } else {
        Info "pulling default model: $DefaultModel (this may take several minutes)"
        try { & ollama pull $DefaultModel } catch { Warn "model pull failed — run 'ollama pull $DefaultModel' later." }
    }
} else {
    Warn "Ollama not running. Start it manually with 'ollama serve' once installed."
}

# ─── 4. done ─────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '✓ PrismOS-AI is ready.' -ForegroundColor Green
Write-Host ''
Write-Host '  Launch:        Start Menu → PrismOS-AI'
Write-Host "  Default model: $DefaultModel  (change in Settings)"
Write-Host "  Docs:          https://github.com/$Repo"
Write-Host ''
Write-Host 'Everything runs locally. No data leaves your machine.'
