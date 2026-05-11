param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $repoRoot "D_deliverables\ys-writer-desktop"
$tauriCli = Join-Path $appDir "node_modules\@tauri-apps\cli\tauri.js"
$targetDir = Join-Path $appDir "src-tauri\target"

if (-not (Test-Path $appDir)) {
  throw "App directory not found: $appDir"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Install Node.js LTS on Windows first."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install Node.js LTS on Windows first."
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "Rust/Cargo is required. Install Rust stable with rustup on Windows first."
}

Set-Location $appDir

Write-Host "Node:  $(node -v)"
Write-Host "npm:   $(npm -v)"
Write-Host "cargo: $(cargo -V)"
Write-Host ""

if (-not $SkipInstall) {
  if (-not (Test-Path "node_modules")) {
    npm ci
    if ($LASTEXITCODE -ne 0) {
      throw "npm ci failed with exit code $LASTEXITCODE"
    }
  } else {
    Write-Host "node_modules exists; skipping npm ci. Use a clean checkout or delete node_modules if dependencies look stale."
  }
}

if (-not (Test-Path $tauriCli)) {
  throw "Tauri CLI not found: $tauriCli. Run this script without -SkipInstall, or run npm ci in $appDir."
}

node $tauriCli build --bundles nsis
if ($LASTEXITCODE -ne 0) {
  throw "tauri build failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Build artifacts:"
$artifacts = @()
if (Test-Path $targetDir) {
  $artifacts = @(Get-ChildItem $targetDir -Recurse -File -Include *.exe,*.msi)
}

if ($artifacts.Count -eq 0) {
  throw "No .exe or .msi artifacts found under: $targetDir"
}

$artifacts | ForEach-Object {
  Write-Host $_.FullName
}
