# install.ps1 - Installs pierre-tree-files into Herdr App
$ErrorActionPreference = "Stop"

$herdrHome = "$HOME\.config\herdr-app"
$targetModDir = Join-Path $herdrHome "mods\pierre-tree-files"
$sourceModDir = Join-Path $PSScriptRoot "mods\pierre-tree-files"

if (-not (Test-Path $sourceModDir)) {
    Write-Error "Source directory not found: $sourceModDir"
    exit 1
}

Write-Host "==> Installing pierre-tree-files to $targetModDir ..." -ForegroundColor Cyan
if (-not (Test-Path $targetModDir)) {
    New-Item -ItemType Directory -Force -Path $targetModDir | Out-Null
}

Copy-Item -Path "$sourceModDir\*" -Destination $targetModDir -Recurse -Force

Write-Host "==> Verifying mod with herdr-app check..." -ForegroundColor Cyan
try {
    & herdr-app check $targetModDir
    Write-Host "==> pierre-tree-files installed and verified successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To use it, update your layout (e.g. layouts/main.json or custom layout):" -ForegroundColor Yellow
    Write-Host '  "content": { "mod": "pierre-tree-files" }' -ForegroundColor White
    Write-Host ""
    Write-Host "Enjoy your Pierre-style file tree!" -ForegroundColor Green
} catch {
    Write-Warning "Could not run 'herdr-app check'. Ensure 'herdr-app' is installed and in your PATH."
}
