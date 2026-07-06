# Chat-Log: Custom Vencord Setup (Gorden467/Vencord-Sleftry)

Zusammenfassung der Session in der dieses Setup gebaut wurde.

---

## 1. Ausgangslage

- Vencord-Fork lokal geklont: `C:\Users\Gorden\Documents\Vencord`
- Custom Userplugin dabei: `src/userplugins/discordLyricsSpotifyStatus/`
  (zeigt Spotify-Lyrics live im Discord-Custom-Status)
- `dist/` war bereits gebaut, aber nichts davon war lokal installiert oder online

**Ziel:** Vencord (inkl. Lyrics-Plugin) per **einer** PowerShell-Zeile auf beliebigen
Windows-Rechnern installierbar machen, mit Auto-Update und automatischem
Discord-Neustart.

## 2. Schritt 1 - Lokaler Installer (Install.ps1, spaeter durch install.ps1 ersetzt)

Erstes Script: Local-Install per PowerShell.
- Nutzt bereits gebautes `dist/`
- Setzt `VENCORD_USER_DATA_DIR` + `VENCORD_DEV_INSTALL=1`
- Ruft `dist/Installer/VencordInstallerCli.exe --install`
- Damit brauchte man Node/pnpm nicht mehr auf dem Zielrechner

## 3. Schritt 2 - GitHub-Repo + Remote-Installer

- `.gitignore` angepasst: `dist/` und `src/userplugins/` erlaubt,
  `dist/Installer/` und `*.exe` weiterhin ignoriert
- Neues `install.ps1` das aus `codeload.github.com` das ganze Repo als Zip laedt,
  nach `%LOCALAPPDATA%\Vencord-Custom\repo\` entpackt, den Installer downloadet
  und injectet
- One-Liner:
  ```powershell
  iwr -useb "https://raw.githubusercontent.com/Gorden467/Vencord-Sleftry/main/install.ps1" | iex
  ```

## 4. Schritt 3 - Repo veroeffentlicht

- Repo: https://github.com/Gorden467/Vencord-Sleftry (public)
- Git-Identity lokal gesetzt: `Gorden467 <117101093+Gorden467@users.noreply.github.com>`
- Erster Push ging mit echter E-Mail `go.esperstedt@gmail.com` raus - direkt
  bemerkt, per `--amend` + `git push --force-with-lease` gefixt.
  Jetzt steht nur die GitHub-Noreply-Adresse in der History.

## 5. Schritt 4 - Discord-Autostart

`install.ps1` erweitert:
- Merkt sich welche Discord-Flavors (Stable/Canary/PTB/Dev) vor dem Kill liefen
- Nach dem Inject: startet dieselben wieder via
  `%LOCALAPPDATA%\<Flavor>\Update.exe --processStart <Flavor>.exe`

## 6. Schritt 5 - README

Install-Anleitung mit dem One-Liner ganz oben in README.md eingebaut.
About-Description in der Sidebar setzt der User selbst per Web
(github.com/Gorden467/Vencord-Sleftry - Zahnrad neben "About").

## 7. Schritt 6 - Auto-Update-Monitor

Neu: `vencord-monitor.ps1` + `install.ps1` faehrt es als Scheduled Task hoch.

- Windows Scheduled Task `VencordAutoUpdate` (per-user, laeuft ohne Admin)
- Trigger: bei jedem Windows-Login + einmal direkt nach Install
- Monitor loopt im Hintergrund (hidden), watched auf `Discord.exe`
- 60s nachdem Discord startet prueft er:
  1. Ist Vencord noch injiziert? (checkt `_app.asar` in `%LOCALAPPDATA%\Discord\app-*\resources\`)
  2. Gibt es einen neueren Commit auf GitHub? (vergleicht mit
     `%LOCALAPPDATA%\Vencord-Custom\installed_sha.txt`)
- Wenn ja: laedt aktuelle `install.ps1` und fuehrt sie aus (Discord killen,
  updaten, neu starten). Monitor beendet sich danach - der neue `install.ps1`
  spawnt einen frischen Monitor
- Nur eine Pruefung pro Discord-Session (damit du nicht mehrfach unterbrochen wirst)
- Log: `%LOCALAPPDATA%\Vencord-Custom\monitor.log`

## 8. Debug-Snapshot

Beim ersten Test war das Lyrics-Plugin nicht in Vencords Plugin-Liste sichtbar.
Ursache: In der Vencord-Liste heisst das Plugin **`DiscordLyricsSpotifyStatus`**
(grosses D), nicht `discordLyricsSpotifyStatus` wie der Ordner.
Reinstall + Suche mit korrektem Namen -> geklappt.

## 9. Wichtige Pfade auf dem Zielrechner

| Zweck | Pfad |
|---|---|
| Installations-Root | `%LOCALAPPDATA%\Vencord-Custom\` |
| Vencord-Build (source of truth) | `%LOCALAPPDATA%\Vencord-Custom\repo\` |
| VencordInstallerCli.exe | `%LOCALAPPDATA%\Vencord-Custom\Installer\` |
| Monitor-Script | `%LOCALAPPDATA%\Vencord-Custom\vencord-monitor.ps1` |
| Aktuelle Commit-SHA | `%LOCALAPPDATA%\Vencord-Custom\installed_sha.txt` |
| Monitor-Log | `%LOCALAPPDATA%\Vencord-Custom\monitor.log` |
| Plugin-Settings | `%LOCALAPPDATA%\Vencord-Custom\repo\settings\settings.json` |
| Backup der Plugin-Settings | `%LOCALAPPDATA%\Vencord-Custom\settings-backup\` (nach Schritt 10) |
| Scheduled Task | `VencordAutoUpdate` (schtasks / Task Scheduler) |

## 10. Schritt 7 - Plugin-States ueberleben Updates

Beim Update wurde bisher `%LOCALAPPDATA%\Vencord-Custom\repo\` komplett geloescht
und neu entpackt - das heisst auch der `settings/`-Ordner mit den Plugin-An/Aus-
Zustaenden wurde ueberschrieben.

Fix (aktueller Stand):
- Vor dem Wipe: `settings/` wird nach `%LOCALAPPDATA%\Vencord-Custom\settings-backup\`
  kopiert
- Zusaetzlich wird `plugin-states.txt` geschrieben - eine lesbare Liste welches
  Plugin an/aus war
- Nach dem Neu-Entpacken wird `settings/` zurueckkopiert
- Discord startet neu und liest genau die alten Plugin-States wieder ein

## Befehle zum Nachschlagen

**Install / Update (One-Liner):**
```powershell
iwr -useb "https://raw.githubusercontent.com/Gorden467/Vencord-Sleftry/main/install.ps1" | iex
```

**Uninstall:**
```powershell
& ([scriptblock]::Create((iwr -useb "https://raw.githubusercontent.com/Gorden467/Vencord-Sleftry/main/install.ps1"))) -Uninstall
```

**Monitor-Log live ansehen:**
```powershell
Get-Content $env:LOCALAPPDATA\Vencord-Custom\monitor.log -Wait
```

**Scheduled Task ansehen:**
```powershell
Get-ScheduledTask -TaskName VencordAutoUpdate | Get-ScheduledTaskInfo
```

**Plugin-Aenderung deployen (auf diesem Dev-Rechner):**
```powershell
pnpm build
git add dist src/userplugins
git commit -m "rebuild"
git push
```
Danach zieht der Monitor auf allen installierten Rechnern beim naechsten
Discord-Start das Update.
