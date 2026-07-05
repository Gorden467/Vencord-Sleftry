export interface LyricLine {
    timeMs: number;
    text: string;
}

export interface SpotifyTrackState {
    isPlaying: boolean;
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    progressMs: number;
    durationMs: number;
}
