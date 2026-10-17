/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const SCHEMA_VERSION = 1 as const;
// Discord accepts longer bios than the old 190 limit now
export const MAX_BIO_LENGTH = 1024;
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
// no own cooldown, Discord rate limits (429) still set nextAllowedAt
export const MIN_SWITCH_MS = 0;
export const MIN_ROTATION_MINUTES = 60;

export type MediaMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export interface Media {
    mime: MediaMime;
    data: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
    animated: boolean;
}
export interface ProfileFields {
    avatar: Media | null;
    banner: Media | null;
    accentColor: number | null;
    themeColors: [number, number] | null;
    bio: string;
    pronouns: string;
    /** Undefined means leave display name unchanged. Null resets it. */
    globalName?: string | null;
}
export interface Preset {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    favorite: boolean;
    fields: ProfileFields;
}
export type Stage = "account" | "profile";
export interface RemoteProfile {
    accountId: string;
    avatarHash: string | null;
    bannerHash: string | null;
    accentColor: number | null;
    themeColors: [number, number] | null;
    bio: string;
    pronouns: string;
    globalName: string | null;
    premiumType: number;
}
export interface Recovery {
    id: string;
    createdAt: number;
    targetName: string;
    before: ProfileFields;
    completed: Stage[];
    inFlight: Stage | null;
    message: string | null;
}
export interface AccountDocument {
    schemaVersion: 1;
    accountId: string;
    presets: Preset[];
    activePresetId: string | null;
    activeRemote: RemoteProfile | null;
    nextAllowedAt: number;
    rotation: { presetIds: string[]; minutes: number };
    recovery: Recovery | null;
}
export interface Backup {
    format: "profile-manager-pro";
    schemaVersion: 1;
    exportedAt: number;
    accountId: string;
    presets: Preset[];
}
export interface StoragePort {
    get<T>(key: string): Promise<T | undefined>;
    update<T>(key: string, updater: (value: T | undefined) => T): Promise<void>;
}
export interface DiscordPort {
    accountId(): string;
    assertReady(): void;
    read(): Promise<RemoteProfile>;
    snapshot(remote: RemoteProfile): Promise<ProfileFields>;
    checkCapabilities(fields: ProfileFields, remote: RemoteProfile): void;
    writeAccount(fields: ProfileFields, before: RemoteProfile, changeAvatar: boolean): Promise<void>;
    writeProfile(fields: ProfileFields, changeBanner: boolean): Promise<void>;
}
export interface SwitchProgress {
    busy: boolean;
    presetId: string | null;
    label: string;
    completed: Stage[];
    error: string | null;
}
