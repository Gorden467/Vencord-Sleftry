import type { LyricLine } from "./types";

const BASE_URL = "https://lrclib.net/api";
const cache = new Map<string, LyricLine[] | null>();

let networkAccess: "unknown" | "allowed" | "blocked" = "unknown";
let permissionRequested = false;
let blockedWarned = false;
let debugEnabled = false;

type NetworkAccessState = "unknown" | "allowed" | "blocked";

function debugLog(message: string, extra?: unknown) {
    if (!debugEnabled) return;
    if (extra === undefined) {
        console.info(`[DiscordLyricsSpotifyStatus] ${message}`);
        return;
    }

    console.info(`[DiscordLyricsSpotifyStatus] ${message}`, extra);
}

export function setLyricsDebugMode(enabled: boolean) {
    debugEnabled = enabled;
}

export function clearLyricsCache(trackId?: string) {
    if (trackId) {
        cache.delete(trackId);
        debugLog(`Cleared lyrics cache for track ${trackId}`);
        return;
    }

    cache.clear();
    debugLog("Cleared full lyrics cache");
}

function setNetworkAccess(state: NetworkAccessState) {
    networkAccess = state;
}

function cacheAndReturn(trackId: string, value: LyricLine[] | null) {
    cache.set(trackId, value);
    return value;
}

export async function initLyricsNetworkAccess() {
    if (networkAccess !== "unknown") return;

    const url = "https://lrclib.net";
    const directives = ["connect-src"];

    const allowed = await VencordNative.csp.isDomainAllowed(url, directives).catch(() => false);
    if (allowed) {
        setNetworkAccess("allowed");
        return;
    }

    if (!permissionRequested) {
        permissionRequested = true;
        const result = await VencordNative.csp.requestAddOverride(url, directives, "DiscordLyricsSpotifyStatus").catch(() => "cancelled");
        if (result === "ok") {
            console.info("[DiscordLyricsSpotifyStatus] CSP permission granted for lrclib.net. Please fully restart Discord to apply it.");
        }
    }

    setNetworkAccess("blocked");
}

function parseLrc(lrc: string): LyricLine[] {
    const lines: LyricLine[] = [];
    const regex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/;

    for (const rawLine of lrc.split("\n")) {
        const match = rawLine.trim().match(regex);
        if (!match) continue;

        const [, mm, ss, cs, text] = match;
        const ms =
            parseInt(mm, 10) * 60_000 +
            parseInt(ss, 10) * 1_000 +
            (cs.length === 3 ? parseInt(cs, 10) : parseInt(cs, 10) * 10);

        lines.push({ timeMs: ms, text: text.trim() });
    }

    return lines.sort((a, b) => a.timeMs - b.timeMs);
}

export async function getLyrics(
    trackId: string,
    trackName: string,
    artistName: string,
    albumName = "",
    durationMs = 0,
    forceRefresh = false,
): Promise<LyricLine[] | null> {
    if (forceRefresh) {
        cache.delete(trackId);
        debugLog(`Force refresh lyrics for ${trackName} - ${artistName}`);
    }

    if (cache.has(trackId)) return cache.get(trackId) ?? null;

    if (networkAccess === "unknown") {
        await initLyricsNetworkAccess();
    }

    if (networkAccess !== "allowed") {
        if (!blockedWarned) {
            blockedWarned = true;
            console.warn("[DiscordLyricsSpotifyStatus] LRCLIB is blocked by CSP. Grant permission prompt and fully restart Discord.");
        }
        cacheAndReturn(trackId, null);
        debugLog("Lyrics fetch blocked by CSP", { trackId, trackName, artistName });
        return null;
    }

    try {
        const params = new URLSearchParams({
            track_name: trackName,
            artist_name: artistName,
        });

        if (albumName) params.set("album_name", albumName);
        if (durationMs > 0) params.set("duration", Math.round(durationMs / 1000).toString());

        const res = await fetch(`${BASE_URL}/get?${params}`);

        if (res.status === 404) {
            cacheAndReturn(trackId, null);
            debugLog("No lyrics found (404)", { trackId, trackName, artistName });
            return null;
        }

        if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);

        const data = await res.json();
        if (!data?.syncedLyrics) {
            cacheAndReturn(trackId, null);
            debugLog("Lyrics response missing syncedLyrics", { trackId, trackName, artistName });
            return null;
        }

        const lines = parseLrc(data.syncedLyrics);
        cacheAndReturn(trackId, lines);
        debugLog("Lyrics loaded", { trackId, lines: lines.length });
        return lines;
    } catch {
        cacheAndReturn(trackId, null);
        debugLog("Lyrics request failed", { trackId, trackName, artistName });
        return null;
    }
}
