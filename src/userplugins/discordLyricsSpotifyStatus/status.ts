import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import { RestAPI } from "@webpack/common";

const TokenModule = findByPropsLazy("getToken", "hideToken");
const ACTIVE_KEY = "DiscordLyricsSpotifyStatus_lyricActive";
const ORIGINAL_KEY = "DiscordLyricsSpotifyStatus_originalStatus";
const LYRIC_PREFIX = "🎵";

type SavedCustomStatus = {
    text: string | null;
    emojiName?: string | null;
    emojiId?: string | null;
    expiresAt?: string | null;
} | null;

function markLyricActive(active: boolean) {
    void DataStore.set(ACTIVE_KEY, active).catch(() => { /* ignore */ });
}

export async function wasLyricActive(): Promise<boolean> {
    try {
        return (await DataStore.get(ACTIVE_KEY)) === true;
    } catch {
        return false;
    }
}

let captureInFlight: Promise<void> | null = null;

/**
 * Reads the user's current custom_status from Discord and saves it as
 * "original" so we can restore it later when clearing our lyric.
 * Runs once per plugin session (guarded by captureInFlight).
 * If the CURRENT status starts with our lyric prefix (leftover from a
 * previous session), keeps whatever was already stored so a stale lyric
 * doesn't nuke the real original.
 */
export function captureOriginalStatus(): Promise<void> {
    if (captureInFlight) return captureInFlight;

    captureInFlight = (async () => {
        try {
            const resp = await RestAPI.get({ url: "/users/@me/settings" });
            const custom: any = resp?.body?.custom_status ?? null;

            if (custom?.text && typeof custom.text === "string" && custom.text.startsWith(LYRIC_PREFIX)) {
                debugLog("Current status is our lyric, keeping previously saved original");
                return;
            }

            const saved: SavedCustomStatus = custom ? {
                text: custom.text ?? null,
                emojiName: custom.emoji_name ?? null,
                emojiId: custom.emoji_id ?? null,
                expiresAt: custom.expires_at ?? null,
            } : null;

            await DataStore.set(ORIGINAL_KEY, saved);
            debugLog("Captured original custom status", saved);
        } catch {
            // ignore - restore just won't have anything to fall back to
        }
    })();

    return captureInFlight;
}

let cachedOriginal: SavedCustomStatus | undefined = undefined;

async function getSavedOriginalStatus(): Promise<SavedCustomStatus | undefined> {
    try {
        const value = await DataStore.get<SavedCustomStatus>(ORIGINAL_KEY);
        cachedOriginal = value;
        return value;
    } catch {
        return undefined;
    }
}

/**
 * Loads the saved original into an in-memory cache so callers that
 * cannot await (like the unload handler) can read it synchronously.
 * Call this once at plugin start.
 */
export async function primeOriginalStatusCache(): Promise<void> {
    await getSavedOriginalStatus();
}

export async function forgetOriginalStatus(): Promise<void> {
    captureInFlight = null;
    try { await DataStore.del(ORIGINAL_KEY); } catch { /* ignore */ }
}

function isNonEmptySavedStatus(saved: SavedCustomStatus | undefined): saved is Exclude<SavedCustomStatus, null> & { text: string } {
    return !!(saved && typeof saved.text === "string" && saved.text.length > 0);
}

async function buildRestoreOrClearEntry(labelSuffix: string): Promise<QueueEntry> {
    const saved = await getSavedOriginalStatus();

    if (isNonEmptySavedStatus(saved)) {
        const text = saved.text.slice(0, 128);
        return {
            body: {
                custom_status: {
                    text,
                    emoji_name: saved.emojiName ?? null,
                    emoji_id:   saved.emojiId   ?? null,
                    expires_at: saved.expiresAt ?? null,
                },
            },
            fallbackBody: {
                customStatus: {
                    text,
                    emojiName: saved.emojiName ?? null,
                    emojiId:   saved.emojiId   ?? null,
                    expiresAt: saved.expiresAt ?? null,
                },
            },
            label: `(restore${labelSuffix}: ${text.slice(0, 24)})`,
        };
    }

    return {
        body: { custom_status: null },
        fallbackBody: { customStatus: null },
        label: `(clear${labelSuffix})`,
    };
}

const logger = new Logger("DiscordLyricsSpotifyStatus");

type QueueEntry = {
    body: any;
    label: string;
    fallbackBody?: any;
};

const queue: QueueEntry[] = [];
let processing = false;
let lastText: string | null = null;
let debugEnabled = false;

