# Build measure-server with PyInstaller and copy to Tauri binaries/ with correct triple name.
# Run from ManimStuff\ in a venv that has manim, fastapi, pyinstaller, etc.:
#   .\scripts\build-measure-sidecar.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
    Write-Error "Install PyInstaller: pip install pyinstaller"
}

pyinstaller scripts/measure-server.spec

$triple = (rustc -vV | Select-String "^host: ").ToString().Substring(6).Trim()
$ext = ".exe"
$src = Join-Path $Root "dist\measure-server\measure-server$ext"
if (-not (Test-Path $src)) {
    Write-Error "Expected binary not found: $src"
}

$tauriBin = Join-Path $Root "manim-timeline\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $tauriBin | Out-Null
$dest = Join-Path $tauriBin "measure-server-$triple$ext"
Copy-Item -Force $src $dest
Write-Host "Copied sidecar to: $dest"
Write-Host "Registered in tauri.conf.json as: binaries/measure-server"
