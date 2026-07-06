/*
 * Discord Lyrics Spotify Status as a Vencord userplugin
 * Author: Tona Shiin (https://github.com/Shiin2ii)
 * Source: https://github.com/Shiin2ii/discordLyricsSpotifyStatus
 * This is an unofficial community plugin and is not part of official Vencord plugins.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { clearLyricsCache, getLyrics, initLyricsNetworkAccess, setLyricsDebugMode } from "./lyrics";
import { LyricScheduler } from "./scheduler";
import { getCurrentTrack } from "./spotify";
import { captureOriginalStatus, clearCustomStatus, clearCustomStatusOnUnload, forceClearCustomStatus, primeOriginalStatusCache, resetStatusCache, setCustomStatus, setStatusDebugMode, wasLyricActive } from "./status";
import type { LyricLine, SpotifyTrackState } from "./types";

const POLL_INTERVAL_MS = 500;
const BOOST_POLL_INTERVAL_MS = 180;
const TRACK_SWITCH_BOOST_WINDOW_MS = 3_000;
const SEEK_THRESHOLD_MS = 2000;
const MIN_LYRIC_LINE_LENGTH = 2;
const LYRIC_PADDING_CHAR = "♪";

const settings = definePluginSettings({
    clearOnStop: {
        type: OptionType.BOOLEAN,
        description: "Clear custom status when plugin stops or song is paused",
        default: true,
    },
    fallbackTrackText: {
        type: OptionType.BOOLEAN,
        description: "Show track name when synced lyrics are unavailable",
        default: true,
    },
    trackSwitchBoost: {
        type: OptionType.BOOLEAN,
        description: "Temporarily poll faster for 3s after track switches",
        default: true,
    },
    forceRefreshOnTrackSwitch: {
        type: OptionType.BOOLEAN,
        description: "Force refresh lyrics when switching tracks (bypass cache)",
        default: true,
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Enable detailed debug logs in console",
        default: false,
    },
});

let currentTrackId: string | null = null;
let scheduler: LyricScheduler | null = null;
let lastProgressMs = 0;
let lastPollTime = 0;
let pollTimer: number | null = null;
let pollingActive = false;
let trackLoadToken = 0;
let boostUntilMs = 0;

function debugLog(message: string, extra?: unknown) {
    if (!settings.store.debugMode) return;
    if (extra === undefined) {
        console.info(`[DiscordLyricsSpotifyStatus] ${message}`);
        return;
    }

    console.info(`[DiscordLyricsSpotifyStatus] ${message}`, extra);
}

function getNextPollDelayMs() {
    if (!settings.store.trackSwitchBoost) return POLL_INTERVAL_MS;
    return Date.now() < boostUntilMs ? BOOST_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
}

function normalizeLyricLine(line: LyricLine) {
    const raw = line.text?.trim() || "";
    if (raw.length >= MIN_LYRIC_LINE_LENGTH) return raw;

    return (raw + ` ${LYRIC_PADDING_CHAR}`).trim().padEnd(MIN_LYRIC_LINE_LENGTH, LYRIC_PADDING_CHAR);
}

function stopScheduler() {
    if (!scheduler) return;
    scheduler.stop();
    scheduler = null;
}

function onLineChange(line: LyricLine) {
    setCustomStatus(`🎵 ${normalizeLyricLine(line)}`);
}

function resetRuntimeState() {
    currentTrackId = null;
    lastProgressMs = 0;
    lastPollTime = 0;
    trackLoadToken = 0;
    boostUntilMs = 0;
}

function applyDebugModeSettings() {
    setLyricsDebugMode(settings.store.debugMode);
    setStatusDebugMode(settings.store.debugMode);
}

function setFallbackTrackStatus(track: SpotifyTrackState) {
    if (settings.store.fallbackTrackText) {
        setCustomStatus(`🎵 ${track.trackName} - ${track.artistName}`);
        return;
    }

    clearCustomStatus();
}

function shouldIgnoreLyricResult(loadToken: number, trackId: string) {
    return loadToken !== trackLoadToken || currentTrackId !== trackId;
}

async function handleTrackChange(track: SpotifyTrackState, now: number) {
    debugLog("Track changed", {
        from: currentTrackId,
        to: track.trackId,
        trackName: track.trackName,
        artistName: track.artistName,
    });

    currentTrackId = track.trackId;
    const loadToken = ++trackLoadToken;
    const requestStartedAt = Date.now();

    if (settings.store.trackSwitchBoost) {
        boostUntilMs = now + TRACK_SWITCH_BOOST_WINDOW_MS;
    }

    stopScheduler();
    setFallbackTrackStatus(track);

    const lyrics = await getLyrics(
        track.trackId,
        track.trackName,
        track.artistName,
        track.albumName,
        track.durationMs,
        settings.store.forceRefreshOnTrackSwitch,
    );

    const liveTrack = getCurrentTrack();
    if (!liveTrack?.isPlaying || liveTrack.trackId !== track.trackId) {
        debugLog("Dropping lyrics response because active track changed during fetch", {
            requestedTrackId: track.trackId,
            activeTrackId: liveTrack?.trackId ?? null,
        });
        return;
    }

    if (shouldIgnoreLyricResult(loadToken, track.trackId)) {
        debugLog("Ignoring stale lyric response", { trackId: track.trackId });
        return;
    }

    if (!lyrics?.length) {
        debugLog("Lyrics unavailable, using fallback if enabled", { trackId: track.trackId });
        return;
    }

    const freshProgressMs = liveTrack.progressMs || (track.progressMs + (Date.now() - requestStartedAt));

    scheduler = new LyricScheduler(lyrics, onLineChange);
    scheduler.start(freshProgressMs);
    debugLog("Scheduler started", {
        trackId: track.trackId,
        lyricLines: lyrics.length,
        startProgressMs: freshProgressMs,
    });
}

function syncSchedulerDrift(track: SpotifyTrackState, now: number) {
    if (!scheduler || lastPollTime <= 0) return;

    const elapsed = now - lastPollTime;
    const expected = lastProgressMs + elapsed;
    const drift = Math.abs(track.progressMs - expected);

    if (drift <= SEEK_THRESHOLD_MS) return;

    debugLog("Drift detected, restarting scheduler", {
        trackId: track.trackId,
        drift,
        progressMs: track.progressMs,
    });
    scheduler.restart(track.progressMs);
}

async function poll() {
    const track = getCurrentTrack();
    const now = Date.now();

    if (!track || !track.isPlaying) {
        if (currentTrackId !== null) {
            debugLog("Playback stopped or paused; clearing scheduler", { previousTrackId: currentTrackId });
            stopScheduler();
            currentTrackId = null;
            if (settings.store.clearOnStop) clearCustomStatus();
        }

        lastPollTime = now;
        return;
    }

    if (track.trackId !== currentTrackId) {
        void handleTrackChange(track, now);
    } else {
        syncSchedulerDrift(track, now);
    }

    lastProgressMs = track.progressMs;
    lastPollTime = now;
}

function startPolling() {
    stopPolling();

    resetRuntimeState();
    stopScheduler();
    resetStatusCache();
    applyDebugModeSettings();

    pollingActive = true;

    const pollLoop = async () => {
        if (!pollingActive) return;
        await poll();
        if (!pollingActive) return;

        pollTimer = window.setTimeout(() => {
            void pollLoop();
        }, getNextPollDelayMs());
    };

    void pollLoop();
}

function stopPolling() {
    pollingActive = false;

    if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
    }
}

function forceRefreshCurrentTrackLyrics() {
    if (!currentTrackId) return;

    clearLyricsCache(currentTrackId);
    trackLoadToken++;
    debugLog("Manual force refresh requested", { trackId: currentTrackId });
    currentTrackId = null;
    void poll();
}

export default definePlugin({
    name: "DiscordLyricsSpotifyStatus",
    description: "Show synced Spotify lyrics in your Discord custom status",
    tags: ["Activity", "Media", "Utility"],
    authors: [{ name: "Tona Shiin", id: 0n }],
    settings,
    requiresRestart: false,

    start() {
        void initLyricsNetworkAccess();
        (globalThis as any).discordLyricsSpotifyStatusForceRefresh = forceRefreshCurrentTrackLyrics;
        (globalThis as any).discordLyricsStatusForceRefresh = forceRefreshCurrentTrackLyrics;
        registerUnloadClear();
        void primeOriginalStatusCache();
        void captureOriginalStatus();
        void resetStaleLyricStatus();
        startPolling();
    },

    stop() {
        stopPolling();
        stopScheduler();
        currentTrackId = null;
        trackLoadToken++;
        delete (globalThis as any).discordLyricsSpotifyStatusForceRefresh;
        delete (globalThis as any).discordLyricsStatusForceRefresh;
        unregisterUnloadClear();

        if (settings.store.clearOnStop) {
            clearCustomStatus();
        }
    },
});

async function resetStaleLyricStatus() {
    try {
        if (!(await wasLyricActive())) return;

        const track = getCurrentTrack();
        if (track?.isPlaying) {
            // Music is playing right now, the poll loop will overwrite the
            // stale status with a fresh lyric anyway.
            return;
        }

        debugLog("Stale lyric detected from previous session, clearing");
        forceClearCustomStatus();
    } catch {
        // ignore
    }
}

let unloadHandler: (() => void) | null = null;

function registerUnloadClear() {
    if (unloadHandler) return;
    unloadHandler = () => {
        if (settings.store.clearOnStop) {
            clearCustomStatusOnUnload();
        }
    };
    window.addEventListener("beforeunload", unloadHandler);
    window.addEventListener("pagehide", unloadHandler);
}

function unregisterUnloadClear() {
    if (!unloadHandler) return;
    window.removeEventListener("beforeunload", unloadHandler);
    window.removeEventListener("pagehide", unloadHandler);
    unloadHandler = null;
}