function debugLog(message: string, extra?: unknown) {
    if (!debugEnabled) return;
    if (extra === undefined) {
        console.info(`[DiscordLyricsSpotifyStatus] ${message}`);
        return;
    }

    console.info(`[DiscordLyricsSpotifyStatus] ${message}`, extra);
}

export function setStatusDebugMode(enabled: boolean) {
    debugEnabled = enabled;
}

function enqueueLatestLyric(entry: QueueEntry) {
    if (!processing) {
        queue.length = 0;
        queue.push(entry);
        debugLog("Queued lyric update", { label: entry.label, queueLength: queue.length });
        return;
    }

    const hasHead = queue.length > 0;
    queue.length = hasHead ? 1 : 0;
    queue.push(entry);
    debugLog("Replaced stale lyric queue with latest line", { label: entry.label, queueLength: queue.length });
}

function enqueueClear(entry: QueueEntry) {
    queue.push(entry);
    debugLog("Queued clear status", { queueLength: queue.length });
}

async function processQueue() {
    if (processing) return;
    processing = true;

    if (captureInFlight) {
        try { await captureInFlight; } catch { /* ignore */ }
    }

    while (queue.length > 0) {
        const entry = queue[0];

        try {
            await RestAPI.patch({
                url: "/users/@me/settings",
                body: entry.body,
            });

            logger.info(`Status updated: ${entry.label}`);
            queue.shift();
        } catch (error: any) {
            const retryAfterMs = Math.ceil((error?.body?.retry_after ?? 1) * 1000);

            if (error?.status === 429) {
                if (queue.length > 1) {
                    debugLog("Dropped stale lyric due to rate limit backlog", { label: entry.label, queueLength: queue.length });
                    queue.shift();
                    continue;
                }

                logger.warn(`Rate limited, retrying in ${retryAfterMs}ms`);
                await new Promise(resolve => setTimeout(resolve, retryAfterMs));
                continue;
            }

            if (entry.fallbackBody) {
                logger.warn("Primary status payload rejected. Retrying with fallback payload format.");
                queue[0] = {
                    body: entry.fallbackBody,
                    label: entry.label,
                };
                continue;
            }

            logger.error("Failed to update custom status", error);
            queue.shift();
        }
    }

    processing = false;
}

export function setCustomStatus(text: string) {
    if (text === lastText) return;

    lastText = text;
    markLyricActive(true);

    enqueueLatestLyric({
        body: {
            custom_status: {
                text: text.slice(0, 128),
                emoji_name: null,
                expires_at: null,
            },
        },
        fallbackBody: {
            customStatus: {
                text: text.slice(0, 128),
                emojiName: null,
                expiresAt: null,
            },
        },
        label: text,
    });

    void processQueue();
}

export function clearCustomStatus() {
    if (lastText === null) return;

    lastText = null;
    markLyricActive(false);

    void (async () => {
        const entry = await buildRestoreOrClearEntry("");
        enqueueClear(entry);
        void processQueue();
    })();
}

/**
 * Clears (or restores the saved original) even if we haven't tracked
 * setting a status in this session. Used on start-up to reset a stale
 * lyric that was left behind by a previous session (e.g. crash).
 */
export function forceClearCustomStatus() {
    lastText = null;
    markLyricActive(false);

    void (async () => {
        const entry = await buildRestoreOrClearEntry(" force");
        enqueueClear(entry);
        void processQueue();
    })();
}

export function resetStatusCache() {
    lastText = null;
}

/**
 * Fire-and-forget PATCH that survives the page/window unload.
 * Used when Discord is being closed so the last lyric line is not left
 * hanging on the user's profile.
 */
export function clearCustomStatusOnUnload() {
    if (lastText === null) return;
    lastText = null;
    markLyricActive(false);

    let token: string | undefined;
    try { token = TokenModule?.getToken?.(); } catch { /* ignore */ }
    if (!token) return;

    let body: any;
    if (isNonEmptySavedStatus(cachedOriginal)) {
        const text = cachedOriginal.text.slice(0, 128);
        body = {
            custom_status: {
                text,
                emoji_name: cachedOriginal.emojiName ?? null,
                emoji_id:   cachedOriginal.emojiId   ?? null,
                expires_at: cachedOriginal.expiresAt ?? null,
            },
        };
    } else {
        body = { custom_status: null };
    }

    try {
        fetch("/api/v9/users/@me/settings", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token,
            },
            body: JSON.stringify(body),
            keepalive: true,
            credentials: "include",
        });
    } catch {
        // swallow - page is unloading anyway
    }
}
