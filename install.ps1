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
$SettingsBackup = Join-Path $InstallRoot "settings-backup"
$PluginStatesFile = Join-Path $InstallRoot "plugin-states.txt"

$RepoZipUrl   = "https://codeload.github.com/$RepoOwner/$RepoName/zip/refs/heads/$RepoBranch"
$InstallerUrl = "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe"
$MonitorUrl   = "https://raw.githubusercontent.com/$RepoOwner/$RepoName/$RepoBranch/vencord-monitor.ps1"
$MonitorPath  = Join-Path $InstallRoot "vencord-monitor.ps1"
$ShaFile      = Join-Path $InstallRoot "installed_sha.txt"
$TaskName     = "VencordAutoUpdate"

function Backup-VencordSettings {
    param([string]$From, [string]$To, [string]$StatesFile)

    $settingsDir = Join-Path $From "settings"
    if (-not (Test-Path $settingsDir)) { return $false }

    if (Test-Path $To) { Remove-Item -Recurse -Force $To -ErrorAction SilentlyContinue }
    Copy-Item -Path $settingsDir -Destination $To -Recurse -Force

    # Human-readable plugin-states dump
    $settingsJson = Join-Path $settingsDir "settings.json"
    if (Test-Path $settingsJson) {
        try {
            $data = Get-Content $settingsJson -Raw | ConvertFrom-Json
            if ($data.plugins) {
                $lines = @("Plugin-Zustaende (Snapshot vor Update, $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))", "")
                $data.plugins.PSObject.Properties |
                    Sort-Object Name |
                    ForEach-Object {
                        $on = if ($_.Value.enabled) { "AN " } else { "AUS" }
                        $lines += "$on  $($_.Name)"
                    }
                Set-Content -Path $StatesFile -Value $lines -Encoding UTF8
            }
        } catch {}
    }

    return $true
}

function Restore-VencordSettings {
    param([string]$From, [string]$To)

    if (-not (Test-Path $From)) { return $false }
    $target = Join-Path $To "settings"
    if (Test-Path $target) { Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue }
    Copy-Item -Path $From -Destination $target -Recurse -Force
    return $true
}

function Info($m) { Write-Host "[Vencord] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[Vencord] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[Vencord] $m" -ForegroundColor Yellow }
function Err($m)  { Write-Host "[Vencord] $m" -ForegroundColor Red }

function Register-VencordAutoUpdate {
    param([string]$ScriptPath)

    try {
        $arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`""
        $action    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
        $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                        -StartWhenAvailable -MultipleInstances IgnoreNew `
                        -ExecutionTimeLimit ([TimeSpan]::Zero)
        $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
            -Settings $settings -Principal $principal -Force | Out-Null
        Ok "Auto-Update-Task '$TaskName' registriert (startet bei jedem Windows-Login)."
    } catch {
        Warn "Konnte Auto-Update-Task nicht registrieren: $_"
    }
}

function Unregister-VencordAutoUpdate {
    try {
        $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($existing) {
            Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Ok "Auto-Update-Task entfernt."
        }
        Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like "*vencord-monitor.ps1*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch {
        Warn "Konnte Auto-Update-Task nicht entfernen: $_"
    }
}

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

$hadSettings = $false
if (Test-Path $ExtractDir) {
    if (Backup-VencordSettings -From $ExtractDir -To $SettingsBackup -StatesFile $PluginStatesFile) {
        $hadSettings = $true
        Info "Bestehende Plugin-Einstellungen gesichert -> $SettingsBackup"
    }
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

if ($hadSettings -and (Restore-VencordSettings -From $SettingsBackup -To $ExtractDir)) {
    Ok "Plugin-Einstellungen wiederhergestellt (Plugin-Zustaende bleiben wie vorher)."
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
        Unregister-VencordAutoUpdate
        if (Test-Path $ShaFile)          { Remove-Item -Force $ShaFile -ErrorAction SilentlyContinue }
        if (Test-Path $MonitorPath)      { Remove-Item -Force $MonitorPath -ErrorAction SilentlyContinue }
        if (Test-Path $SettingsBackup)   { Remove-Item -Recurse -Force $SettingsBackup -ErrorAction SilentlyContinue }
        if (Test-Path $PluginStatesFile) { Remove-Item -Force $PluginStatesFile -ErrorAction SilentlyContinue }
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

        # --- Auto-Update-Monitor einrichten ---
        try {
            $repoMonitor = Join-Path $ExtractDir "vencord-monitor.ps1"
            if (Test-Path $repoMonitor) {
                Copy-Item -Path $repoMonitor -Destination $MonitorPath -Force
            } else {
                Invoke-WebRequest -Uri $MonitorUrl -OutFile $MonitorPath -UseBasicParsing `
                    -Headers @{ "User-Agent" = "Vencord-Custom-Installer" }
            }
            Info "Monitor-Script installiert: $MonitorPath"

            try {
                $latestSha = (Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoOwner/$RepoName/commits/$RepoBranch" `
                                -Headers @{ "User-Agent" = "Vencord-Custom-Installer" } -TimeoutSec 20).sha
                if ($latestSha) {
                    Set-Content -Path $ShaFile -Value $latestSha
                    Info "Aktuelle Commit-SHA gespeichert: $($latestSha.Substring(0,7))"
                }
            } catch {
                Warn "Konnte aktuelle Commit-SHA nicht abrufen: $_"
            }

            Register-VencordAutoUpdate -ScriptPath $MonitorPath

            # Alte Monitor-Instanzen killen (falls Reinstall/Update lief)
            Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -like "*vencord-monitor.ps1*" -and $_.ProcessId -ne $PID } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

            # Starte Monitor direkt jetzt, damit er nicht erst nach naechstem Login laeuft
            Start-Process -FilePath "powershell.exe" `
                -ArgumentList "-NoProfile","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File","`"$MonitorPath`"" `
                -WindowStyle Hidden
            Ok "Monitor laeuft im Hintergrund. Er prueft ~60s nach jedem Discord-Start auf Updates."
        } catch {
            Warn "Auto-Update-Setup fehlgeschlagen: $_"
        }

        Ok "Fertig! Lyrics-Plugin unter Discord-Einstellungen -> Vencord -> Plugins aktivieren (discordLyricsSpotifyStatus)."
    }
} else {
    Err "Installer endete mit Code $exit."
}

exit $exit
