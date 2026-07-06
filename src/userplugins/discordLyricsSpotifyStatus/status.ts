import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import { RestAPI } from "@webpack/common";

const TokenModule = findByPropsLazy("getToken", "hideToken");
const ACTIVE_KEY = "DiscordLyricsSpotifyStatus_lyricActive";

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

    enqueueClear({
        body: { custom_status: null },
        fallbackBody: { customStatus: null },
        label: "(clear)",
    });

    void processQueue();
}

/**
 * Clears the custom status even if we haven't tracked setting it in
 * this session. Used on start-up to remove a stale lyric that was left
 * behind by a previous session (e.g. crash).
 */
export function forceClearCustomStatus() {
    lastText = null;
    markLyricActive(false);

    enqueueClear({
        body: { custom_status: null },
        fallbackBody: { customStatus: null },
        label: "(force clear)",
    });

    void processQueue();
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

    try {
        fetch("/api/v9/users/@me/settings", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token,
            },
            body: JSON.stringify({ custom_status: null }),
            keepalive: true,
            credentials: "include",
        });
    } catch {
        // swallow - page is unloading anyway
    }
}
