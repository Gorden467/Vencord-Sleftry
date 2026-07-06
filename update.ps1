#Requires -Version 5.1
<#
    Update-only script for Vencord-Sleftry.

    Checks:
      - Is Vencord still injected into Discord?
      - Is there a newer commit on GitHub than what's installed locally?

    If any check fails, delegates to install.ps1 to run the full update
    (close Discord, swap files, preserve plugin states, restart Discord).
    If everything is current, does nothing and exits.

    One-liner:
        iwr -useb "https://raw.githubusercontent.com/Gorden467/Vencord-Sleftry/main/update.ps1" | iex
#>

$RepoOwner  = "Gorden467"
$RepoName   = "Vencord-Sleftry"
$RepoBranch = "main"

$ApiUrl     = "https://api.github.com/repos/$RepoOwner/$RepoName/commits/$RepoBranch"
$InstallUrl = "https://raw.githubusercontent.com/$RepoOwner/$RepoName/$RepoBranch/install.ps1"

$InstallRoot = Join-Path $env:LOCALAPPDATA "Vencord-Custom"
$ShaFile     = Join-Path $InstallRoot "installed_sha.txt"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Info($m) { Write-Host "[Vencord] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[Vencord] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[Vencord] $m" -ForegroundColor Yellow }
function Err($m)  { Write-Host "[Vencord] $m" -ForegroundColor Red }

function Test-VencordInstalled {
    $root = Join-Path $env:LOCALAPPDATA "Discord"
    if (-not (Test-Path $root)) { return $false }
    $appDirs = Get-ChildItem -Path $root -Directory -Filter "app-*" -ErrorAction SilentlyContinue
    foreach ($d in $appDirs) {
        if (Test-Path (Join-Path $d.FullName "resources\_app.asar")) { return $true }
    }
    return $false
}

function Get-LatestSha {
    try {
        $r = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "Vencord-Update-Check" } -TimeoutSec 20
        return $r.sha
    } catch {
        Err "GitHub-API nicht erreichbar: $_"
        return $null
    }
}

Info "Pruefe Vencord-Zustand..."

$installed  = Test-VencordInstalled
$latestSha  = Get-LatestSha
$currentSha = if (Test-Path $ShaFile) { (Get-Content $ShaFile -ErrorAction SilentlyContinue).Trim() } else { "" }

$shortLatest  = if ($latestSha)  { $latestSha.Substring(0,7)  } else { "?" }
$shortCurrent = if ($currentSha) { $currentSha.Substring(0,7) } else { "-" }

Info "Injected:      $installed"
Info "Installiert:   $shortCurrent"
Info "Neuester auf GitHub: $shortLatest"

$reason = $null
if (-not $installed) {
    $reason = "Vencord ist nicht injiziert"
} elseif (-not $latestSha) {
    Warn "Konnte neuesten Commit nicht ermitteln - breche ab."
    exit 1
} elseif ($latestSha -ne $currentSha) {
    $reason = "Neuer Commit verfuegbar ($shortCurrent -> $shortLatest)"
}

if (-not $reason) {
    Ok "Alles aktuell. Nichts zu tun."
    exit 0
}

Info "Update noetig: $reason"
Info "Starte install.ps1..."

try {
    $script = Invoke-WebRequest -Uri $InstallUrl -UseBasicParsing -Headers @{ "User-Agent" = "Vencord-Update-Check" }
    Invoke-Expression $script.Content
} catch {
    Err "Update fehlgeschlagen: $_"
    exit 1
}
