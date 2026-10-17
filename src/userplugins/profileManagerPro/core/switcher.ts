/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Repository } from "./repository";
import {
    AccountDocument,
    DiscordPort,
    MIN_SWITCH_MS,
    ProfileFields,
    RemoteProfile,
    Stage,
    SwitchProgress,
} from "./types";
import { validateFields } from "./validation";

export class ApiFailure extends Error {
    constructor(
        message: string,
        public readonly status = 0,
        public readonly retryAfterMs = 0,
    ) {
        super(message);
    }
}
export const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message.slice(0, 1900) : "An unexpected error occurred.";
export function sameRemote(a: RemoteProfile | null, b: RemoteProfile): boolean {
    return (
        !!a &&
        a.accountId === b.accountId &&
        a.avatarHash === b.avatarHash &&
        a.bannerHash === b.bannerHash &&
        a.bio === b.bio &&
        a.pronouns === b.pronouns &&
        a.globalName === b.globalName &&
        a.accentColor === b.accentColor &&
        JSON.stringify(a.themeColors) === JSON.stringify(b.themeColors)
    );
}
const sameMedia = (a: ProfileFields["avatar"], b: ProfileFields["avatar"]) =>
    (a?.sha256 ?? null) === (b?.sha256 ?? null);
export function makePlan(target: ProfileFields, before: ProfileFields) {
    const avatar = !sameMedia(target.avatar, before.avatar),
        banner = !sameMedia(target.banner, before.banner);
    const stages: Stage[] = [];
    if (avatar || (target.globalName !== undefined && target.globalName !== before.globalName)) stages.push("account");
    if (
        banner ||
        target.bio !== before.bio ||
        target.pronouns !== before.pronouns ||
        target.accentColor !== before.accentColor ||
        JSON.stringify(target.themeColors) !== JSON.stringify(before.themeColors)
    )
        stages.push("profile");
    return { avatar, banner, stages };
}
function verifyRemote(fields: ProfileFields, remote: RemoteProfile) {
    if (
        fields.bio !== remote.bio ||
        fields.pronouns !== remote.pronouns ||
        fields.accentColor !== remote.accentColor ||
        JSON.stringify(fields.themeColors) !== JSON.stringify(remote.themeColors) ||
        (fields.globalName !== undefined && fields.globalName !== remote.globalName)
    )
        throw new Error(
            "Discord accepted the request, but the profile readback differs. Check the recovery report before trying again.",
        );
    if (!!fields.avatar !== !!remote.avatarHash || !!fields.banner !== !!remote.bannerHash)
        throw new Error("The server readback does not contain the expected avatar or banner.");
    if (
        (fields.avatar?.animated && !remote.avatarHash?.startsWith("a_")) ||
        (fields.banner?.animated && !remote.bannerHash?.startsWith("a_"))
    )
        throw new Error("Discord did not preserve the requested animation. The original image is still saved locally.");
}
function markActive(d: AccountDocument, presetId: string | null, fields: ProfileFields, remote: RemoteProfile) {
    const preset = d.presets.find(p => p.id === presetId);
    const unchanged = preset && JSON.stringify(preset.fields) === JSON.stringify(fields);
    d.activePresetId = unchanged ? presetId : null;
    d.activeRemote = unchanged ? remote : null;
    d.recovery = null;
}
export interface SwitcherOptions {
    verifyMedia(fields: ProfileFields): Promise<void>;
    changed(): void;
    progress(progress: SwitchProgress): void;
    now?(): number;
    exclusive?<T>(accountId: string, run: () => Promise<T>): Promise<T>;
}
export class Switcher {
    private busy = false;
    private enabled = true;
    private generation = 0;
    constructor(
        private readonly repo: Repository,
        private readonly discord: DiscordPort,
        private readonly options: SwitcherOptions,
    ) {}
    start() {
        this.enabled = true;
    }
    stop() {
        this.enabled = false;
        this.generation++;
    }
    cancelForAccountChange() {
        this.generation++;
    }
    get isBusy() {
        return this.busy;
    }
    async activate(id: string): Promise<void> {
        return this.exclusive(async accountId => {
            const d = await this.repo.load(accountId);
            const p = d.presets.find(p => p.id === id);
            if (!p) throw new Error("Preset no longer exists.");
            if (d.recovery) throw new Error("Resolve the previous recovery report before switching profiles.");
            await this.apply(accountId, p.name, p.fields, p.id, false);
        }, id);
    }
    async restore(): Promise<void> {
        return this.exclusive(async accountId => {
            const d = await this.repo.load(accountId);
            if (!d.recovery) throw new Error("No recovery snapshot is available.");
            await this.apply(accountId, "Previous profile", d.recovery.before, null, true);
        }, null);
    }
    private async exclusive(run: (accountId: string) => Promise<void>, id: string | null) {
        if (this.busy) throw new Error("Another activation is in progress.");
        if (!this.enabled) throw new Error("ProfileManager PRO is disabled.");
        const accountId = this.discord.accountId();
        this.busy = true;
        this.options.progress({ busy: true, presetId: id, label: "Checking profile…", completed: [], error: null });
        try {
            const action = () => run(accountId);
            if (this.options.exclusive) await this.options.exclusive(accountId, action);
            else await action();
            this.options.progress({
                busy: false,
                presetId: null,
                label: "Profile activated",
                completed: [],
                error: null,
            });
        } catch (error) {
            this.options.progress({
                busy: false,
                presetId: null,
                label: "Activation stopped",
                completed: [],
                error: messageOf(error),
            });
            throw error;
        } finally {
            this.busy = false;
            this.options.changed();
        }
    }
    private async apply(
        accountId: string,
        name: string,
        rawFields: ProfileFields,
        presetId: string | null,
        restoring: boolean,
    ) {
        const { generation } = this;
        const now = this.options.now ?? Date.now;
        const guard = () => {
            if (!this.enabled || generation !== this.generation)
                throw new Error(
                    "Activation stopped because the plugin was disabled or the account changed. Any acknowledged changes are recorded in Recovery.",
                );
            if (this.discord.accountId() !== accountId)
                throw new Error("Account changed; no further profile requests were sent.");
        };
        const fields = validateFields(rawFields);
        guard();
        this.discord.assertReady();
        await this.options.verifyMedia(fields);
        guard();
        const d = await this.repo.load(accountId);
        const remoteBefore = await this.discord.read();
        guard();
        if (remoteBefore.accountId !== accountId) throw new Error("Account changed during profile read.");
        if (!restoring && presetId && d.activePresetId === presetId && sameRemote(d.activeRemote, remoteBefore)) return;
        this.discord.checkCapabilities(fields, remoteBefore);
        const before = await this.discord.snapshot(remoteBefore);
        guard();
        const plan = makePlan(fields, before);
        if (!plan.stages.length) {
            await this.repo.change(accountId, d => {
                markActive(d, presetId, fields, remoteBefore);
            });
            return;
        }
        if (d.nextAllowedAt > now())
            throw new Error(
                `Profile changes are cooling down. Try again after ${new Date(d.nextAllowedAt).toLocaleTimeString()}.`,
            );
        const recoveryId = restoring ? d.recovery!.id : crypto.randomUUID();
        await this.repo.change(accountId, d => {
            d.activePresetId = null;
            d.activeRemote = null;
            if (!restoring)
                d.recovery = {
                    id: recoveryId,
                    createdAt: now(),
                    targetName: name,
                    before,
                    completed: [],
                    inFlight: null,
                    message: null,
                };
            d.nextAllowedAt = now() + MIN_SWITCH_MS;
        });
        const completed: Stage[] = [];
        try {
            for (const stage of plan.stages) {
                guard();
                this.discord.assertReady();
                await this.repo.change(accountId, d => {
                    d.recovery!.inFlight = stage;
                    d.recovery!.message = null;
                });
                guard();
                this.options.progress({
                    busy: true,
                    presetId,
                    label:
                        stage === "account"
                            ? "Applying avatar and display name…"
                            : "Applying banner, colors and profile text…",
                    completed: [...completed],
                    error: null,
                });
                if (stage === "account") await this.discord.writeAccount(fields, remoteBefore, plan.avatar);
                else await this.discord.writeProfile(fields, plan.banner);
                completed.push(stage);
                // Journal the acknowledged write before checking for a mid-request logout.
                await this.repo.change(accountId, d => {
                    d.recovery!.inFlight = null;
                    if (!d.recovery!.completed.includes(stage)) d.recovery!.completed.push(stage);
                });
                guard();
            }
            this.options.progress({
                busy: true,
                presetId,
                label: "Verifying server profile…",
                completed: [...completed],
                error: null,
            });
            const after = await this.discord.read();
            guard();
            verifyRemote(fields, after);
            await this.repo.change(accountId, d => {
                markActive(d, presetId, fields, after);
            });
        } catch (error) {
            await this.repo.change(accountId, d => {
                if (d.recovery) d.recovery.message = messageOf(error);
                if (error instanceof ApiFailure && error.status === 429)
                    d.nextAllowedAt = Math.max(
                        d.nextAllowedAt,
                        // only as long as Discord asks for, not a guessed hour
                        now() + (error.retryAfterMs || 60_000),
                    );
            });
            throw error;
        }
    }
}
