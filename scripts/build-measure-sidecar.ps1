# Build measure-server with PyInstaller and copy to Tauri binaries/ with correct triple name.
# Run from ManimStuff\ in a venv that has manim, fastapi, pyinstaller, etc.:
#   .\scripts\build-measure-sidecar.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
    Write-Error "Install PyInstaller: pip install pyinstaller"
}

$buildId = [guid]::NewGuid().ToString("N")
$buildRoot = Join-Path $env:TEMP "manim-timeline-sidecar-$buildId"
$workPath = Join-Path $buildRoot "build"
$distPath = Join-Path $buildRoot "dist"

pyinstaller --noconfirm --workpath "$workPath" --distpath "$distPath" scripts/measure-server.spec
if ($LASTEXITCODE -ne 0) {
    Write-Error "PyInstaller failed with exit code $LASTEXITCODE"
}

$triple = (rustc -vV | Select-String "^host: ").ToString().Substring(6).Trim()
$ext = ".exe"
$src = Join-Path $distPath "measure-server$ext"
if (-not (Test-Path $src)) {
    Write-Error "Expected binary not found: $src"
}

$tauriBin = Join-Path $Root "manim-timeline\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $tauriBin | Out-Null
$dest = Join-Path $tauriBin "measure-server-$triple$ext"
Copy-Item -Force $src $dest
Write-Host "Copied sidecar to: $dest"
Write-Host "Registered in tauri.conf.json as: binaries/measure-server"
