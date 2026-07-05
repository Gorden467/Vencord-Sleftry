import type { SpotifyPlayerState } from "@vencord/discord-types";
import { PresenceStore, SpotifyStore, UserStore } from "@webpack/common";

import type { SpotifyTrackState } from "./types";

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function buildTrackId(state: SpotifyPlayerState) {
    const trackId = state.track?.id;
    if (trackId) return trackId;

    const title = state.track?.name ?? "";
    const artist = state.track?.artists?.map(a => a.name).join(", ") ?? "";
    return `${title}::${artist}`.toLowerCase().replace(/\s+/g, "-");
}

function getActivePlayerState(): SpotifyPlayerState | null {
    const active = SpotifyStore.getActiveSocketAndDevice?.();
    const accountId = active?.socket?.accountId;
    if (!accountId) return null;

    return SpotifyStore.getPlayerState?.(accountId) ?? null;
}

function getTrackFromPresence(): SpotifyTrackState | null {
    const me = UserStore.getCurrentUser?.();
    if (!me?.id) return null;

    const activities = PresenceStore.getActivities?.(me.id) ?? [];
    const spotifyActivity = activities.find((a: any) =>
        a?.name === "Spotify" && (a?.details || a?.sync_id)
    );

    if (!spotifyActivity) return null;

    const now = Date.now();
    const start = Number(spotifyActivity?.timestamps?.start ?? now);
    const end = Number(spotifyActivity?.timestamps?.end ?? start);
    const durationMs = Math.max(0, end - start);
    const progressMs = durationMs > 0
        ? clamp(now - start, 0, durationMs)
        : 0;
    const fallbackTrackId = `${spotifyActivity.details || ""}::${spotifyActivity.state || ""}`;

    return {
        isPlaying: durationMs > 0 ? now < (end + 1_500) : true,
        trackId: spotifyActivity.sync_id || fallbackTrackId,
        trackName: spotifyActivity.details || "",
        artistName: spotifyActivity.state || "",
        albumName: "",
        progressMs,
        durationMs,
    };
}

export function getCurrentTrack(): SpotifyTrackState | null {
    const state = getActivePlayerState();
    if (!state?.track) {
        return getTrackFromPresence();
    }

    const durationMs = state.track.duration ?? 0;
    const progressMs = clamp(Date.now() - state.startTime, 0, durationMs);

    const artistName = (state.track.artists ?? [])
        .map(a => a.name)
        .filter(Boolean)
        .join(", ");

    return {
        isPlaying: true,
        trackId: buildTrackId(state),
        trackName: state.track.name ?? "",
        artistName,
        albumName: state.track.album?.name ?? "",
        progressMs,
        durationMs,
    };
}
