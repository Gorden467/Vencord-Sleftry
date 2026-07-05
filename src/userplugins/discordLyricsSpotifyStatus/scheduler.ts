import type { LyricLine } from "./types";

export class LyricScheduler {
    private readonly lyrics: LyricLine[];
    private readonly onLineChange: (line: LyricLine) => void;
    private timers: number[] = [];
    private startedAt = 0;
    private startProgressMs = 0;

    constructor(lyrics: LyricLine[], onLineChange: (line: LyricLine) => void) {
        this.lyrics = lyrics;
        this.onLineChange = onLineChange;
    }

    private scheduleLine(line: LyricLine, delay: number) {
        this.timers.push(window.setTimeout(() => this.onLineChange(line), delay));
    }

    start(progressMs: number) {
        this.stop();

        this.startedAt = Date.now();
        this.startProgressMs = progressMs;

        const passed = this.lyrics.filter(l => l.timeMs <= progressMs);
        if (passed.length > 0) {
            const current = passed[passed.length - 1];
            this.scheduleLine(current, 0);
        }

        for (const line of this.lyrics) {
            const delay = line.timeMs - progressMs;
            if (delay <= 0) continue;

            this.scheduleLine(line, delay);
        }
    }

    stop() {
        for (const timer of this.timers) window.clearTimeout(timer);
        this.timers = [];
    }

    restart(newProgressMs: number) {
        this.start(newProgressMs);
    }

    get estimatedProgressMs() {
        return this.startProgressMs + (Date.now() - this.startedAt);
    }
}
