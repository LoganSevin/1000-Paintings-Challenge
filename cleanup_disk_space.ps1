# Free disk space + prep gallery for flash-drive copy.
# Run:  powershell -ExecutionPolicy Bypass -File cleanup_disk_space.ps1 -IncludeGrok
# Aggressive:  ... -IncludeGrok -Aggressive
param(
    [switch]$Aggressive,
    [switch]$IncludeGrok
)

$ErrorActionPreference = "SilentlyContinue"
$Gallery = $PSScriptRoot
$freed = [int64]0

function Get-TreeBytes([string]$Path) {
    if (-not (Test-Path $Path)) { return 0 }
    return [int64]((Get-ChildItem $Path -Recurse -File -Force | Measure-Object Length -Sum).Sum)
}

function Remove-TreeSize([string]$Path) {
    $bytes = Get-TreeBytes $Path
    if ($bytes -gt 0) { Remove-Item $Path -Recurse -Force }
    return $bytes
}

function Remove-FileSize([string]$Path) {
    if (-not (Test-Path $Path)) { return 0 }
    $bytes = [int64](Get-Item $Path -Force).Length
    Remove-Item $Path -Force
    return $bytes
}

function Clear-FolderContents([string]$Path) {
    if (-not (Test-Path $Path)) { return 0 }
    $bytes = Get-TreeBytes $Path
    Get-ChildItem $Path -Force | Remove-Item -Recurse -Force
    return $bytes
}

Write-Host "Gallery cleanup: $Gallery"
Write-Host ""

$devPaths = @(
    (Join-Path $Gallery "scripts\app_server_disasm.txt"),
    (Join-Path $Gallery "scripts\pycdc_errors.txt"),
    (Join-Path $Gallery "scripts\app_server_recovered.py"),
    (Join-Path $Gallery "scripts\tools\pycdc.exe"),
    (Join-Path $Gallery "scripts\recovered"),
    (Join-Path $Gallery "scripts\tools")
)
foreach ($p in $devPaths) {
    if (Test-Path $p -PathType Container) { $freed += Remove-TreeSize $p }
    else { $freed += Remove-FileSize $p }
}

$cacheDir = Join-Path $Gallery "scripts\__pycache__"
if (Test-Path $cacheDir) {
    Get-ChildItem $cacheDir -Filter "*.pyc" | Where-Object {
        $_.Name -notmatch '^app_server(_impl)?\.cpython-'
    } | ForEach-Object { $freed += Remove-FileSize $_.FullName }
}

Get-ChildItem $Gallery -Recurse -Force -Include "Thumbs.db","desktop.ini",".DS_Store" -File |
    ForEach-Object { $freed += Remove-FileSize $_.FullName }

if ($Aggressive) {
    foreach ($name in @("generated", "saved-stasis")) {
        $p = Join-Path $Gallery $name
        if (Test-Path $p) {
            Write-Host "Aggressive: clearing $name ..."
            $freed += Remove-TreeSize $p
            New-Item -ItemType Directory -Path $p -Force | Out-Null
        }
    }
}

if ($IncludeGrok) {
    $grok = Join-Path $env:USERPROFILE ".grok"
    if (Test-Path $grok) {
        Write-Host "Clearing Grok caches in $grok ..."
        foreach ($sub in @("upload_queue", "downloads", "logs", "marketplace-cache")) {
            $p = Join-Path $grok $sub
            $freed += Clear-FolderContents $p
        }
        if ($Aggressive) {
            $sessions = Join-Path $grok "sessions"
            Write-Host "Aggressive: clearing Grok sessions ..."
            $freed += Clear-FolderContents $sessions
        }
    }
}

$mb = [math]::Round($freed / 1MB, 1)
Write-Host ""
Write-Host "Freed approximately $mb MB."
Write-Host "Flash drive: run copy_to_flash_drive.bat"
Write-Host "Read PORTABLE.txt for details."