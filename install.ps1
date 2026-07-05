#Requires -Version 5.1
<#
    Remote installer for a custom Vencord build (with discordLyricsSpotifyStatus userplugin).

    ONE-LINER (from anywhere):
        iwr -useb "https://raw.githubusercontent.com/<OWNER>/<REPO>/main/install.ps1" | iex

    Or run locally:
        powershell -ExecutionPolicy Bypass -File .\install.ps1
        powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall

    What it does:
      1. Downloads the current repo (main branch) as a zip
      2. Extracts it to %LOCALAPPDATA%\Vencord-Custom\repo
      3. Downloads the official VencordInstallerCli.exe
      4. Injects the local build into Discord (like `pnpm inject`)
#>

param(
    [switch]$Uninstall
)

# --- CONFIG: edit these two lines before pushing to GitHub ---------------
$RepoOwner  = "Gorden467"
$RepoName   = "Vencord-Sleftry"
$RepoBranch = "main"
# -------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$InstallRoot  = Join-Path $env:LOCALAPPDATA "Vencord-Custom"
$ExtractDir   = Join-Path $InstallRoot "repo"
$InstallerDir = Join-Path $InstallRoot "Installer"
$InstallerExe = Join-Path $InstallerDir "VencordInstallerCli.exe"
$ZipPath      = Join-Path $InstallRoot "repo.zip"

$RepoZipUrl   = "https://codeload.github.com/$RepoOwner/$RepoName/zip/refs/heads/$RepoBranch"
$InstallerUrl = "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe"

function Info($m) { Write-Host "[Vencord] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[Vencord] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[Vencord] $m" -ForegroundColor Yellow }
function Err($m)  { Write-Host "[Vencord] $m" -ForegroundColor Red }

if ($RepoOwner -eq "YOUR_GITHUB_USERNAME") {
    Err "Bitte in install.ps1 zuerst RepoOwner und RepoName eintragen und dann committen/pushen."
    exit 1
}

New-Item -ItemType Directory -Force -Path $InstallRoot, $InstallerDir | Out-Null

Info "Lade Repo von GitHub..."
try {
    Invoke-WebRequest -Uri $RepoZipUrl -OutFile $ZipPath -UseBasicParsing `
        -Headers @{ "User-Agent" = "Vencord-Custom-Installer" }
} catch {
    Err "Repo-Download fehlgeschlagen ($RepoZipUrl): $_"
    exit 1
}

Info "Entpacke..."
if (Test-Path $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir }
$tmpExtract = Join-Path $InstallRoot "_extract"
if (Test-Path $tmpExtract) { Remove-Item -Recurse -Force $tmpExtract }
Expand-Archive -Path $ZipPath -DestinationPath $tmpExtract -Force
$inner = Get-ChildItem -Path $tmpExtract | Select-Object -First 1
Move-Item -Path $inner.FullName -Destination $ExtractDir
Remove-Item -Recurse -Force $tmpExtract
Remove-Item -Force $ZipPath

if (-not (Test-Path (Join-Path $ExtractDir "dist\patcher.js"))) {
    Err "dist/patcher.js fehlt im Repo. Wurde 'pnpm build' vor dem Push ausgefuehrt und dist/ committed?"
    exit 1
}

if (-not (Test-Path $InstallerExe)) {
    Info "Lade Vencord Installer..."
    try {
        Invoke-WebRequest -Uri $InstallerUrl -OutFile $InstallerExe -UseBasicParsing `
            -Headers @{ "User-Agent" = "Vencord-Custom-Installer" }
    } catch {
        Err "Installer-Download fehlgeschlagen: $_"
        exit 1
    }
}

$flavorMap = @{
    "Discord"            = "Discord"
    "DiscordCanary"      = "DiscordCanary"
    "DiscordPTB"         = "DiscordPTB"
    "DiscordDevelopment" = "DiscordDevelopment"
}

$runningFlavors = @()
$discord = Get-Process -Name $flavorMap.Keys -ErrorAction SilentlyContinue
if ($discord) {
    $runningFlavors = $discord | ForEach-Object { $_.ProcessName } | Sort-Object -Unique
    Warn "Discord laeuft ($($runningFlavors -join ', ')) - schliesse es..."
    $discord | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}
if (-not $runningFlavors -and -not $Uninstall) {
    $runningFlavors = @("Discord")
}

$env:VENCORD_USER_DATA_DIR = $ExtractDir
$env:VENCORD_DEV_INSTALL   = "1"

$action = if ($Uninstall) { "--uninstall" } else { "--install" }
Info "Starte Installer ($action) mit lokalem Build: $ExtractDir"
& $InstallerExe $action
$exit = $LASTEXITCODE

if ($exit -eq 0) {
    if ($Uninstall) {
        Ok "Uninstall abgeschlossen."
    } else {
        Ok "Injection erfolgreich. Starte Discord neu..."
        Ok "Installiert nach: $ExtractDir"

        foreach ($flavor in $runningFlavors) {
            $localFolder = if ($flavor -eq "Discord") { "Discord" } else { $flavor }
            $updateExe = Join-Path $env:LOCALAPPDATA "$localFolder\Update.exe"
            $exeArg = "$flavor.exe"
            if (Test-Path $updateExe) {
                Info "Starte $flavor..."
                Start-Process -FilePath $updateExe -ArgumentList "--processStart", $exeArg
            } else {
                Warn "$updateExe nicht gefunden - Discord bitte manuell starten."
            }
        }

        Ok "Fertig! Lyrics-Plugin unter Discord-Einstellungen -> Vencord -> Plugins aktivieren (discordLyricsSpotifyStatus)."
    }
} else {
    Err "Installer endete mit Code $exit."
}

exit $exit
