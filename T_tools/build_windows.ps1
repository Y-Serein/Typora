param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $repoRoot "D_deliverables\ys-writer-desktop"
$tauriCli = Join-Path $appDir "node_modules\@tauri-apps\cli\tauri.js"
$bundleDir = Join-Path $appDir "src-tauri\target\release\bundle"

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

if (-not $SkipInstall) {
  if (-not (Test-Path "node_modules")) {
    npm ci
  } else {
    Write-Host "node_modules exists; skipping npm ci. Use a clean checkout or delete node_modules if dependencies look stale."
  }
}

node $tauriCli build --bundles nsis

Write-Host ""
Write-Host "Build artifacts:"
if (Test-Path $bundleDir) {
  Get-ChildItem $bundleDir -Recurse -Include *.exe,*.msi | ForEach-Object {
    Write-Host $_.FullName
  }
} else {
  Write-Host "Bundle directory not found: $bundleDir"
}
