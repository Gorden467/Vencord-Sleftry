# Chat-Log: Custom Vencord Setup (Gorden467/Vencord-Sleftry)

Vollständige Zusammenfassung der Session in der dieses Setup gebaut wurde.

---

## 1. Ausgangslage

- Vencord-Fork lokal: `C:\Users\Gorden\Documents\Vencord`
- Custom Userplugin: `src/userplugins/discordLyricsSpotifyStatus/` (zeigt Spotify-Lyrics live im Discord-Custom-Status)
- `dist/` war bereits gebaut, aber lokal nichts installiert, nichts online

**Ziel:** Vencord (inkl. Lyrics-Plugin) per einer PowerShell-Zeile auf beliebigen Windows-Rechnern installierbar machen, mit Auto-Update, automatischem Discord-Neustart und sauberer Behandlung des Custom-Status.

## 2. Lokaler Installer

- Erstes `install.ps1` das den bereits gebauten `dist/` nutzt
- Setzt `VENCORD_USER_DATA_DIR` + `VENCORD_DEV_INSTALL=1`, ruft `VencordInstallerCli.exe --install`
- Damit brauchte man auf dem Zielrechner kein Node/pnpm mehr

## 3. GitHub-Repo + Remote-Installer

- `.gitignore` angepasst: `dist/` und `src/userplugins/` erlaubt, `dist/Installer/` und `*.exe` weiterhin ignoriert
- Neues `install.ps1`: laedt aus `codeload.github.com` das ganze Repo als Zip, entpackt nach `%LOCALAPPDATA%\Vencord-Custom\repo\`, laedt den Installer, injectet
- Repo: https://github.com/Gorden467/Vencord-Sleftry (public)
- Git-Identity gesetzt: `Gorden467 <117101093+Gorden467@users.noreply.github.com>` (Noreply, um echte E-Mail nicht in Commits zu leaken; erster Fehl-Commit wurde per `--amend` + `force-with-lease` gefixt)

## 4. Discord-Autostart

`install.ps1` merkt sich, welche Discord-Flavors vor dem Kill liefen (Stable/Canary/PTB/Dev) und startet dieselben nach dem Inject via `%LOCALAPPDATA%\<Flavor>\Update.exe --processStart <Flavor>.exe`.

## 5. README auf GitHub

Install-, Update-, Uninstall-One-Liner ganz oben. GitHub-Sidebar-"About" setzt der User selbst per Web.

## 6. Auto-Update-Monitor (Hintergrund)

- `vencord-monitor.ps1` neu
- `install.ps1` registriert Scheduled Task `VencordAutoUpdate` (per-user, ohne Admin)
- Trigger: bei jedem Windows-Login + einmal direkt nach jedem Install
- Monitor loopt hidden im Hintergrund und watched `Discord.exe`
- **60s nach jedem Discord-Start** prueft er:
  1. Ist Vencord noch injiziert? (`_app.asar` in `%LOCALAPPDATA%\Discord\app-*\resources\`)
  2. Gibt es einen neueren Commit auf GitHub? (vs. `installed_sha.txt`)
- Wenn ja: laedt aktuelle `install.ps1`, fuehrt sie aus (Discord killen, updaten, neu starten). Monitor beendet sich - der neue install.ps1 spawnt einen frischen Monitor
- Log: `%LOCALAPPDATA%\Vencord-Custom\monitor.log`

## 7. Debug-Snapshot Nummer 1

Nach dem ersten Test war das Lyrics-Plugin in Vencords Plugin-Liste "nicht sichtbar". Ursache: In der Liste heisst es **`DiscordLyricsSpotifyStatus`** (grosses D), nicht der Ordnername `discordLyricsSpotifyStatus`. Suche mit dem richtigen Namen -> gefunden.

## 8. Plugin-States ueberleben Updates

Beim Update wurde bisher `%LOCALAPPDATA%\Vencord-Custom\repo\` komplett geloescht und neu entpackt - dabei auch der `settings/`-Ordner mit den Plugin-An/Aus-Zustaenden.

Fix:
- Vor dem Wipe: `settings/` wird nach `%LOCALAPPDATA%\Vencord-Custom\settings-backup\` kopiert
- Zusaetzlich `plugin-states.txt` mit lesbarer Liste welches Plugin an/aus war
- Nach dem Neu-Entpacken wird `settings/` zurueckkopiert
- Beim `-Uninstall` wird alles sauber entfernt

## 9. Lyrics: Auto-Clear beim Discord-Close

Problem: Wenn Discord geschlossen wird, blieb die letzte Lyric-Zeile im Custom-Status haengen (server-seitig auf Discord).

Fix:
- Plugin registriert `beforeunload` + `pagehide` Listener
- Beim Close: `fetch("/api/v9/users/@me/settings", { keepalive: true })` mit Auth-Token aus `findByPropsLazy("getToken", "hideToken")` -> Discord sendet die Anfrage auch nach Prozess-Ende noch fertig
- Zusaetzlich: bei Song-Pause/Ende cleart der Poll-Loop schon vorher

## 10. Monitor: 30-Minuten-Check

Der bisherige "einmal pro Discord-Launch"-Check verpasste Updates, die waehrend einer langen Session gepusht wurden.

Erweiterung:
- Zusaetzlich zu "neuer PID -> Check" jetzt auch "alle 30 Minuten -> Check", solange Discord laeuft
- Log-Zeile zeigt den Grund: `"new Discord launch"` oder `"periodic check (30 min elapsed)"`

## 11. Update-only-Script

`update.ps1` neu: prueft nur den Zustand und delegiert an `install.ps1` **nur wenn noetig**.

```powershell
iwr -useb "https://raw.githubusercontent.com/Gorden467/Vencord-Sleftry/main/update.ps1" | iex
```

- Zeigt kurzen Status (`Injected: True/False`, `Installiert: <sha>`, `Neuester auf GitHub: <sha>`)
- Sagt `Alles aktuell. Nichts zu tun.` wenn nichts zu machen ist -> kein unnoetiger Discord-Restart
- Update-Anleitung in der README dokumentiert

## 12. Lyrics: Stale-Status-Reset beim Discord-Start

Falls die Keepalive-Anfrage vom Unload-Handler mal verloren geht (z.B. harter Crash, Windows-Shutdown), blieb der letzte Lyric trotzdem stehen.

Fix (Ebene 1):
- Plugin schreibt persistent per Vencord DataStore `lyricActive = true` wenn ein Lyric gesetzt wird, `false` bei sauberem Clear
- Beim Plugin-Start: wenn Flag `true` und keine Musik laeuft -> `forceClearCustomStatus()` cleart die alte Zeile
- Laeuft Musik: nichts machen, der Poll-Loop ueberschreibt den alten Lyric ohnehin

## 13. Lyrics: Original-Status merken und wiederherstellen

Anspruch: Wenn User z.B. "🎮 Playing" als eigenen Custom-Status hat, das Plugin waehrend Musik "🎵 Lyric" setzt und die Musik dann stoppt -> zurueck zu "🎮 Playing", nicht komplett leer.

Fix (Ebene 2):
- Beim Plugin-Start: `captureOriginalStatus()` liest via `RestAPI.get("/users/@me/settings")` den aktuellen Custom-Status
  - Fangt aktueller Status mit `🎵` an (unser Lyric von letzter Session) -> behalte bereits gespeicherten Original-Wert
  - Sonst: speichere Text + Emoji-Name + Emoji-ID + Expires-At persistent im DataStore (`DiscordLyricsSpotifyStatus_originalStatus`)
- Queue-Processor wartet auf die Capture bevor er den ersten PATCH sendet -> Original wird garantiert erfasst bevor ueberschrieben wird
- **Clear -> Restore:** `clearCustomStatus()` und `forceClearCustomStatus()` schauen ins DataStore. Wenn dort ein nicht-leerer Original-Status liegt: PATCH mit Text + Emoji + Expires zurueck. Wenn nichts gespeichert: PATCH mit `custom_status: null`
- **Unload-Handler:** liest einen In-Memory-Cache des Originals (bei Start via `primeOriginalStatusCache()` befuellt), da im Unload keine async DataStore-Reads mehr gehen -> Restore per `fetch keepalive` mit gefuelltem Body statt bloss Null

## 14. Kommunikations-Details

- Origin-Push mit echter E-Mail passierte einmal, direkt gefixt per `--amend` + `git push --force-with-lease` (Repo war 2 Minuten alt, kein Fetch von Fremden -> safe)
- Beim Testen kam einmal ein File-Lock auf `repo.zip` weil Monitor und manueller Update parallel liefen; Cleanup: die alten PS-Prozesse killen, `repo.zip` loeschen, retry

## 15. Wichtige Pfade auf dem Zielrechner

| Zweck | Pfad |
|---|---|
| Installations-Root | `%LOCALAPPDATA%\Vencord-Custom\` |
| Vencord-Build | `%LOCALAPPDATA%\Vencord-Custom\repo\` |
| VencordInstallerCli.exe | `%LOCALAPPDATA%\Vencord-Custom\Installer\` |
| Monitor-Script | `%LOCALAPPDATA%\Vencord-Custom\vencord-monitor.ps1` |
| Aktuelle Commit-SHA | `%LOCALAPPDATA%\Vencord-Custom\installed_sha.txt` |
| Monitor-Log | `%LOCALAPPDATA%\Vencord-Custom\monitor.log` |
| Plugin-Settings (Discord) | `%LOCALAPPDATA%\Vencord-Custom\repo\settings\settings.json` |
| Settings-Backup zwischen Updates | `%LOCALAPPDATA%\Vencord-Custom\settings-backup\` |
| Lesbare Plugin-State-Liste | `%LOCALAPPDATA%\Vencord-Custom\plugin-states.txt` |
| Scheduled Task | `VencordAutoUpdate` (schtasks) |
| DataStore-Keys (in Vencord's IndexedDB) | `DiscordLyricsSpotifyStatus_lyricActive`, `DiscordLyricsSpotifyStatus_originalStatus` |

## 16. Befehle zum Nachschlagen

**Install / erste Einrichtung (One-Liner):**
```powershell
iwr -useb "https://raw.githubusercontent.com/Gorden467/Vencord-Sleftry/main/install.ps1" | iex
```

**Update (macht nichts wenn schon aktuell):**
```powershell
iwr -useb "https://raw.githubusercontent.com/Gorden467/Vencord-Sleftry/main/update.ps1" | iex
```

**Uninstall:**
```powershell
& ([scriptblock]::Create((iwr -useb "https://raw.githubusercontent.com/Gorden467/Vencord-Sleftry/main/install.ps1"))) -Uninstall
```

**Monitor-Log live ansehen:**
```powershell
Get-Content $env:LOCALAPPDATA\Vencord-Custom\monitor.log -Wait
```

**Scheduled Task Status:**
```powershell
Get-ScheduledTask -TaskName VencordAutoUpdate | Get-ScheduledTaskInfo
```

**Plugin-Aenderung deployen (auf dem Dev-Rechner):**
```powershell
pnpm build
git add dist src/userplugins
git commit -m "rebuild"
git push
```
Danach zieht der Monitor auf allen installierten Rechnern beim naechsten Discord-Start (oder in <= 30 min) das Update.

## 17. Test-Rezept fuer Restore-Feature

1. Setz vor dem Update einen eigenen Custom Status (z.B. "🎮 Playing")
2. `update.ps1` laufen lassen -> Discord neu starten
3. Spotify starten -> Lyric erscheint
4. Spotify pausieren -> springt zurueck zu "🎮 Playing"
5. Discord schliessen -> beim naechsten Oeffnen ist "🎮 Playing" wieder da
