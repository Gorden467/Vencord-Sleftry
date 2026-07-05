#Requires -Version 5.1
<#
    Vencord-Sleftry Auto-Update Monitor.

    Runs as a hidden background task at Windows logon.
    Behavior:
      - Waits until Discord.exe starts.
      - 60 seconds after Discord starts, checks:
          * Is Vencord actually injected into Discord?
          * Is there a newer commit on GitHub than what we installed?
      - If either check fails, downloads the newest install.ps1 and runs it
        (which closes Discord, updates, and restarts Discord).
      - Only performs one check per Discord launch to avoid interrupting sessions.
#>

$RepoOwner = "Gorden467"
$RepoName  = "Vencord-Sleftry"
$Branch    = "main"

$ApiUrl     = "https://api.github.com/repos/$RepoOwner/$RepoName/commits/$Branch"
$InstallUrl = "https://raw.githubusercontent.com/$RepoOwner/$RepoName/$Branch/install.ps1"

$InstallRoot = Join-Path $env:LOCALAPPDATA "Vencord-Custom"
$ShaFile     = Join-Path $InstallRoot "installed_sha.txt"
$LogFile     = Join-Path $InstallRoot "monitor.log"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    try { Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue } catch {}
}

function Get-LatestSha {
    try {
        $r = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "VencordMonitor" } -TimeoutSec 20
        return $r.sha
    } catch {
        Log "GitHub API error: $_"
        return $null
    }
}

function Test-VencordInstalled {
    $roots = @(
        (Join-Path $env:LOCALAPPDATA "Discord")
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $appDirs = Get-ChildItem -Path $root -Directory -Filter "app-*" -ErrorAction SilentlyContinue
        foreach ($d in $appDirs) {
            if (Test-Path (Join-Path $d.FullName "resources\_app.asar")) { return $true }
        }
    }
    return $false
}

function Invoke-Update {
    Log "Triggering update via $InstallUrl"
    try {
        $script = Invoke-WebRequest -Uri $InstallUrl -UseBasicParsing -Headers @{ "User-Agent" = "VencordMonitor" }
        Invoke-Expression $script.Content
        Log "Update finished"
    } catch {
        Log "Update failed: $_"
    }
}

Log "Monitor started (pid $PID)"

$lastCheckedPid = 0

while ($true) {
    try {
        $discord = Get-Process -Name "Discord" -ErrorAction SilentlyContinue | Select-Object -First 1

        if ($discord -and $discord.Id -ne $lastCheckedPid) {
            Log "Discord detected (pid $($discord.Id)), waiting 60s before check"
            Start-Sleep -Seconds 60

            # Verify Discord is still the same process (user did not close it)
            $stillRunning = Get-Process -Id $discord.Id -ErrorAction SilentlyContinue
            if (-not $stillRunning) {
                Log "Discord closed during wait, skipping"
                continue
            }

            $lastCheckedPid = $discord.Id

            $installed = Test-VencordInstalled
            $latestSha = Get-LatestSha
            $currentSha = if (Test-Path $ShaFile) { (Get-Content $ShaFile -ErrorAction SilentlyContinue).Trim() } else { "" }

            Log "Check: injected=$installed latest=$latestSha current=$currentSha"

            $needsUpdate = $false
            if (-not $installed) {
                Log "Vencord not injected -> update"
                $needsUpdate = $true
            } elseif ($latestSha -and $latestSha -ne $currentSha) {
                Log "New commit available -> update"
                $needsUpdate = $true
            }

            if ($needsUpdate) {
                Invoke-Update
                # install.ps1 spawns a fresh monitor process, so we exit to avoid duplicates
                Log "Exiting after update (fresh monitor was spawned by installer)"
                exit 0
            } else {
                Log "Up to date"
            }
        }
    } catch {
        Log "Loop error: $_"
    }

    Start-Sleep -Seconds 15
}
