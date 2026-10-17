/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    AccountDocument,
    Backup,
    MAX_BACKUP_BYTES,
    MAX_BIO_LENGTH,
    MAX_MEDIA_BYTES,
    Media,
    Preset,
    ProfileFields,
    RemoteProfile,
} from "./types";

function object(v: unknown): Record<string, unknown> {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Expected a JSON object.");
    return v as Record<string, unknown>;
}
function str(v: unknown, name: string, max: number, allowEmpty = true): string {
    if (typeof v !== "string" || v.length > max || (!allowEmpty && !v.trim()))
        throw new Error(`Invalid ${name} (maximum ${max} characters).`);
    return v;
}
function finite(v: unknown): number {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error("Invalid numeric value.");
    return v;
}
export function color(v: unknown): number | null {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 0xffffff)
        throw new Error("Invalid profile color.");
    return v;
}
export function colors(v: unknown): [number, number] | null {
    if (v === null) return null;
    if (!Array.isArray(v) || v.length !== 2 || v.some(c => color(c) === null))
        throw new Error("Expected two profile colors.");
    return [v[0], v[1]];
}
export function validateMedia(v: unknown): Media | null {
    if (v === null) return null;
    const m = object(v);
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(String(m.mime)))
        throw new Error("Unsupported image type.");
    const data = str(m.data, "image data", Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 80, false);
    const prefix = `data:${m.mime};base64,`;
    if (!data.startsWith(prefix)) throw new Error("Image must be embedded; remote image references are not accepted.");
    const b64 = data.slice(prefix.length);
    if (b64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error("Invalid base64 image.");
    const bytes = (b64.length * 3) / 4 - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
    if (!bytes || bytes > MAX_MEDIA_BYTES || bytes !== m.bytes)
        throw new Error("Invalid image size; maximum is 8 MiB.");
    if (typeof m.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(m.sha256)) throw new Error("Invalid image checksum.");
    const width = finite(m.width),
        height = finite(m.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 40_000_000)
        throw new Error("Image exceeds 40 megapixels or has invalid dimensions.");
    if (typeof m.animated !== "boolean") throw new Error("Missing image animation metadata.");
    return { mime: m.mime as Media["mime"], data, sha256: m.sha256, bytes, width, height, animated: m.animated };
}
export function validateFields(v: unknown): ProfileFields {
    const f = object(v);
    const result: ProfileFields = {
        avatar: validateMedia(f.avatar),
        banner: validateMedia(f.banner),
        accentColor: color(f.accentColor),
        themeColors: colors(f.themeColors),
        bio: str(f.bio, "bio", MAX_BIO_LENGTH),
        pronouns: str(f.pronouns, "pronouns", 40),
    };
    if (f.globalName !== undefined)
        result.globalName = f.globalName === null ? null : str(f.globalName, "display name", 32, false);
    return result;
}
export function validatePreset(v: unknown): Preset {
    const p = object(v);
    if (typeof p.favorite !== "boolean") throw new Error("Invalid favorite flag.");
    const id = str(p.id, "preset ID", 80, false);
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid preset ID.");
    return {
        id,
        name: str(p.name, "preset name", 80, false).trim(),
        createdAt: finite(p.createdAt),
        updatedAt: finite(p.updatedAt),
        favorite: p.favorite,
        fields: validateFields(p.fields),
    };
}
export function emptyDocument(accountId: string): AccountDocument {
    if (!/^\d{5,22}$/.test(accountId)) throw new Error("No valid Discord account is signed in.");
    return {
        schemaVersion: 1,
        accountId,
        presets: [],
        activePresetId: null,
        activeRemote: null,
        nextAllowedAt: 0,
        rotation: { presetIds: [], minutes: 120 },
        recovery: null,
    };
}
export function validateRemote(v: unknown, accountId: string): RemoteProfile {
    const r = object(v);
    if (r.accountId !== accountId) throw new Error("Remote profile belongs to another account.");
    const hash = (v: unknown) => (v === null ? null : str(v, "asset hash", 128, false));
    return {
        accountId,
        avatarHash: hash(r.avatarHash),
        bannerHash: hash(r.bannerHash),
        accentColor: color(r.accentColor),
        themeColors: colors(r.themeColors),
        bio: str(r.bio, "bio", MAX_BIO_LENGTH),
        pronouns: str(r.pronouns, "pronouns", 40),
        globalName: r.globalName === null ? null : str(r.globalName, "display name", 32, false),
        premiumType: finite(r.premiumType),
    };
}
/** Version gate is intentional: never rewrite an unknown future schema. */
export function migrateDocument(v: unknown, accountId: string): AccountDocument {
    if (v === undefined) return emptyDocument(accountId);
    const d = object(v);
    if (d.schemaVersion !== 1) throw new Error(`Unsupported local schema ${d.schemaVersion}; data was not modified.`);
    if (d.accountId !== accountId) throw new Error("Account data mismatch; access refused.");
    if (!Array.isArray(d.presets)) throw new Error("Invalid preset collection.");
    const presets = d.presets.map(validatePreset);
    if (new Set(presets.map(p => p.id)).size !== presets.length) throw new Error("Duplicate preset IDs.");
    const rot = object(d.rotation);
    if (!Array.isArray(rot.presetIds) || rot.presetIds.some(id => typeof id !== "string"))
        throw new Error("Invalid rotation.");
    let recovery: AccountDocument["recovery"] = null;
    if (d.recovery !== null) {
        const r = object(d.recovery);
        if (
            !Array.isArray(r.completed) ||
            r.completed.some(s => s !== "account" && s !== "profile") ||
            ![null, "account", "profile"].includes(r.inFlight as string | null)
        )
            throw new Error("Invalid recovery log.");
        recovery = {
            id: str(r.id, "recovery ID", 80, false),
            createdAt: finite(r.createdAt),
            targetName: str(r.targetName, "target", 80, false),
            before: validateFields(r.before),
            completed: r.completed,
            inFlight: r.inFlight as "account" | "profile" | null,
            message: r.message === null ? null : str(r.message, "error", 2000),
        };
    }
    return {
        schemaVersion: 1,
        accountId,
        presets,
        activePresetId:
            typeof d.activePresetId === "string" && presets.some(p => p.id === d.activePresetId)
                ? d.activePresetId
                : null,
        activeRemote: d.activeRemote === null ? null : validateRemote(d.activeRemote, accountId),
        nextAllowedAt: finite(d.nextAllowedAt),
        rotation: {
            presetIds: [...new Set(rot.presetIds as string[])].filter(id => presets.some(p => p.id === id)),
            minutes: Math.max(60, finite(rot.minutes)),
        },
        recovery,
    };
}
export function parseBackup(text: string): Backup {
    if (new Blob([text]).size > MAX_BACKUP_BYTES) throw new Error("Backup exceeds 100 MiB. Export smaller selections.");
    const b = object(JSON.parse(text));
    if (b.format !== "profile-manager-pro" || b.schemaVersion !== 1)
        throw new Error("Unsupported backup format or version.");
    const accountId = str(b.accountId, "account ID", 22, false);
    if (!/^\d{5,22}$/.test(accountId) || !Array.isArray(b.presets)) throw new Error("Invalid backup metadata.");
    const presets = b.presets.map(validatePreset);
    if (new Set(presets.map(p => p.id)).size !== presets.length) throw new Error("Duplicate preset IDs in backup.");
    return { format: "profile-manager-pro", schemaVersion: 1, exportedAt: finite(b.exportedAt), accountId, presets };
}
